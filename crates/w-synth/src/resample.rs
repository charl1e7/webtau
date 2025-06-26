use crate::flags::parser::Flags;
use crate::interpolator::interp::{self, Interpolator};
use crate::util::{self, smoothstep};
use crate::world::features::WorldFeatures;
use crate::world::synthesis::{synthesize_aperiodic, synthesize_harmonic};
use crate::{
    consts, filter,
    oto::{OtoEntry, OtoMap, PrefixMap},
};
use anyhow::{Result, anyhow};
use biquad::{DirectForm2Transposed, Q_BUTTERWORTH_F64};
use rand_distr::Distribution;
use std::collections::HashMap;

use crate::NoteInfo;

pub fn render_note(
    current_note: &NoteInfo,
    oto_entry: &OtoEntry,
    features_cache: &HashMap<String, WorldFeatures>,
    tempo: f64,
    prev_note_overlap_ms: f64,
    has_next_note_for_crossfade: bool,
) -> Result<Vec<f64>> {
    let features = features_cache
        .get(&oto_entry.filename)
        .ok_or_else(|| anyhow!("Features for file '{}' not found", oto_entry.filename))?;

    let flags: Flags = current_note.flags.replace("/", "").parse()?;
    let volume = current_note.volume / 100.0;

    let fps = 1000.0 / consts::FRAME_PERIOD;
    let feature_len_sec = features.f0.len() as f64 / fps;
    let src_offset_ms = oto_entry.offset;
    let src_consonant_ms = oto_entry.consonant;
    let src_preutterance_ms = oto_entry.preutterance;
    let src_overlap_ms = oto_entry.overlap;
    let out_fixed_dur_ms = src_consonant_ms;
    let out_stretch_dur_ms = (current_note.duration - out_fixed_dur_ms).max(0.0);
    let total_render_duration_ms = current_note.duration + src_overlap_ms;
    let src_offset_sec = src_offset_ms / 1000.0;
    let src_stretch_start_point_sec = src_offset_sec + (src_preutterance_ms / 1000.0);
    let src_stretch_end_point_sec = src_offset_sec + (src_consonant_ms / 1000.0);
    let src_cutoff_sec = if oto_entry.cutoff >= 0.0 {
        oto_entry.cutoff / 1000.0
    } else {
        feature_len_sec + (oto_entry.cutoff / 1000.0)
    }
    .clamp(src_stretch_end_point_sec, feature_len_sec);
    let src_preutterance_part_len_sec = (src_stretch_start_point_sec - src_offset_sec).max(0.0);
    let src_stretch_part_len_sec =
        (src_stretch_end_point_sec - src_stretch_start_point_sec).max(0.001);
    let src_tail_len_sec = (feature_len_sec - src_cutoff_sec).max(0.0);
    let total_render_frames = (total_render_duration_ms / 1000.0 * fps).round() as usize;
    let mut t_render: Vec<f64> = Vec::with_capacity(total_render_frames);

    for i in 0..total_render_frames {
        let current_out_time_ms = i as f64 * consts::FRAME_PERIOD;
        let src_time_sec: f64;

        if current_out_time_ms < src_preutterance_ms {
            src_time_sec = src_offset_sec + (current_out_time_ms / 1000.0);
        } else if current_out_time_ms < src_preutterance_ms + out_stretch_dur_ms {
            let time_in_stretch_out = current_out_time_ms - src_preutterance_ms;
            let ratio = if out_stretch_dur_ms > 0.0 {
                time_in_stretch_out / out_stretch_dur_ms
            } else {
                0.0
            };
            src_time_sec = src_stretch_start_point_sec + ratio * src_stretch_part_len_sec;
        } else {
            let time_in_fixed_end_out =
                current_out_time_ms - (src_preutterance_ms + out_stretch_dur_ms);
            src_time_sec = src_stretch_end_point_sec + (time_in_fixed_end_out / 1000.0);
        }

        let clamped_src_time_sec = src_time_sec.clamp(
            0.0,
            feature_len_sec - (1.0 / fps).min(feature_len_sec.max(0.001)),
        );
        t_render.push(clamped_src_time_sec * fps);
    }

    if t_render.is_empty() {
        return Err(anyhow!("Note duration is zero"));
    }
    let feature_length = features.f0.len();
    let vuv: Vec<bool> = features.f0.iter().map(|f0| *f0 != 0.0).collect();
    let f0_off: Vec<f64> = features
        .f0
        .iter()
        .map(|f0| {
            if *f0 == 0.0 {
                0.0
            } else {
                12.0 * (f0.log2() - features.base_f0.log2())
            }
        })
        .collect();

    let f0_off_interp = interp::Akima::new(&f0_off);
    let f0_off_render = f0_off_interp.sample_with_vec(&t_render);
    let vuv_render: Vec<bool> = t_render
        .iter()
        .map(|&i| vuv[(i as usize).clamp(0, feature_length - 1)])
        .collect();
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

    let render_length = t_render.len();
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
    let note_duration_ms = current_note.duration;
    let num_frames_in_note = (note_duration_ms / consts::FRAME_PERIOD).ceil() as usize;
    if num_frames_in_note == 0 {
        return Ok(vec![]);
    }
    let uniform_pitch_semitones: Vec<f64> = (0..num_frames_in_note)
        .map(|i| {
            let time_ms = i as f64 * consts::FRAME_PERIOD;
            match pitch_points.binary_search_by(|(t, _)| {
                t.partial_cmp(&time_ms).unwrap_or(std::cmp::Ordering::Equal)
            }) {
                Ok(i) => pitch_points[i].1,
                Err(i) => {
                    if i == 0 {
                        pitch_points[0].1
                    } else if i >= pitch_points.len() {
                        pitch_points.last().unwrap().1
                    } else {
                        let (t1, p1) = pitch_points[i - 1];
                        let (t2, p2) = pitch_points[i];
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
        .zip(vuv_render.iter())
        .map(|(pitch, vuv)| {
            if *vuv {
                util::midi_to_hz(*pitch + current_note.pitch as f64 + flags.pitch_offset / 100.0)
            } else {
                0.0
            }
        })
        .collect();

    let feature_dim = (consts::FFT_SIZE / 2 + 1) as usize;
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
    let harmonic_mix = 1.0 - 2.0 * (flags.breathiness / 100.0 - 0.5);

    let mut syn: Vec<f64> = syn_harmonic
        .iter()
        .zip(syn_aperiodic.iter())
        .map(|(hm, wh)| (hm * harmonic_mix + wh) * volume)
        .collect();
    let current_fade_in_ms = if prev_note_overlap_ms > 0.0 {
        prev_note_overlap_ms
    } else {
        0.0
    };
    let current_fade_out_ms = if has_next_note_for_crossfade {
        oto_entry.overlap
    } else {
        0.0
    };

    apply_crossfade_envelopes(
        &mut syn,
        current_fade_in_ms,
        current_fade_out_ms,
        src_preutterance_ms,
        current_note.duration,
        current_note.alias.starts_with("-"),
    );

    Ok(syn)
}

fn apply_crossfade_envelopes(
    pcm: &mut Vec<f64>,
    fade_in_len_ms: f64,
    fade_out_len_ms: f64,
    preutterance_ms_in_pcm: f64,
    note_duration_ms: f64,
    is_initial_note_alias: bool,
) {
    let sample_rate = consts::SAMPLE_RATE as f64;
    let total_smp = pcm.len();
    if total_smp == 0 {
        return;
    }

    // FADE IN
    if fade_in_len_ms > 0.0 && !is_initial_note_alias {
        let fade_in_len_smp = (fade_in_len_ms / 1000.0 * sample_rate).round() as usize;
        let effective_len = fade_in_len_smp.min(total_smp);
        for i in 0..effective_len {
            let ratio = i as f64 / (effective_len - 1).max(1) as f64;
            pcm[i] *= (std::f64::consts::PI / 2.0 * ratio).sin();
        }
    }

    // FADE OUT
    if fade_out_len_ms > 0.0 {
        let fade_out_len_smp = (fade_out_len_ms / 1000.0 * sample_rate).round() as usize;
        let note_body_end_ms = preutterance_ms_in_pcm + note_duration_ms;
        let fade_out_start_smp = (note_body_end_ms / 1000.0 * sample_rate).round() as usize;
        let actual_fade_start_smp = fade_out_start_smp.max(0).min(total_smp);
        let effective_len = (total_smp - actual_fade_start_smp).min(fade_out_len_smp);

        for i in 0..effective_len {
            let index = actual_fade_start_smp + i;
            if index < total_smp {
                let ratio = i as f64 / (effective_len - 1).max(1) as f64;
                pcm[index] *= (std::f64::consts::PI / 2.0 * (1.0 - ratio)).sin();
            }
        }
    }
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
            if oto_map.contains_key(&new_alias) {
                return new_alias;
            }
        }
    }
    note.alias.clone()
}

fn apply_crossfade(pcm: &mut Vec<f64>, preutterance_ms: f64, overlap_ms: f64, has_prev_note: bool) {
    let sample_rate = consts::SAMPLE_RATE as f64;
    let preutterance_smp = (preutterance_ms / 1000.0 * sample_rate).round() as usize;
    let overlap_smp = (overlap_ms / 1000.0 * sample_rate).round() as usize;
    let total_smp = pcm.len();

    if total_smp == 0 {
        return;
    }
    if has_prev_note && overlap_smp > 0 {
        let fade_in_end = preutterance_smp;
        let fade_in_start = (preutterance_smp as i32 - overlap_smp as i32).max(0) as usize;

        for i in fade_in_start..fade_in_end {
            if i < pcm.len() {
                let ratio = (i - fade_in_start) as f64 / (fade_in_end - fade_in_start) as f64;
                pcm[i] *= ratio;
            }
        }
    }
    if overlap_smp > 0 {
        let fade_out_start = (total_smp as i32 - overlap_smp as i32).max(0) as usize;
        let fade_out_end = total_smp;

        for i in fade_out_start..fade_out_end {
            if i < pcm.len() {
                let ratio = (i - fade_out_start) as f64 / (fade_out_end - fade_out_start) as f64;
                pcm[i] *= 1.0 - ratio;
            }
        }
    }
}
