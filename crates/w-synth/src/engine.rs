use crate::consts;
use crate::oto::{OtoBank, PrefixMap, parse_oto_ini, parse_prefix_map};
use crate::resample::{self, RenderedNote, consonant_scale};
use crate::timing::{self, NoteTiming, TimingInput};
use crate::world::features::WorldFeatures;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

#[derive(Deserialize, Debug)]
pub struct PitchbendPointInfo {
    pub offset: f64,
    pub value: f64,
}

#[derive(Deserialize, Debug)]
pub struct NoteInfo {
    pub alias: String,
    pub pitch: i32,
    pub start_time: f64,
    pub duration: f64,
    #[serde(default)]
    pub pitchbend: Vec<PitchbendPointInfo>,
    #[serde(default)]
    pub flags: String,
    #[serde(default = "default_velocity")]
    pub velocity: f64,
    #[serde(default = "default_velocity")]
    pub volume: f64,
    #[serde(default)]
    pub modulation: f64,
    /// Notes only cross-fade with neighbours of their own track.
    #[serde(default)]
    pub track: u32,
}

fn default_velocity() -> f64 {
    100.0
}

#[derive(Deserialize, Debug)]
pub struct ProjectInfo {
    pub notes: Vec<NoteInfo>,
    #[serde(default)]
    pub tempo: f64,
}

/// Lowercased file name without directories: the key under which features
/// are stored and looked up.
pub fn normalize_filename(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_lowercase()
}

struct StoredFeatures {
    features: Rc<WorldFeatures>,
    /// Changes whenever the features of a file are replaced, which
    /// invalidates every rendered note that depended on them.
    epoch: u32,
}

#[derive(Serialize, Default, Clone)]
pub struct RenderReport {
    pub total: usize,
    pub rendered: usize,
    pub cached: usize,
    pub skipped_rests: usize,
    /// Indices (into the notes array sent by the host) of notes whose alias
    /// could not be found in the voicebank.
    pub missing_alias: Vec<usize>,
    /// Indices of notes whose sample has no analyzed features yet.
    pub missing_features: Vec<usize>,
    pub errors: Vec<String>,
    /// Where the sound of every rendered note lies on the time axis.
    pub spans: Vec<NoteSpan>,
}

/// Where a planned note will sound, known before it is rendered.
#[derive(Serialize, Clone, Debug)]
pub struct PlanInfo {
    /// Index in the plan (what `render_planned` takes).
    pub index: usize,
    /// Index in the notes array sent by the host.
    pub source_index: usize,
    pub start: f64,
    pub span_start: f64,
    pub span_end: f64,
    /// The sample the note needs (as written in oto.ini).
    pub file: String,
}

/// The audible stretch of one note, absolute in milliseconds. The note fades in
/// over `fade_in` from `start` and fades out over `fade_out` up to `end`.
#[derive(Serialize, Clone, Debug)]
pub struct NoteSpan {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

struct PlannedNote {
    /// Index in the original notes array.
    source_index: usize,
    oto_alias: String,
    /// How the note sits against its neighbours (preutterance, overlap, fades).
    timing: NoteTiming,
}

struct Session {
    project: ProjectInfo,
    plan: Vec<PlannedNote>,
    cursor: usize,
    /// Which planned notes are already in the master buffer.
    rendered: Vec<bool>,
    master: Vec<f32>,
    new_cache: HashMap<u64, Rc<RenderedNote>>,
    report: RenderReport,
}

pub struct Engine {
    oto: OtoBank,
    prefix_map: PrefixMap,
    features: HashMap<String, StoredFeatures>,
    next_epoch: u32,
    render_cache: HashMap<u64, Rc<RenderedNote>>,
    session: Option<Session>,
    last_report: RenderReport,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            oto: OtoBank::default(),
            prefix_map: PrefixMap::new(),
            features: HashMap::new(),
            next_epoch: 1,
            render_cache: HashMap::new(),
            session: None,
            last_report: RenderReport::default(),
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    pub fn load_oto(&mut self, data: &[u8]) -> Result<()> {
        self.oto = OtoBank::from_entries(parse_oto_ini(data)?);
        self.render_cache.clear();
        Ok(())
    }

    pub fn load_prefix_map(&mut self, data: &[u8]) {
        self.prefix_map = parse_prefix_map(data);
        self.render_cache.clear();
    }

    pub fn cache_features(&mut self, filename: &str, features: WorldFeatures) {
        let epoch = self.next_epoch;
        self.next_epoch += 1;
        self.features.insert(
            normalize_filename(filename),
            StoredFeatures {
                features: Rc::new(features),
                epoch,
            },
        );
    }

    pub fn has_features(&self, filename: &str) -> bool {
        self.features.contains_key(&normalize_filename(filename))
    }

    /// `[[alias, file], ...]` for every oto entry.
    pub fn oto_entries(&self) -> Vec<(&str, &str)> {
        self.oto
            .iter()
            .map(|e| (e.alias.as_str(), e.filename.as_str()))
            .collect()
    }

    /// Alias that is actually used for a note after the prefix map is applied.
    fn resolve_alias(&self, alias: &str, pitch: i32) -> String {
        let best = self
            .prefix_map
            .keys()
            .filter(|&&k| k <= pitch)
            .max()
            .and_then(|k| self.prefix_map.get(k));
        if let Some((prefix, suffix)) = best {
            let candidate = format!("{prefix}{alias}{suffix}");
            if self.oto.find(&candidate).is_some() {
                return candidate;
            }
        }
        alias.to_string()
    }

    /// Sample files needed to render the given notes, plus the indices of
    /// the notes that cannot be resolved to any oto entry.
    pub fn required_files(&self, notes: &[NoteInfo]) -> (Vec<String>, Vec<usize>) {
        let mut files = Vec::new();
        let mut seen = HashSet::new();
        let mut missing = Vec::new();
        for (i, note) in notes.iter().enumerate() {
            if is_rest(note) {
                continue;
            }
            match self.oto.find(&self.resolve_alias(&note.alias, note.pitch)) {
                Some(entry) => {
                    if seen.insert(entry.filename.clone()) {
                        files.push(entry.filename.clone());
                    }
                }
                None => missing.push(i),
            }
        }
        (files, missing)
    }

    pub fn begin(&mut self, project: ProjectInfo) -> usize {
        let mut order: Vec<usize> = (0..project.notes.len()).collect();
        order.sort_by(|&a, &b| {
            project.notes[a]
                .start_time
                .partial_cmp(&project.notes[b].start_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut report = RenderReport {
            total: project.notes.len(),
            ..Default::default()
        };

        let mut plan = Vec::with_capacity(order.len());
        for &idx in order.iter() {
            let note = &project.notes[idx];
            if is_rest(note) {
                report.skipped_rests += 1;
                continue;
            }
            let oto_alias = self.resolve_alias(&note.alias, note.pitch);
            if self.oto.find(&oto_alias).is_none() {
                report.missing_alias.push(idx);
                continue;
            }
            plan.push(PlannedNote {
                source_index: idx,
                oto_alias,
                timing: NoteTiming::default(),
            });
        }
        self.apply_timing(&project, &mut plan);

        let end_ms = project
            .notes
            .iter()
            .map(|n| n.start_time + n.duration)
            .fold(0.0, f64::max)
            + 2000.0;
        let total_samples = (end_ms / 1000.0 * consts::SAMPLE_RATE as f64).ceil() as usize;

        let count = plan.len();
        self.session = Some(Session {
            project,
            rendered: vec![false; count],
            plan,
            cursor: 0,
            master: vec![0.0; total_samples],
            new_cache: HashMap::new(),
            report,
        });
        count
    }

    /// Works out how each planned note sits against its neighbours in the same
    /// track (see `timing`). Rests are not notes here, so a rest is a gap.
    fn apply_timing(&self, project: &ProjectInfo, plan: &mut [PlannedNote]) {
        let mut by_track: HashMap<u32, Vec<usize>> = HashMap::new();
        for (i, p) in plan.iter().enumerate() {
            by_track.entry(project.notes[p.source_index].track).or_default().push(i);
        }
        for indices in by_track.values() {
            let inputs: Vec<TimingInput> = indices
                .iter()
                .map(|&i| {
                    let note = &project.notes[plan[i].source_index];
                    let stretch = consonant_scale(note.velocity);
                    let (preutter, overlap) = self
                        .oto
                        .find(&plan[i].oto_alias)
                        .map_or((0.0, 0.0), |o| (o.preutterance.max(0.0), o.overlap));
                    TimingInput {
                        start: note.start_time,
                        duration: note.duration.max(1.0),
                        preutter: preutter * stretch,
                        overlap: overlap * stretch,
                    }
                })
                .collect();
            for (&i, t) in indices.iter().zip(timing::compute(&inputs)) {
                plan[i].timing = t;
            }
        }
    }

    /// Renders up to `max_notes` more notes in time order. Returns how many remain.
    pub fn step(&mut self, max_notes: usize) -> Result<usize> {
        let session = self.session.as_mut().ok_or_else(|| anyhow!("no synthesis session"))?;
        let mut picked = Vec::new();
        while picked.len() < max_notes.max(1) && session.cursor < session.plan.len() {
            if !session.rendered[session.cursor] {
                picked.push(session.cursor);
            }
            session.cursor += 1;
        }
        self.render_planned(&picked)
    }

    /// Renders the given planned notes (any order, already rendered ones are
    /// skipped). Returns how many planned notes are still not rendered.
    pub fn render_planned(&mut self, indices: &[usize]) -> Result<usize> {
        let mut session = self
            .session
            .take()
            .ok_or_else(|| anyhow!("no synthesis session"))?;
        for &i in indices {
            if i < session.plan.len() && !session.rendered[i] {
                session.rendered[i] = true;
                self.render_one(&mut session, i);
            }
        }
        let remaining = session.rendered.iter().filter(|r| !**r).count();
        self.session = Some(session);
        Ok(remaining)
    }

    fn render_one(&self, session: &mut Session, i: usize) {
        let planned = &session.plan[i];
        let note = &session.project.notes[planned.source_index];
        let Some(oto) = self.oto.find(&planned.oto_alias) else {
            return;
        };
        let Some(stored) = self.features.get(&normalize_filename(&oto.filename)) else {
            session.report.missing_features.push(planned.source_index);
            return;
        };

        let key = cache_key(note, &planned.oto_alias, &planned.timing, stored.epoch);
        let rendered = if let Some(hit) = self.render_cache.get(&key) {
            session.report.cached += 1;
            hit.clone()
        } else {
            match resample::render_note(note, oto, &stored.features, &planned.timing) {
                Ok(r) => {
                    session.report.rendered += 1;
                    Rc::new(r)
                }
                Err(e) => {
                    session
                        .report
                        .errors
                        .push(format!("note {}: {e}", planned.source_index));
                    return;
                }
            }
        };

        let start_ms = note.start_time - rendered.lead_ms;
        let samples_ms = rendered.pcm.len() as f64 / consts::SAMPLE_RATE as f64 * 1000.0;
        let (source_index, fade_in, fade_out) =
            (planned.source_index, planned.timing.fade_in, planned.timing.fade_out);
        session.report.spans.push(NoteSpan {
            index: source_index,
            start: start_ms,
            end: start_ms + samples_ms,
            fade_in,
            fade_out,
        });
        let start_sample = (start_ms / 1000.0 * consts::SAMPLE_RATE as f64).round() as i64;
        for (j, s) in rendered.pcm.iter().enumerate() {
            let idx = start_sample + j as i64;
            if idx >= 0 {
                if let Some(m) = session.master.get_mut(idx as usize) {
                    *m += *s;
                }
            }
        }
        let key = cache_key(
            &session.project.notes[source_index],
            &session.plan[i].oto_alias,
            &session.plan[i].timing,
            stored.epoch,
        );
        session.new_cache.insert(key, rendered);
    }

    /// Where the planned notes will sound, for scheduling a progressive render.
    pub fn plan_info(&self) -> Vec<PlanInfo> {
        let Some(session) = &self.session else {
            return Vec::new();
        };
        session
            .plan
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let note = &session.project.notes[p.source_index];
                PlanInfo {
                    index: i,
                    source_index: p.source_index,
                    start: note.start_time,
                    span_start: note.start_time - p.timing.preutter,
                    span_end: note.start_time + p.timing.end_ms(note.duration.max(1.0)),
                    file: self
                        .oto
                        .find(&p.oto_alias)
                        .map(|o| o.filename.clone())
                        .unwrap_or_default(),
                }
            })
            .collect()
    }

    /// A copy of a part of the mix as it is now (zero where nothing was rendered yet).
    pub fn read_master(&self, start: usize, len: usize) -> Vec<f32> {
        let Some(session) = &self.session else {
            return Vec::new();
        };
        let from = start.min(session.master.len());
        let to = start.saturating_add(len).min(session.master.len());
        session.master[from..to].to_vec()
    }

    /// Renders a whole project without disturbing a running session (a note preview while a
    /// progressive render is going on). The render cache only grows.
    pub fn render_oneshot(&mut self, project: ProjectInfo) -> Result<(Vec<f32>, RenderReport)> {
        let parked_session = self.session.take();
        let parked_report = std::mem::take(&mut self.last_report);
        let count = self.begin(project);
        let outcome = (|| {
            let indices: Vec<usize> = (0..count).collect();
            self.render_planned(&indices)?;
            let total = self.session.as_ref().map_or(0, |s| s.master.len());
            let pcm = self.read_master(0, total);
            self.end_stream(false)?;
            Ok((pcm, self.last_report.clone()))
        })();
        self.session = parked_session;
        self.last_report = parked_report;
        outcome
    }

    /// Ends a progressive session. A complete one replaces the render cache (what was not
    /// rendered is evicted); an abandoned one only adds what it rendered.
    pub fn end_stream(&mut self, complete: bool) -> Result<()> {
        let session = self
            .session
            .take()
            .ok_or_else(|| anyhow!("no synthesis session"))?;
        if complete {
            self.render_cache = session.new_cache;
        } else {
            self.render_cache.extend(session.new_cache);
        }
        self.last_report = session.report;
        Ok(())
    }

    /// Normalizes the mix and returns it. Notes that were not rendered in this
    /// session are evicted from the render cache.
    pub fn finish(&mut self) -> Result<Vec<f32>> {
        let mut session = self
            .session
            .take()
            .ok_or_else(|| anyhow!("no synthesis session"))?;

        self.render_cache = std::mem::take(&mut session.new_cache);
        self.last_report = session.report;

        let peak = session.master.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
        if peak > 0.001 && !(0.8..=1.0).contains(&peak) {
            let gain = 0.95 / peak;
            session.master.iter_mut().for_each(|s| *s *= gain);
        }
        Ok(session.master)
    }

    pub fn report(&self) -> &RenderReport {
        &self.last_report
    }
}

fn is_rest(note: &NoteInfo) -> bool {
    let alias = note.alias.trim();
    alias.is_empty() || alias.eq_ignore_ascii_case("r")
}

fn cache_key(note: &NoteInfo, oto_alias: &str, timing: &NoteTiming, epoch: u32) -> u64 {
    let mut h = DefaultHasher::new();
    oto_alias.hash(&mut h);
    epoch.hash(&mut h);
    note.pitch.hash(&mut h);
    note.duration.to_bits().hash(&mut h);
    note.flags.hash(&mut h);
    note.velocity.to_bits().hash(&mut h);
    note.volume.to_bits().hash(&mut h);
    for v in [
        timing.preutter,
        timing.overlap,
        timing.fade_in,
        timing.tail_adjust,
        timing.fade_out,
    ] {
        v.to_bits().hash(&mut h);
    }
    for p in &note.pitchbend {
        p.offset.to_bits().hash(&mut h);
        p.value.to_bits().hash(&mut h);
    }
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::read_write::read_audio;
    use crate::world::features::{AnalysisMode, generate_features};
    use std::time::Instant;

    /// 16-bit mono PCM WAV of a vowel-like harmonic tone with a noisy attack.
    fn make_wav(seconds: f64) -> Vec<u8> {
        let sr = consts::SAMPLE_RATE;
        let n = (seconds * sr as f64) as usize;
        let mut pcm = Vec::with_capacity(n * 2);
        let mut seed = 12345u32;
        for i in 0..n {
            let t = i as f64 / sr as f64;
            let f0 = 220.0 + 10.0 * (t * 5.0).sin();
            let mut v = 0.0;
            for h in 1..=8 {
                v += (2.0 * std::f64::consts::PI * f0 * h as f64 * t).sin() / h as f64;
            }
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = (seed >> 16) as f64 / 32768.0 - 1.0;
            let env = if t < 0.05 { 0.0 } else { 1.0 };
            let sample = 0.25 * v * env + if t < 0.05 { 0.1 * noise } else { 0.0 };
            pcm.extend_from_slice(&((sample * 20000.0) as i16).to_le_bytes());
        }
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&sr.to_le_bytes());
        out.extend_from_slice(&(sr * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        out.extend_from_slice(&pcm);
        out
    }

    fn note(alias: &str, start: f64, duration: f64, pitch: i32) -> NoteInfo {
        NoteInfo {
            alias: alias.into(),
            pitch,
            start_time: start,
            duration,
            pitchbend: vec![],
            flags: String::new(),
            velocity: 100.0,
            volume: 100.0,
            modulation: 0.0,
            track: 0,
        }
    }

    #[test]
    fn analysis_modes_agree_and_fast_is_faster() {
        let audio = read_audio(&make_wav(1.5)).unwrap();
        let t = Instant::now();
        let accurate = generate_features(&audio, AnalysisMode::Accurate, None).unwrap();
        let t_accurate = t.elapsed();
        let t = Instant::now();
        let fast = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        let t_fast = t.elapsed();
        eprintln!("accurate {t_accurate:?} fast {t_fast:?}");

        assert_eq!(accurate.frames(), fast.frames());
        assert_eq!(accurate.mgc.len(), accurate.frames() * 64);
        assert!((accurate.base_f0 - 220.0).abs() < 15.0, "{}", accurate.base_f0);
        assert!((fast.base_f0 - 220.0).abs() < 15.0, "{}", fast.base_f0);
    }

    #[test]
    fn features_roundtrip_through_serialization() {
        let audio = read_audio(&make_wav(0.5)).unwrap();
        let f = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        let bytes = oxicode::encode_to_vec(&f).unwrap();
        let (back, _): (WorldFeatures, usize) = oxicode::decode_from_slice(&bytes).unwrap();
        assert_eq!(back.mgc, f.mgc);
        assert_eq!(back.f0, f.f0);
    }

    #[test]
    fn synthesize_uses_and_evicts_render_cache() {
        let mut engine = Engine::new();
        engine
            .load_oto(b"a.wav=a,0,150,-100,40,20\nb.wav=b,0,150,-100,40,20\n")
            .unwrap();
        let audio = read_audio(&make_wav(1.0)).unwrap();
        let features = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        engine.cache_features("a.wav", features.clone());
        engine.cache_features("B.WAV", features);

        let project = |dur: f64| ProjectInfo {
            tempo: 120.0,
            notes: vec![
                note("a", 0.0, 400.0, 60),
                note("b", 400.0, dur, 64),
                note("zzz", 800.0, 200.0, 60),
                note("R", 1000.0, 200.0, 60),
            ],
        };

        let n = engine.begin(project(400.0));
        assert_eq!(n, 2);
        while engine.step(1).unwrap() > 0 {}
        let pcm = engine.finish().unwrap();
        assert!(pcm.iter().any(|s| s.abs() > 0.1), "silent output");
        let r = engine.report().clone();
        assert_eq!((r.rendered, r.cached), (2, 0));
        assert_eq!(r.missing_alias, vec![2]);

        // Same project again: everything comes from the cache.
        engine.begin(project(400.0));
        while engine.step(8).unwrap() > 0 {}
        engine.finish().unwrap();
        let r = engine.report().clone();
        assert_eq!((r.rendered, r.cached), (0, 2));

        // Editing the second note only re-renders the second note.
        engine.begin(project(300.0));
        while engine.step(8).unwrap() > 0 {}
        engine.finish().unwrap();
        let r = engine.report().clone();
        assert_eq!((r.rendered, r.cached), (1, 1));
    }

    /// Short notes of a VCV-style voicebank (long preutterance): the sounds of neighbours
    /// must not stack on top of each other.
    #[test]
    fn short_adjacent_notes_give_way_to_each_other() {
        let mut engine = Engine::new();
        // offset, consonant, cutoff, preutterance, overlap
        engine.load_oto(b"a.wav=a,0,150,-100,200,60\n").unwrap();
        let audio = read_audio(&make_wav(1.0)).unwrap();
        let features = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        engine.cache_features("a.wav", features);

        let notes: Vec<NoteInfo> = (0..4)
            .map(|i| note("a", i as f64 * 170.0, 170.0, if i % 2 == 0 { 57 } else { 64 }))
            .collect();
        let starts: Vec<f64> = notes.iter().map(|n| n.start_time).collect();
        engine.begin(ProjectInfo { tempo: 120.0, notes });
        let timings: Vec<NoteTiming> =
            engine.session.as_ref().unwrap().plan.iter().map(|p| p.timing).collect();

        for i in 1..timings.len() {
            let (prev, cur) = (&timings[i - 1], &timings[i]);
            // The consonant never takes more than half of the previous note.
            assert!(cur.preutter - cur.overlap <= 170.0 * 0.5 + 1e-9, "{cur:?}");
            // The previous sound is gone by the time the next one has fully faded in.
            let prev_sound_end = starts[i - 1] + prev.end_ms(170.0);
            let next_fade_in_end = starts[i] - cur.preutter + cur.fade_in;
            assert!(
                prev_sound_end <= next_fade_in_end + 1e-9,
                "note {i}: previous sound ends at {prev_sound_end}, the next is fully in at {next_fade_in_end}"
            );
        }
        // And it still renders everything.
        while engine.step(8).unwrap() > 0 {}
        let pcm = engine.finish().unwrap();
        assert!(pcm.iter().any(|s| s.abs() > 0.1));
        assert_eq!(engine.report().rendered, 4);
    }

    /// A progressive render may render notes in any order (starting where the playhead is)
    /// and read finished parts of the mix before the rest exists.
    #[test]
    fn notes_can_be_rendered_in_any_order_and_read_back_early() {
        let mut engine = Engine::new();
        engine.load_oto(b"a.wav=a,0,150,-100,40,20\n").unwrap();
        let audio = read_audio(&make_wav(1.0)).unwrap();
        let features = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        engine.cache_features("a.wav", features);
        let notes = || -> Vec<NoteInfo> {
            (0..6).map(|i| note("a", i as f64 * 300.0, 300.0, 55 + (i % 3) * 2)).collect()
        };
        let project = || ProjectInfo { tempo: 120.0, notes: notes() };

        // In time order.
        engine.begin(project());
        while engine.step(1).unwrap() > 0 {}
        let reference = engine.read_master(0, 44100 * 2);
        engine.end_stream(true).unwrap();

        // Backwards, a few at a time, reading the middle after only the second half exists.
        engine.begin(project());
        let plan = engine.plan_info();
        assert_eq!(plan.len(), 6);
        assert!(plan.windows(2).all(|w| w[0].start < w[1].start));
        assert!(plan.iter().all(|p| p.span_end > p.start && p.file == "a.wav"));
        assert_eq!(engine.render_planned(&[5, 4, 3]).unwrap(), 3);
        let sr = consts::SAMPLE_RATE as f64;
        let from = (plan[3].span_start.max(0.0) / 1000.0 * sr) as usize;
        let early = engine.read_master(from + 200, 3000);
        assert!(early.iter().any(|s| s.abs() > 0.05), "the rendered half is audible already");
        // The unrendered first half is still silent at this point.
        assert!(engine.read_master(0, 2000).iter().all(|s| s.abs() < 1e-6));
        assert_eq!(engine.render_planned(&[2, 1, 0, 5]).unwrap(), 0);
        let backwards = engine.read_master(0, 44100 * 2);
        engine.end_stream(true).unwrap();
        assert_eq!(reference.len(), backwards.len());
        let worst = reference
            .iter()
            .zip(&backwards)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(worst < 1e-4, "order must not change the sound (worst difference {worst})");
        // Everything was cached by the first run, so the second only reused it.
        assert_eq!(engine.report().rendered, 0);
        assert_eq!(engine.report().cached, 6);
    }

    #[test]
    fn a_oneshot_render_leaves_a_running_session_alone() {
        let mut engine = Engine::new();
        engine.load_oto(b"a.wav=a,0,150,-100,40,20\n").unwrap();
        let audio = read_audio(&make_wav(1.0)).unwrap();
        let features = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        engine.cache_features("a.wav", features);
        let project = ProjectInfo {
            tempo: 120.0,
            notes: (0..3).map(|i| note("a", i as f64 * 300.0, 300.0, 55 + i)).collect(),
        };
        engine.begin(project);
        engine.render_planned(&[0]).unwrap();

        let preview = ProjectInfo { tempo: 120.0, notes: vec![note("a", 0.0, 500.0, 64)] };
        let (pcm, report) = engine.render_oneshot(preview).unwrap();
        assert!(pcm.iter().any(|s| s.abs() > 0.05));
        assert_eq!(report.rendered, 1);

        // The progressive session carries on as if nothing happened.
        assert_eq!(engine.plan_info().len(), 3);
        assert_eq!(engine.render_planned(&[1, 2]).unwrap(), 0);
        engine.end_stream(true).unwrap();
        assert_eq!(engine.report().rendered, 3);
    }

    #[test]
    fn an_abandoned_progressive_session_keeps_what_it_rendered() {
        let mut engine = Engine::new();
        engine.load_oto(b"a.wav=a,0,150,-100,40,20\n").unwrap();
        let audio = read_audio(&make_wav(1.0)).unwrap();
        let features = generate_features(&audio, AnalysisMode::Fast, None).unwrap();
        engine.cache_features("a.wav", features);
        let project = || ProjectInfo {
            tempo: 120.0,
            notes: (0..4).map(|i| note("a", i as f64 * 300.0, 300.0, 55 + i)).collect(),
        };
        engine.begin(project());
        engine.render_planned(&[0, 1]).unwrap();
        engine.end_stream(false).unwrap();
        engine.begin(project());
        while engine.step(8).unwrap() > 0 {}
        engine.end_stream(true).unwrap();
        let r = engine.report();
        assert_eq!((r.rendered, r.cached), (2, 2));
    }

    #[test]
    fn required_files_resolves_prefix_map() {
        let mut engine = Engine::new();
        engine.load_oto(b"a_hi.wav=a_hi,0,0,0,0,0\na.wav=a,0,0,0,0,0\n").unwrap();
        engine.load_prefix_map(b"C5=\t_hi\n");
        let (files, missing) = engine.required_files(&[
            note("a", 0.0, 1.0, 60),
            note("a", 0.0, 1.0, 72),
            note("q", 0.0, 1.0, 72),
        ]);
        assert_eq!(files, vec!["a.wav", "a_hi.wav"]);
        assert_eq!(missing, vec![2]);
    }

    #[test]
    fn flags_change_the_rendered_sound_without_breaking_it() {
        let mut engine = Engine::new();
        engine.load_oto(b"a.wav=a,0,150,-100,40,20\n").unwrap();
        let audio = read_audio(&make_wav(1.0)).unwrap();
        engine.cache_features("a.wav", generate_features(&audio, AnalysisMode::Fast, None).unwrap());

        let mut render = |flags: &str| {
            let mut n = note("a", 0.0, 600.0, 60);
            n.flags = flags.into();
            // The A flag reacts to pitch movement, so the note needs some.
            n.pitchbend = vec![
                PitchbendPointInfo { offset: 0.0, value: 0.0 },
                PitchbendPointInfo { offset: 300.0, value: 200.0 },
                PitchbendPointInfo { offset: 600.0, value: 0.0 },
            ];
            engine.begin(ProjectInfo { tempo: 120.0, notes: vec![n] });
            while engine.step(4).unwrap() > 0 {}
            engine.finish().unwrap()
        };
        let plain = render("");
        for flags in ["g60", "g-60", "A80", "fe300", "g30A40fe200fv15"] {
            let out = render(flags);
            assert!(out.iter().all(|s| s.is_finite()), "{flags}");
            assert!(out.iter().any(|s| s.abs() > 0.05), "{flags} is silent");
            assert_ne!(out, plain, "{flags} had no effect");
        }
    }
}
