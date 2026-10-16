use crate::consts;
use anyhow::{Result, anyhow};
use oxicode::{Decode, Encode};
use rsworld::{
    cheaptrick, code_aperiodicity, code_spectral_envelope, d4c, dio, get_number_of_aperiodicities,
    harvest, stonemask,
};
use rsworld_sys::{CheapTrickOption, D4COption, DioOption, HarvestOption};

/// Which F0 estimator the analyzer uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnalysisMode {
    /// Harvest: slow but accurate (default of the original engine).
    Accurate,
    /// DIO + StoneMask: several times faster, slightly less robust.
    Fast,
}

impl AnalysisMode {
    pub fn from_u32(v: u32) -> Self {
        if v == 1 { Self::Fast } else { Self::Accurate }
    }
}

/// Spectral features of one sample file. Matrices are stored flat
/// (row-major, one row per 5 ms frame) in f32 to keep them small to
/// serialize, to cache and to copy.
#[derive(Clone, Debug, Decode, Encode)]
pub struct WorldFeatures {
    pub base_f0: f32,
    pub f0: Vec<f32>,
    pub mgc: Vec<f32>,
    pub bap: Vec<f32>,
    pub mgc_dims: u32,
    pub bap_dims: u32,
}

impl WorldFeatures {
    pub fn frames(&self) -> usize {
        self.f0.len()
    }
    pub fn mgc_dims(&self) -> usize {
        self.mgc_dims as usize
    }
    pub fn bap_dims(&self) -> usize {
        self.bap_dims as usize
    }
    pub fn mgc_at(&self, frame: usize, dim: usize) -> f32 {
        self.mgc[frame * self.mgc_dims() + dim]
    }
}

fn calculate_base_f0(f0: &[f64]) -> f64 {
    let n = f0.len();
    let mut base_f0 = 0.;
    let mut tally = 0.;

    for i in 0..n {
        if f0[i] >= consts::F0_FLOOR && f0[i] <= consts::F0_CEIL {
            let q = if n < 2 {
                0.
            } else if i == 0 {
                f0[1] - f0[0]
            } else if i == n - 1 {
                f0[n - 2] - f0[n - 1]
            } else {
                0.5 * (f0[i + 1] - f0[i - 1])
            };

            let weight = (-q * q).exp2();
            base_f0 += f0[i] * weight;
            tally += weight;
        }
    }

    if tally > 0. {
        base_f0 /= tally;
    } else {
        base_f0 = 220.0;
    }
    if base_f0 <= 0.0 || !base_f0.is_finite() {
        base_f0 = 220.0;
    }
    base_f0
}

fn estimate_f0(audio: &Vec<f64>, mode: AnalysisMode) -> (Vec<f64>, Vec<f64>) {
    let fs = consts::SAMPLE_RATE as i32;
    match mode {
        AnalysisMode::Accurate => {
            let opts = HarvestOption {
                f0_floor: consts::F0_FLOOR,
                f0_ceil: consts::F0_CEIL,
                frame_period: consts::FRAME_PERIOD,
            };
            harvest(audio, fs, &opts)
        }
        AnalysisMode::Fast => {
            let mut opts = DioOption::new();
            opts.f0_floor = consts::F0_FLOOR;
            opts.f0_ceil = consts::F0_CEIL;
            opts.frame_period = consts::FRAME_PERIOD;
            opts.speed = 2;
            let (t, f0) = dio(audio, fs, &opts);
            let refined = stonemask(audio, fs, &t, &f0);
            (t, refined)
        }
    }
}

pub fn generate_features(
    audio: &Vec<f64>,
    mode: AnalysisMode,
    threshold: Option<f64>,
) -> Result<WorldFeatures> {
    if audio.len() < consts::FFT_SIZE as usize {
        return Err(anyhow!(
            "Audio signal is too short for analysis. At least {} samples are required, found {}.",
            consts::FFT_SIZE,
            audio.len()
        ));
    }
    let fs = consts::SAMPLE_RATE as i32;
    let d4c_opts = D4COption {
        threshold: threshold.unwrap_or(consts::D4C_THRESHOLD),
    };
    let mut cheaptrick_opts = CheapTrickOption {
        q1: consts::SPEC_Q1,
        f0_floor: consts::F0_FLOOR,
        fft_size: consts::FFT_SIZE,
    };

    let (t, f0) = estimate_f0(audio, mode);
    let frames = f0.len();
    let mgc_dims = consts::MGC_DIMS as usize;
    let bap_dims = get_number_of_aperiodicities(fs) as usize;

    let mut mgc = Vec::with_capacity(frames * mgc_dims);
    let mut bap = Vec::with_capacity(frames * bap_dims);

    // CheapTrick and D4C are frame-independent, so the full-resolution
    // spectrogram (1025 bins * frames) never has to exist in memory at once.
    let mut start = 0;
    while start < frames {
        let end = (start + consts::ANALYSIS_CHUNK_FRAMES).min(frames);
        let t_chunk = t[start..end].to_vec();
        let f0_chunk = f0[start..end].to_vec();
        let len = (end - start) as i32;

        let sp = cheaptrick(audio, fs, &t_chunk, &f0_chunk, &mut cheaptrick_opts);
        let coded_sp = code_spectral_envelope(&sp, len, fs, consts::FFT_SIZE, consts::MGC_DIMS);
        drop(sp);
        mgc.extend(coded_sp.iter().flatten().map(|&v| v as f32));

        let mut ap = d4c(audio, fs, &t_chunk, &f0_chunk, &d4c_opts);
        ap.iter_mut().flatten().for_each(|a| {
            if a.is_nan() {
                *a = 0.;
            }
        });
        let coded_ap = code_aperiodicity(&ap, len, fs);
        bap.extend(coded_ap.iter().flatten().map(|&v| v as f32));

        start = end;
    }

    Ok(WorldFeatures {
        base_f0: calculate_base_f0(&f0) as f32,
        f0: f0.iter().map(|&v| v as f32).collect(),
        mgc,
        bap,
        mgc_dims: mgc_dims as u32,
        bap_dims: bap_dims as u32,
    })
}
