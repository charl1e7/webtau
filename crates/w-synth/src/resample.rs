use crate::consts;
use crate::flags::parser::Flags;
use crate::interpolator::interp::{Akima, Interpolator};
use crate::oto::OtoEntry;
use crate::timing::NoteTiming;
use crate::util;
use crate::world::features::WorldFeatures;
use crate::world::synthesis::{synthesize_aperiodic, synthesize_harmonic};
use crate::NoteInfo;
use anyhow::{Result, anyhow};

/// Extra frames kept around the source window so that the spline of the
/// windowed column equals the spline of the full column.
const SPLINE_MARGIN: usize = 4;

pub struct RenderedNote {
    /// Mono PCM at `consts::SAMPLE_RATE`.
    pub pcm: Vec<f32>,
    /// Time between the first sample and the note start, in milliseconds.
    pub lead_ms: f64,
}

fn find_steady_vowel_frame(features: &WorldFeatures, src_attack_end_ms: f64) -> f64 {
    let total_frames = features.frames();
    if total_frames == 0 {
        return src_attack_end_ms + 100.0;
    }
    let wav_total_dur_ms = total_frames as f64 * consts::FRAME_PERIOD;

    let start_frame = (src_attack_end_ms / consts::FRAME_PERIOD).floor() as usize;
    let start_frame = start_frame.min(total_frames.saturating_sub(1));

    let mut best_frame = start_frame;
    let mut max_energy = f64::MIN;

    for k in start_frame..total_frames {
        let energy = features.mgc_at(k, 0) as f64;
        let is_voiced = features.f0[k] as f64 > consts::F0_FLOOR;
        let score = if is_voiced { energy + 10.0 } else { energy };
        if score > max_energy {
            max_energy = score;
            best_frame = k;
        }
    }

    let steady_ms = best_frame as f64 * consts::FRAME_PERIOD;
    steady_ms.clamp(
        src_attack_end_ms,
        (wav_total_dur_ms - 10.0).max(src_attack_end_ms),
    )
}

/// Interpolates `dims` columns of a flat row-major matrix at fractional
/// frame positions `points` (Akima spline, like the original engine). Only
/// the window of frames that the points actually touch is splined.
fn interpolate_rows(data: &[f32], frames: usize, dims: usize, points: &[f64]) -> Vec<Vec<f64>> {
    let lo_pos = points.iter().cloned().fold(f64::MAX, f64::min).max(0.0);
    let hi_pos = points.iter().cloned().fold(0.0, f64::max);
    let lo = (lo_pos.floor() as usize).saturating_sub(SPLINE_MARGIN);
    let hi = ((hi_pos.ceil() as usize) + SPLINE_MARGIN).min(frames - 1);
    let lo = lo.min(hi);

    let local: Vec<f64> = points.iter().map(|p| p - lo as f64).collect();
    let mut out = vec![vec![0.0f64; dims]; points.len()];
    let mut column = Vec::with_capacity(hi - lo + 1);
    for d in 0..dims {
        column.clear();
        column.extend((lo..=hi).map(|f| data[f * dims + d] as f64));
        let spline = Akima::new(&column);
        for (row, p) in out.iter_mut().zip(&local) {
            row[d] = spline.sample(*p);
        }
    }
    out
}

/// UTAU velocity: 100 is neutral, higher means a shorter consonant.
pub fn consonant_scale(velocity: f64) -> f64 {
    (1.0 - velocity / 100.0).exp2().clamp(0.25, 4.0)
}

pub fn render_note(
    note: &NoteInfo,
    oto: &OtoEntry,
    features: &WorldFeatures,
    timing: &NoteTiming,
) -> Result<RenderedNote> {
    let flags: Flags = note.flags.replace('/', "").parse()?;
    let volume = note.volume / 100.0;

    let fps = 1000.0 / consts::FRAME_PERIOD;
    let frames = features.frames();
    if frames == 0 {
        return Err(anyhow!("Empty features for file '{}'", oto.filename));
    }
    let feature_len_sec = frames as f64 / fps;
    let wav_total_dur_ms = feature_len_sec * 1000.0;

    let consonant_scale = consonant_scale(note.velocity);

    let src_offset_ms = oto.offset.max(0.0);
    let src_consonant_ms = oto.consonant.max(0.0);
    let src_preutterance_ms = oto.preutterance.max(0.0);
    let src_cutoff_ms = oto.cutoff;

    let src_attack_end_ms = if src_consonant_ms > 0.0 {
        (src_offset_ms + src_consonant_ms).min(wav_total_dur_ms)
    } else {
        (src_offset_ms + src_preutterance_ms + 40.0).min(wav_total_dur_ms)
    };

    let src_preutterance_point_ms = (src_offset_ms + src_preutterance_ms).min(src_attack_end_ms);
    let src_fixed_consonant_dur_ms = (src_attack_end_ms - src_preutterance_point_ms).max(0.0);

    let src_vowel_steady_ms = if src_cutoff_ms > 0.0 {
        (wav_total_dur_ms - src_cutoff_ms).max(src_attack_end_ms)
    } else if src_cutoff_ms < 0.0 {
        (src_offset_ms - src_cutoff_ms)
            .min(wav_total_dur_ms)
            .max(src_attack_end_ms)
    } else {
        find_steady_vowel_frame(features, src_attack_end_ms)
    };

    let note_dur_ms = note.duration.max(1.0);
    // The sound starts `preutter` before the note. When the previous note is too short for the full
    // preutterance it was shortened (see `timing`); then the beginning of the consonant is skipped
    // so that the sample still meets the note start at its preutterance point.
    let render_preutterance_ms = timing.preutter;
    let full_preutterance_ms = src_preutterance_ms * consonant_scale;
    let skip_src_ms = (full_preutterance_ms - render_preutterance_ms).max(0.0) / consonant_scale;
    let out_fixed_consonant_dur_ms =
        (src_fixed_consonant_dur_ms * consonant_scale).min(note_dur_ms);

    // Where the sound of the note ends: the next note's preutterance eats into it.
    let sound_end_ms = timing.end_ms(note_dur_ms);
    let current_fade_out_ms = timing.fade_out.min(sound_end_ms);
    let current_fade_in_ms = timing.fade_in.min(render_preutterance_ms + sound_end_ms);

    let total_render_duration_ms = render_preutterance_ms + sound_end_ms;
    let render_length = (total_render_duration_ms / 1000.0 * fps).round() as usize;
    if render_length == 0 {
        return Err(anyhow!("Note duration is zero"));
    }

    let max_src_sec = (feature_len_sec - 0.001).max(0.0);
    let t_render: Vec<f64> = (0..render_length)
        .map(|i| {
            let out_ms = i as f64 * consts::FRAME_PERIOD;
            let src_ms = if out_ms < render_preutterance_ms {
                src_offset_ms + skip_src_ms + out_ms / consonant_scale
            } else if out_ms < render_preutterance_ms + out_fixed_consonant_dur_ms {
                src_preutterance_point_ms + (out_ms - render_preutterance_ms) / consonant_scale
            } else {
                let t_in_vowel = out_ms - (render_preutterance_ms + out_fixed_consonant_dur_ms);
                (src_attack_end_ms + t_in_vowel).min(src_vowel_steady_ms)
            };
            (src_ms / 1000.0).clamp(0.0, max_src_sec) * fps
        })
        .collect();

    let mgc_render = interpolate_rows(&features.mgc, frames, features.mgc_dims(), &t_render);
    let bap_render = interpolate_rows(&features.bap, frames, features.bap_dims(), &t_render);

    let (mut f0_render, pitch_dev) =
        build_f0(note, &flags, render_length, render_preutterance_ms);
    let mut frame_gain = vec![1.0f64; render_length];
    apply_amplitude_flag(&mut frame_gain, &pitch_dev, flags.tremolo);
    apply_fry(
        &mut f0_render,
        &mut frame_gain,
        &flags,
        render_preutterance_ms,
        note_dur_ms,
    );

    let mut sp_render = rsworld::decode_spectral_envelope(
        &mgc_render,
        render_length as i32,
        consts::SAMPLE_RATE as i32,
        consts::FFT_SIZE,
    );
    drop(mgc_render);
    warp_formants(&mut sp_render, flags.gender);
    let ap_render = rsworld::decode_aperiodicity(
        &bap_render,
        render_length as i32,
        consts::SAMPLE_RATE as i32,
    );
    drop(bap_render);

    let syn_harmonic = synthesize_harmonic(&f0_render, &sp_render, &ap_render);
    let syn_aperiodic = synthesize_aperiodic(&f0_render, &mut sp_render, &ap_render, true);
    let harmonic_mix = (1.0 - 2.0 * (flags.breathiness / 100.0 - 0.5)).clamp(0.0, 1.0);

    let mut syn: Vec<f32> = syn_harmonic
        .iter()
        .zip(syn_aperiodic.iter())
        .map(|(hm, wh)| ((hm * harmonic_mix + wh) * volume) as f32)
        .collect();

    apply_frame_gain(&mut syn, &frame_gain);
    apply_crossfade_envelopes(&mut syn, current_fade_in_ms, current_fade_out_ms);

    Ok(RenderedNote {
        pcm: syn,
        lead_ms: render_preutterance_ms,
    })
}

/// Frame-wise F0 contour (Hz) of a note including its pitch bend points.
/// Returns the F0 contour (Hz) and the pitch-bend deviation (semitones) per frame.
///
/// Frame `i` of the render lies `lead_ms` before the note start, so it is at
/// note time `i * frame - lead_ms`; bend points are in note time (and may be
/// negative, e.g. a glide into the note). Before the first and after the last
/// point there is no deviation, except that a first point before the note
/// start is held until it.
fn build_f0(
    note: &NoteInfo,
    flags: &Flags,
    render_length: usize,
    lead_ms: f64,
) -> (Vec<f64>, Vec<f64>) {
    let mut pitch_points: Vec<(f64, f64)> = note
        .pitchbend
        .iter()
        .map(|p| (p.offset, p.value / 100.0))
        .collect();
    pitch_points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    if pitch_points.first().is_none_or(|p| p.0 > 0.0) {
        pitch_points.insert(0, (0.0, 0.0));
    }
    if pitch_points.last().is_some_and(|p| p.0 < note.duration) {
        pitch_points.push((note.duration, 0.0));
    }

    let dev: Vec<f64> = (0..render_length)
        .map(|i| {
            let time_ms = i as f64 * consts::FRAME_PERIOD - lead_ms;
            let idx = pitch_points.partition_point(|(t, _)| *t < time_ms);
            if idx == 0 {
                pitch_points[0].1
            } else if idx >= pitch_points.len() {
                pitch_points[pitch_points.len() - 1].1
            } else {
                let (t1, p1) = pitch_points[idx - 1];
                let (t2, p2) = pitch_points[idx];
                let seg = t2 - t1;
                let ratio = if seg.abs() < 1e-9 { 0.0 } else { (time_ms - t1) / seg };
                util::lerp(p1, p2, ratio)
            }
        })
        .collect();

    let base = note.pitch as f64 + flags.pitch_offset / 100.0;
    let hz = dev.iter().map(|d| util::midi_to_hz(d + base)).collect();
    (hz, dev)
}

/// `g` flag: shifts the formants by resampling every spectral envelope along
/// the frequency axis. Positive values move formants up (a brighter, younger
/// voice), negative values down (a deeper voice).
pub fn warp_formants(sp: &mut [Vec<f64>], gender: f64) {
    let g = gender.clamp(-100.0, 100.0);
    if g == 0.0 {
        return;
    }
    let shift = (g / 120.0).exp2();
    for frame in sp.iter_mut() {
        let n = frame.len();
        let src = frame.clone();
        for (k, out) in frame.iter_mut().enumerate() {
            let pos = (k as f64 / shift).min((n - 1) as f64);
            let lo = pos.floor() as usize;
            let hi = (lo + 1).min(n - 1);
            *out = util::lerp(src[lo], src[hi], pos - lo as f64);
        }
    }
}

/// `A` flag: the louder the pitch is bent upwards, the louder the voice
/// (and quieter when bent down), which emphasizes pitch movements.
pub fn apply_amplitude_flag(gain: &mut [f64], pitch_dev: &[f64], amount: f64) {
    if amount == 0.0 {
        return;
    }
    let a = amount.clamp(-100.0, 100.0) / 100.0;
    for (g, d) in gain.iter_mut().zip(pitch_dev) {
        *g *= (a * d / 2.0).exp2().clamp(0.1, 4.0);
    }
}

/// `fe` / `fl` / `fv` / `fp` flags: vocal fry. During the last `fe`
/// milliseconds of the note the pitch glides (over `fl` ms) to the fry pitch
/// `fp` Hz with an irregular wobble and the level drops by `fv` dB.
pub fn apply_fry(
    f0: &mut [f64],
    gain: &mut [f64],
    flags: &Flags,
    lead_ms: f64,
    note_dur_ms: f64,
) {
    if flags.fry_enable <= 0.0 {
        return;
    }
    let start = (note_dur_ms - flags.fry_enable).max(0.0);
    let ramp = flags.fry_transition.max(1.0);
    let fry_pitch = flags.fry_pitch.max(20.0);
    let drop = 10f64.powf(-flags.fry_volume / 20.0);
    for (i, (f, g)) in f0.iter_mut().zip(gain.iter_mut()).enumerate() {
        let t = i as f64 * consts::FRAME_PERIOD - lead_ms;
        let w = ((t - start) / ramp).clamp(0.0, 1.0);
        if w <= 0.0 {
            continue;
        }
        let w = w * w * (3.0 - 2.0 * w);
        // Deterministic jitter, different for every frame.
        let h = ((i as u32).wrapping_mul(2654435761) >> 16) as f64 / 65535.0;
        let wobble = 1.0 + 0.12 * (h - 0.5);
        *f = util::lerp(*f, fry_pitch * wobble, w);
        *g *= util::lerp(1.0, drop, w);
    }
}

/// Applies a per-frame gain curve (linearly interpolated) to PCM.
fn apply_frame_gain(pcm: &mut [f32], gain: &[f64]) {
    if gain.iter().all(|g| (*g - 1.0).abs() < 1e-9) {
        return;
    }
    let spf = consts::SAMPLE_RATE as f64 * consts::FRAME_PERIOD / 1000.0;
    for (i, s) in pcm.iter_mut().enumerate() {
        let pos = i as f64 / spf;
        let lo = (pos.floor() as usize).min(gain.len() - 1);
        let hi = (lo + 1).min(gain.len() - 1);
        *s *= util::lerp(gain[lo], gain[hi], pos - lo as f64) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{NoteInfo, PitchbendPointInfo};

    fn bent(points: &[(f64, f64)]) -> NoteInfo {
        NoteInfo {
            alias: "a".into(),
            pitch: 60,
            start_time: 0.0,
            duration: 400.0,
            pitchbend: points
                .iter()
                .map(|&(offset, value)| PitchbendPointInfo { offset, value })
                .collect(),
            flags: String::new(),
            velocity: 100.0,
            volume: 100.0,
            modulation: 0.0,
            track: 0,
        }
    }

    #[test]
    fn pitch_bend_follows_note_time_not_render_time() {
        // The sound starts 100 ms before the note. A slide from 0 to +600 cents over the first
        // 200 ms of the note must be at +300 cents 100 ms after the note start.
        let lead = 100.0;
        let note = bent(&[(0.0, 0.0), (200.0, 600.0)]);
        let flags: Flags = "".parse().unwrap();
        let (_, dev) = build_f0(&note, &flags, 200, lead);
        let at = |note_ms: f64| dev[((note_ms + lead) / consts::FRAME_PERIOD).round() as usize];
        assert!(at(-50.0).abs() < 1e-9, "the lead-in is not bent");
        assert!(at(0.0).abs() < 1e-9);
        assert!((at(100.0) - 3.0).abs() < 1e-6, "got {}", at(100.0));
        assert!((at(200.0) - 6.0).abs() < 1e-6);
    }

    #[test]
    fn pitch_points_before_the_note_start_are_used() {
        // A glide into the note: -400 cents 50 ms before the start, back to 0 at the start.
        let lead = 100.0;
        let note = bent(&[(-50.0, -400.0), (0.0, 0.0)]);
        let flags: Flags = "".parse().unwrap();
        let (_, dev) = build_f0(&note, &flags, 100, lead);
        let at = |note_ms: f64| dev[((note_ms + lead) / consts::FRAME_PERIOD).round() as usize];
        assert!((at(-50.0) + 4.0).abs() < 1e-6, "got {}", at(-50.0));
        assert!((at(-25.0) + 2.0).abs() < 1e-6);
        assert!(at(0.0).abs() < 1e-9);
    }

    fn peak(frame: &[f64]) -> usize {
        frame
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap()
            .0
    }

    #[test]
    fn gender_moves_spectral_peak() {
        let mut base = vec![0.01; 1025];
        base[100] = 1.0;
        let mut up = vec![base.clone()];
        warp_formants(&mut up, 100.0);
        let mut down = vec![base.clone()];
        warp_formants(&mut down, -100.0);
        assert!(peak(&up[0]) > 150, "up: {}", peak(&up[0]));
        assert!(peak(&down[0]) < 70, "down: {}", peak(&down[0]));
        let mut same = vec![base.clone()];
        warp_formants(&mut same, 0.0);
        assert_eq!(same[0], base);
    }

    #[test]
    fn fry_lowers_pitch_and_level_at_the_end() {
        let flags: Flags = "fe300fl50fv20fp80".parse().unwrap();
        let n = 100;
        let mut f0 = vec![440.0; n];
        let mut gain = vec![1.0; n];
        // note lasts 400 ms, no lead-in
        apply_fry(&mut f0, &mut gain, &flags, 0.0, 400.0);
        assert_eq!(f0[5], 440.0); // before the fry region
        assert!(f0[79] < 120.0, "{}", f0[79]);
        assert!(gain[79] < 0.2, "{}", gain[79]);
        assert_eq!(gain[5], 1.0);
    }

    #[test]
    fn amplitude_flag_follows_pitch_bend() {
        let mut gain = vec![1.0; 3];
        apply_amplitude_flag(&mut gain, &[0.0, 2.0, -2.0], 100.0);
        assert_eq!(gain[0], 1.0);
        assert!(gain[1] > 1.5 && gain[2] < 0.7);
    }

    // ---- more tests ---------------------------------------------------------------------------

    use crate::oto::OtoEntry;
    use crate::testutil::{estimate_f0, features};
    use crate::timing::NoteTiming;

    fn oto(offset: f64, consonant: f64, cutoff: f64, pre: f64, overlap: f64) -> OtoEntry {
        OtoEntry {
            filename: "a.wav".into(),
            alias: "a".into(),
            offset,
            consonant,
            cutoff,
            preutterance: pre,
            overlap,
        }
    }

    fn plain_timing(pre: f64) -> NoteTiming {
        NoteTiming { preutter: pre, overlap: 0.0, fade_in: 5.0, tail_adjust: 0.0, fade_out: 35.0 }
    }

    #[test]
    fn the_crossfade_envelopes_start_and_end_at_silence_and_stay_in_bounds() {
        let mut pcm = vec![1.0f32; 4410];
        apply_crossfade_envelopes(&mut pcm, 20.0, 30.0);
        assert!(pcm[0].abs() < 1e-6);
        assert!(pcm[pcm.len() - 1].abs() < 1e-6);
        assert!(pcm.iter().all(|s| (0.0..=1.0001).contains(s)));
        assert!((pcm[2000] - 1.0).abs() < 1e-6, "untouched in the middle");
        // Rising during the fade-in, falling during the fade-out.
        let n_in = (0.020 * 44100.0) as usize;
        assert!(pcm[..n_in].windows(2).all(|w| w[1] >= w[0]));
        let n_out = (0.030 * 44100.0) as usize;
        let tail = &pcm[pcm.len() - n_out..];
        assert!(tail.windows(2).all(|w| w[1] <= w[0]));
    }

    #[test]
    fn fades_longer_than_the_sound_or_on_nothing_do_not_panic() {
        let mut pcm = vec![1.0f32; 100];
        apply_crossfade_envelopes(&mut pcm, 500.0, 500.0);
        assert!(pcm.iter().all(|s| s.is_finite() && *s >= 0.0 && *s <= 1.0));
        let mut empty: Vec<f32> = vec![];
        apply_crossfade_envelopes(&mut empty, 10.0, 10.0);
        let mut one = vec![1.0f32];
        apply_crossfade_envelopes(&mut one, 10.0, 10.0);
        assert!(one[0].is_finite());
        let mut none = vec![0.5f32; 10];
        apply_crossfade_envelopes(&mut none, 0.0, -5.0);
        assert!(none.iter().all(|s| *s == 0.5));
    }

    #[test]
    fn the_windowed_spline_equals_the_spline_of_the_whole_column() {
        let frames = 80;
        let dims = 3;
        let mut seed = 5u64;
        let data: Vec<f32> = (0..frames * dims)
            .map(|_| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                ((seed >> 40) as f32 / (1u64 << 24) as f32) * 10.0 - 5.0
            })
            .collect();
        for (lo, hi) in [(10.0, 30.0), (0.0, 12.5), (60.2, 79.0), (30.0, 30.0)] {
            let points: Vec<f64> = (0..20).map(|i| lo + (hi - lo) * i as f64 / 19.0).collect();
            let windowed = interpolate_rows(&data, frames, dims, &points);
            for d in 0..dims {
                let column: Vec<f64> = (0..frames).map(|f| data[f * dims + d] as f64).collect();
                let full = Akima::new(&column);
                for (row, p) in windowed.iter().zip(&points) {
                    let expected = full.sample(*p);
                    // Away from the ends of the whole column the two must agree exactly.
                    if *p > 3.0 && *p < frames as f64 - 4.0 {
                        assert!((row[d] - expected).abs() < 1e-9, "window {lo}..{hi}, point {p}: {} vs {expected}", row[d]);
                    }
                }
            }
        }
    }

    #[test]
    fn interpolating_at_nothing_or_a_single_frame_is_fine() {
        let data = vec![1.0f32, 2.0, 3.0, 4.0];
        let out = interpolate_rows(&data, 2, 2, &[0.5]);
        assert_eq!(out.len(), 1);
        assert!((out[0][0] - 2.0).abs() < 1e-9 && (out[0][1] - 3.0).abs() < 1e-9);
        let single = interpolate_rows(&[7.0f32, 8.0], 1, 2, &[0.0, 3.0, -2.0]);
        assert_eq!(single.len(), 3);
        for row in single {
            assert_eq!(row, vec![7.0, 8.0]);
        }
    }

    #[test]
    fn the_steady_vowel_frame_stays_inside_the_sample() {
        let f = features(1.0);
        let total_ms = f.frames() as f64 * consts::FRAME_PERIOD;
        for attack in [0.0, 50.0, 400.0, total_ms - 5.0, total_ms + 1000.0] {
            let steady = find_steady_vowel_frame(&f, attack);
            assert!(steady >= attack.min(steady), "{attack} -> {steady}");
            assert!(steady.is_finite());
            if attack < total_ms - 10.0 {
                assert!(steady <= total_ms, "{attack} -> {steady}");
            }
        }
    }

    #[test]
    fn the_sung_pitch_is_the_requested_pitch_not_the_pitch_of_the_sample() {
        let f = features(1.0); // a 220 Hz sample
        let entry = oto(0.0, 150.0, -100.0, 40.0, 20.0);
        for (pitch, hz) in [(57, 220.0), (69, 440.0), (72, 523.25), (48, 130.81), (81, 880.0)] {
            let mut n = bent(&[]);
            n.pitch = pitch;
            n.duration = 600.0;
            let r = render_note(&n, &entry, &f, &plain_timing(40.0)).unwrap();
            let mid = (r.lead_ms / 1000.0 * 44100.0) as usize + 8000;
            let got = estimate_f0(&r.pcm, mid, mid + 4000);
            assert!((got / hz - 1.0).abs() < 0.03, "pitch {pitch}: wanted {hz} Hz, got {got:.1} Hz");
        }
    }

    #[test]
    fn a_bend_changes_the_sung_pitch_by_that_many_cents() {
        let f = features(1.0);
        let entry = oto(0.0, 150.0, -100.0, 40.0, 20.0);
        let mut flat = bent(&[]);
        flat.duration = 600.0;
        let mut up = bent(&[(0.0, 1200.0), (600.0, 1200.0)]);
        up.duration = 600.0;
        let a = render_note(&flat, &entry, &f, &plain_timing(40.0)).unwrap();
        let b = render_note(&up, &entry, &f, &plain_timing(40.0)).unwrap();
        let at = |r: &RenderedNote| {
            let mid = (r.lead_ms / 1000.0 * 44100.0) as usize + 8000;
            estimate_f0(&r.pcm, mid, mid + 4000)
        };
        assert!((at(&b) / at(&a) - 2.0).abs() < 0.06, "{} vs {}", at(&b), at(&a));
    }

    #[test]
    fn length_lead_and_silence_follow_the_timing() {
        let f = features(1.0);
        let entry = oto(0.0, 150.0, -100.0, 40.0, 20.0);
        let mut n = bent(&[]);
        n.duration = 500.0;
        let timing = NoteTiming { preutter: 40.0, overlap: 0.0, fade_in: 5.0, tail_adjust: -60.0, fade_out: 20.0 };
        let r = render_note(&n, &entry, &f, &timing).unwrap();
        assert_eq!(r.lead_ms, 40.0);
        // lead + (duration + tail_adjust) = 480 ms, to within a frame.
        let ms = r.pcm.len() as f64 / 44.1;
        assert!((ms - 480.0).abs() <= consts::FRAME_PERIOD + 1.0, "{ms}");
        assert!(r.pcm[0].abs() < 0.02, "starts at silence");
        assert!(r.pcm[r.pcm.len() - 1].abs() < 0.02, "ends at silence");
        assert!(r.pcm.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn volume_scales_the_output_and_zero_is_silent() {
        let f = features(1.0);
        let entry = oto(0.0, 150.0, -100.0, 40.0, 20.0);
        let render = |volume: f64| {
            let mut n = bent(&[]);
            n.volume = volume;
            render_note(&n, &entry, &f, &plain_timing(40.0)).unwrap().pcm
        };
        let rms = |v: &[f32]| (v.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / v.len() as f64).sqrt();
        let full = rms(&render(100.0));
        assert!((rms(&render(50.0)) / full - 0.5).abs() < 0.02);
        assert!((rms(&render(200.0)) / full - 2.0).abs() < 0.05);
        assert!(rms(&render(0.0)) < 1e-9);
    }

    #[test]
    fn a_shorter_consonant_with_higher_velocity_shortens_the_lead() {
        // Velocity scales the preutterance the engine plans with (see consonant_scale).
        assert!(consonant_scale(200.0) < consonant_scale(100.0));
        assert!(consonant_scale(0.0) > consonant_scale(100.0));
        assert_eq!(consonant_scale(100.0), 1.0);
        assert_eq!(consonant_scale(1e9), 0.25);
        assert_eq!(consonant_scale(-1e9), 4.0);
    }

    #[test]
    fn an_empty_feature_set_is_an_error_not_a_crash() {
        let mut f = features(0.5);
        f.f0.clear();
        f.mgc.clear();
        f.bap.clear();
        let n = bent(&[]);
        assert!(render_note(&n, &oto(0.0, 0.0, 0.0, 0.0, 0.0), &f, &plain_timing(0.0)).is_err());
    }

    #[test]
    fn the_pitch_offset_flag_transposes() {
        let note = bent(&[]);
        let flags: Flags = "t1200".parse().unwrap();
        let (hz, dev) = build_f0(&note, &flags, 10, 0.0);
        assert!(dev.iter().all(|d| d.abs() < 1e-12), "the flag is not a bend");
        assert!((hz[0] / util::midi_to_hz(60.0) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn fry_without_the_flag_changes_nothing() {
        let flags: Flags = "".parse().unwrap();
        let mut f0 = vec![300.0; 20];
        let mut gain = vec![1.0; 20];
        apply_fry(&mut f0, &mut gain, &flags, 0.0, 100.0);
        assert!(f0.iter().all(|v| *v == 300.0) && gain.iter().all(|g| *g == 1.0));
    }

}

fn apply_crossfade_envelopes(pcm: &mut [f32], fade_in_len_ms: f64, fade_out_len_ms: f64) {
    let sample_rate = consts::SAMPLE_RATE as f64;
    let total = pcm.len();
    if total == 0 {
        return;
    }

    if fade_in_len_ms > 0.0 {
        let len = ((fade_in_len_ms / 1000.0 * sample_rate).round() as usize).min(total);
        for (i, s) in pcm[..len].iter_mut().enumerate() {
            let ratio = i as f64 / (len - 1).max(1) as f64;
            *s *= (std::f64::consts::FRAC_PI_2 * ratio).sin() as f32;
        }
    }

    if fade_out_len_ms > 0.0 {
        let len = ((fade_out_len_ms / 1000.0 * sample_rate).round() as usize).min(total);
        let start = total - len;
        for (i, s) in pcm[start..].iter_mut().enumerate() {
            let ratio = i as f64 / (len - 1).max(1) as f64;
            *s *= (std::f64::consts::FRAC_PI_2 * (1.0 - ratio)).sin() as f32;
        }
    }
}
