use crate::consts;
use crate::flags::parser::Flags;
use crate::interpolator::interp::{Akima, Interpolator};
use crate::oto::OtoEntry;
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

pub fn render_note(
    note: &NoteInfo,
    oto: &OtoEntry,
    features: &WorldFeatures,
    has_next_note_for_crossfade: bool,
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

    // UTAU velocity: 100 is neutral, higher means a shorter consonant.
    let consonant_scale = (1.0 - note.velocity / 100.0).exp2().clamp(0.25, 4.0);

    let src_offset_ms = oto.offset.max(0.0);
    let src_consonant_ms = oto.consonant.max(0.0);
    let src_preutterance_ms = oto.preutterance.max(0.0);
    let src_cutoff_ms = oto.cutoff;
    let src_overlap_ms = oto.overlap.max(0.0);

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
    let render_preutterance_ms = src_preutterance_ms * consonant_scale;
    let out_fixed_consonant_dur_ms =
        (src_fixed_consonant_dur_ms * consonant_scale).min(note_dur_ms);

    let current_fade_out_ms = if has_next_note_for_crossfade {
        src_overlap_ms.max(30.0)
    } else {
        20.0
    };

    let total_render_duration_ms = render_preutterance_ms + note_dur_ms + current_fade_out_ms;
    let render_length = (total_render_duration_ms / 1000.0 * fps).round() as usize;
    if render_length == 0 {
        return Err(anyhow!("Note duration is zero"));
    }

    let max_src_sec = (feature_len_sec - 0.001).max(0.0);
    let t_render: Vec<f64> = (0..render_length)
        .map(|i| {
            let out_ms = i as f64 * consts::FRAME_PERIOD;
            let src_ms = if out_ms < render_preutterance_ms {
                src_offset_ms + out_ms / consonant_scale
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

    let f0_render = build_f0(note, &flags, render_length, note_dur_ms);

    let mut sp_render = rsworld::decode_spectral_envelope(
        &mgc_render,
        render_length as i32,
        consts::SAMPLE_RATE as i32,
        consts::FFT_SIZE,
    );
    drop(mgc_render);
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

    apply_crossfade_envelopes(&mut syn, render_preutterance_ms, current_fade_out_ms);

    Ok(RenderedNote {
        pcm: syn,
        lead_ms: render_preutterance_ms,
    })
}

/// Frame-wise F0 contour (Hz) of a note including its pitch bend points.
fn build_f0(note: &NoteInfo, flags: &Flags, render_length: usize, note_dur_ms: f64) -> Vec<f64> {
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

    let num_frames_in_note = ((note_dur_ms / consts::FRAME_PERIOD).ceil() as usize).max(2);
    let uniform: Vec<f64> = (0..num_frames_in_note)
        .map(|i| {
            let time_ms = i as f64 * consts::FRAME_PERIOD;
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

    let spline = Akima::new(&uniform);
    let base = note.pitch as f64 + flags.pitch_offset / 100.0;
    (0..render_length)
        .map(|i| util::midi_to_hz(spline.sample(i as f64) + base))
        .collect()
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
