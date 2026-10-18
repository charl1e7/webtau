//! Helpers shared by the tests of several modules.
use crate::audio::read_write::read_audio;
use crate::consts;
use crate::world::features::{AnalysisMode, WorldFeatures, generate_features};

/// 16-bit mono PCM WAV of a vowel-like harmonic tone at `f0` Hz with a noisy attack.
pub fn make_wav_at(seconds: f64, f0: f64) -> Vec<u8> {
    let sr = consts::SAMPLE_RATE;
    let n = (seconds * sr as f64) as usize;
    let mut pcm = Vec::with_capacity(n * 2);
    let mut seed = 12345u32;
    for i in 0..n {
        let t = i as f64 / sr as f64;
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

/// Analyzed features of a 220 Hz tone of the given length.
pub fn features(seconds: f64) -> WorldFeatures {
    let audio = read_audio(&make_wav_at(seconds, 220.0)).unwrap();
    generate_features(&audio, AnalysisMode::Fast, None).unwrap()
}

/// Rough fundamental frequency of `pcm` between `from` and `to` (samples), by autocorrelation.
pub fn estimate_f0(pcm: &[f32], from: usize, to: usize) -> f64 {
    let seg = &pcm[from..to.min(pcm.len())];
    let sr = consts::SAMPLE_RATE as f64;
    let (lo, hi) = ((sr / 1500.0) as usize, (sr / 70.0) as usize);
    let mut best = (0.0f64, lo);
    for lag in lo..hi.min(seg.len() / 2) {
        let mut sum = 0.0f64;
        for i in 0..seg.len() - lag {
            sum += seg[i] as f64 * seg[i + lag] as f64;
        }
        if sum > best.0 {
            best = (sum, lag);
        }
    }
    sr / best.1 as f64
}
