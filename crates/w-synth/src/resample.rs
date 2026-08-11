use crate::flags::parser::Flags;
use crate::interpolator::interp::{self, Interpolator};
use crate::util;
use crate::world::features::WorldFeatures;
use crate::world::synthesis::{synthesize_aperiodic, synthesize_harmonic};
use crate::{
    consts,
    oto::{OtoEntry, OtoMap, PrefixMap},
};
use anyhow::{Result, anyhow};
use std::collections::HashMap;

use crate::NoteInfo;

pub fn find_features<'a>(
    cache: &'a HashMap<String, WorldFeatures>,
    filename: &str,
) -> Option<&'a WorldFeatures> {
    if let Some(f) = cache.get(filename) {
        return Some(f);
    }
    let clean_name = filename
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or(filename)
        .to_string();
    if let Some(f) = cache.get(&clean_name) {
        return Some(f);
    }
    let clean_lower = clean_name.to_lowercase();
    for (k, v) in cache {
        let k_clean = k
            .replace('\\', "/")
            .split('/')
            .last()
            .unwrap_or(k)
            .to_lowercase();
        if k_clean == clean_lower {
            return Some(v);
        }
    }
    None
}

fn find_steady_vowel_frame(features: &WorldFeatures, src_attack_end_ms: f64) -> f64 {
    let total_frames = features.mgc.len();
    if total_frames == 0 {
        return src_attack_end_ms + 100.0;
    }
    let wav_total_dur_ms = total_frames as f64 * consts::FRAME_PERIOD;

    let start_frame = (src_attack_end_ms / consts::FRAME_PERIOD).floor() as usize;
    let start_frame = start_frame.min(total_frames.saturating_sub(1));

    let mut best_frame = start_frame;
    let mut max_energy = -1e9f64;

    for k in start_frame..total_frames {
        if k < features.mgc.len() && !features.mgc[k].is_empty() {
            let energy = features.mgc[k][0];
            let is_voiced = k < features.f0.len() && features.f0[k] > consts::F0_FLOOR;
            let score = if is_voiced { energy + 10.0 } else { energy };

            if score > max_energy {
                max_energy = score;
                best_frame = k;
            }
        }
    }

    let steady_ms = best_frame as f64 * consts::FRAME_PERIOD;
    steady_ms.clamp(src_attack_end_ms, (wav_total_dur_ms - 10.0).max(src_attack_end_ms))
}

pub fn render_note(
    current_note: &NoteInfo,
    oto_entry: &OtoEntry,
    features_cache: &HashMap<String, WorldFeatures>,
    _tempo: f64,
    _prev_note_overlap_ms: f64,
    has_next_note_for_crossfade: bool,
) -> Result<Vec<f64>> {
    let features = find_features(features_cache, &oto_entry.filename)
        .ok_or_else(|| anyhow!("Features for file '{}' not found", oto_entry.filename))?;

    let flags: Flags = current_note.flags.replace("/", "").parse()?;
    let volume = current_note.volume / 100.0;

    let fps = 1000.0 / consts::FRAME_PERIOD;
    let feature_length = features.f0.len();
    if feature_length == 0 {
        return Err(anyhow!("Empty features for file '{}'", oto_entry.filename));
    }
    let feature_len_sec = feature_length as f64 / fps;
    let wav_total_dur_ms = feature_len_sec * 1000.0;

    let src_offset_ms = oto_entry.offset.max(0.0);
    let src_consonant_ms = oto_entry.consonant.max(0.0);
    let src_preutterance_ms = oto_entry.preutterance.max(0.0);
    let src_cutoff_ms = oto_entry.cutoff;
    let src_overlap_ms = oto_entry.overlap.max(0.0);

    let src_attack_end_ms = if src_consonant_ms > 0.0 {
        (src_offset_ms + src_consonant_ms).min(wav_total_dur_ms)
    } else {
        (src_offset_ms + src_preutterance_ms + 40.0).min(wav_total_dur_ms)
    };

    let src_preutterance_point_ms =
        (src_offset_ms + src_preutterance_ms).min(src_attack_end_ms);
    let src_fixed_consonant_dur_ms =
        (src_attack_end_ms - src_preutterance_point_ms).max(0.0);

    let src_vowel_steady_ms = if src_cutoff_ms > 0.0 {
        (wav_total_dur_ms - src_cutoff_ms).max(src_attack_end_ms)
    } else if src_cutoff_ms < 0.0 {
        (src_offset_ms - src_cutoff_ms)
            .min(wav_total_dur_ms)
            .max(src_attack_end_ms)
    } else {
        find_steady_vowel_frame(features, src_attack_end_ms)
    };

    let render_preutterance_ms = src_preutterance_ms;
    let preutterance_start_in_src_ms =
        src_offset_ms + (src_preutterance_ms - render_preutterance_ms);

    let note_dur_ms = current_note.duration.max(1.0);
    let out_fixed_consonant_dur_ms = src_fixed_consonant_dur_ms.min(note_dur_ms);

    let current_fade_out_ms = if has_next_note_for_crossfade {
        src_overlap_ms.max(30.0)
    } else {
        20.0
    };

    let total_render_duration_ms =
        render_preutterance_ms + note_dur_ms + current_fade_out_ms;

    let total_render_frames =
        (total_render_duration_ms / 1000.0 * fps).round() as usize;
    if total_render_frames == 0 {
        return Err(anyhow!("Note duration is zero"));
    }

    let mut t_render: Vec<f64> = Vec::with_capacity(total_render_frames);

    for i in 0..total_render_frames {
        let current_out_time_ms = i as f64 * consts::FRAME_PERIOD;
        let src_time_ms: f64;

        if current_out_time_ms < render_preutterance_ms {
            src_time_ms = preutterance_start_in_src_ms + current_out_time_ms;
        } else if current_out_time_ms < render_preutterance_ms + out_fixed_consonant_dur_ms {
            let t_in_consonant = current_out_time_ms - render_preutterance_ms;
            src_time_ms = src_preutterance_point_ms + t_in_consonant;
        } else {
            let t_in_vowel =
                current_out_time_ms - (render_preutterance_ms + out_fixed_consonant_dur_ms);
            src_time_ms = (src_attack_end_ms + t_in_vowel).min(src_vowel_steady_ms);
        }

        let clamped_src_time_sec =
            (src_time_ms / 1000.0).clamp(0.0, (feature_len_sec - 0.001).max(0.0));
        t_render.push(clamped_src_time_sec * fps);
    }

    let render_length = t_render.len();

    let mgc_render = interp::interpolate_first_axis(
        features.mgc.clone(),
        &t_render,
        interp::InterpolatorType::Akima,
    );
    let bap_render = interp::interpolate_first_axis(
        features.bap.clone(),
        &t_render,
        interp::InterpolatorType::Akima,
    );

    let mut pitch_points: Vec<(f64, f64)> = current_note
        .pitchbend
        .iter()
        .map(|p| (p.offset, p.value / 100.0))
        .collect();
    if pitch_points.is_empty() || pitch_points.first().map_or(false, |p| p.0 > 0.0) {
        pitch_points.insert(0, (0.0, 0.0));
    }
    if pitch_points
        .last()
        .map_or(false, |p| p.0 < current_note.duration)
    {
        pitch_points.push((current_note.duration, 0.0));
    }

    let num_frames_in_note = (note_dur_ms / consts::FRAME_PERIOD).ceil() as usize;
    if num_frames_in_note == 0 {
        return Ok(vec![]);
    }
    let uniform_pitch_semitones: Vec<f64> = (0..num_frames_in_note)
        .map(|i| {
            let time_ms = i as f64 * consts::FRAME_PERIOD;
            match pitch_points.binary_search_by(|(t, _)| {
                t.partial_cmp(&time_ms).unwrap_or(std::cmp::Ordering::Equal)
            }) {
                Ok(idx) => pitch_points[idx].1,
                Err(idx) => {
                    if idx == 0 {
                        pitch_points[0].1
                    } else if idx >= pitch_points.len() {
                        pitch_points.last().unwrap().1
                    } else {
                        let (t1, p1) = pitch_points[idx - 1];
                        let (t2, p2) = pitch_points[idx];
                        let segment_duration = t2 - t1;
                        let ratio = if segment_duration.abs() < 1e-9 {
                            0.0
                        } else {
                            (time_ms - t1) / segment_duration
                        };
                        util::lerp(p1, p2, ratio)
                    }
                }
            }
        })
        .collect();

    let pitch_interp = interp::Akima::new(&uniform_pitch_semitones);
    let pitch_render: Vec<f64> = (0..render_length)
        .map(|i| {
            let time_ms = i as f64 * consts::FRAME_PERIOD;
            let frame_pos = time_ms / consts::FRAME_PERIOD;
            pitch_interp.sample(frame_pos)
        })
        .collect();

    let f0_render: Vec<f64> = pitch_render
        .iter()
        .map(|pitch| {
            util::midi_to_hz(*pitch + current_note.pitch as f64 + flags.pitch_offset / 100.0)
        })
        .collect();

    let mut sp_render = rsworld::decode_spectral_envelope(
        &mgc_render,
        render_length as i32,
        consts::SAMPLE_RATE as i32,
        consts::FFT_SIZE,
    );
    let ap_render = rsworld::decode_aperiodicity(
        &bap_render,
        render_length as i32,
        consts::SAMPLE_RATE as i32,
    );

    let syn_harmonic: Vec<f64> = synthesize_harmonic(&f0_render, &sp_render, &ap_render);
    let syn_aperiodic: Vec<f64> =
        synthesize_aperiodic(&f0_render, &mut sp_render, &ap_render, true);
    let harmonic_mix = (1.0 - 2.0 * (flags.breathiness / 100.0 - 0.5)).clamp(0.0, 1.0);

    let mut syn: Vec<f64> = syn_harmonic
        .iter()
        .zip(syn_aperiodic.iter())
        .map(|(hm, wh)| (hm * harmonic_mix + wh) * volume)
        .collect();

    apply_crossfade_envelopes(&mut syn, render_preutterance_ms, current_fade_out_ms);

    Ok(syn)
}

fn apply_crossfade_envelopes(pcm: &mut Vec<f64>, fade_in_len_ms: f64, fade_out_len_ms: f64) {
    let sample_rate = consts::SAMPLE_RATE as f64;
    let total_smp = pcm.len();
    if total_smp == 0 {
        return;
    }

    if fade_in_len_ms > 0.0 {
        let fade_in_len_smp = (fade_in_len_ms / 1000.0 * sample_rate).round() as usize;
        let effective_len = fade_in_len_smp.min(total_smp);
        for i in 0..effective_len {
            let ratio = i as f64 / (effective_len - 1).max(1) as f64;
            pcm[i] *= (std::f64::consts::PI / 2.0 * ratio).sin();
        }
    }

    if fade_out_len_ms > 0.0 {
        let fade_out_len_smp = (fade_out_len_ms / 1000.0 * sample_rate).round() as usize;
        let effective_len = fade_out_len_smp.min(total_smp);
        let start_smp = total_smp - effective_len;

        for i in 0..effective_len {
            let ratio = i as f64 / (effective_len - 1).max(1) as f64;
            pcm[start_smp + i] *= (std::f64::consts::PI / 2.0 * (1.0 - ratio)).sin();
        }
    }
}

pub fn find_oto_entry<'a>(oto_map: &'a OtoMap, alias: &str) -> Option<&'a OtoEntry> {
    if let Some(entry) = oto_map.get(alias) {
        return Some(entry);
    }
    let alias_trimmed = alias.trim();
    if let Some(entry) = oto_map.get(alias_trimmed) {
        return Some(entry);
    }
    let alias_lower = alias_trimmed.to_lowercase();
    for (k, v) in oto_map {
        if k.trim().to_lowercase() == alias_lower {
            return Some(v);
        }
    }
    None
}

pub fn resolve_alias(note: &NoteInfo, prefix_map: &PrefixMap, oto_map: &OtoMap) -> String {
    if prefix_map.is_empty() {
        return note.alias.clone();
    }
    let mut best_pitch_key = -1;
    for &key in prefix_map.keys() {
        if key <= note.pitch && key > best_pitch_key {
            best_pitch_key = key;
        }
    }

    if best_pitch_key != -1 {
        if let Some(suffix) = prefix_map.get(&best_pitch_key) {
            let new_alias = format!("{}{}", note.alias, suffix);
            if find_oto_entry(oto_map, &new_alias).is_some() {
                return new_alias;
            }
        }
    }
    note.alias.clone()
}