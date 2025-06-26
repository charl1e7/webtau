use crate::consts;
use anyhow::{Result, anyhow};
use bincode::Decode;
use bincode::Encode;
use rsworld::{cheaptrick, code_aperiodicity, code_spectral_envelope, d4c, harvest};
use rsworld_sys::{CheapTrickOption, D4COption, HarvestOption};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Decode, Encode)]
pub struct WorldFeatures {
    pub base_f0: f64,
    pub f0: Vec<f64>,
    pub mgc: Vec<Vec<f64>>,
    pub bap: Vec<Vec<f64>>,
}

fn calculate_base_f0(f0: &Vec<f64>) -> f64 {
    let n = f0.len();
    let mut base_f0 = 0.;
    let mut tally = 0.;

    for i in 0..n {
        if f0[i] >= consts::F0_FLOOR && f0[i] <= consts::F0_CEIL {
            let q = if i == 0 {
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
    }
    base_f0
}

pub fn generate_features(audio: Vec<f64>, threshold: Option<f64>) -> Result<WorldFeatures> {
    if audio.len() < consts::FFT_SIZE as usize {
        return Err(anyhow!(
            "Audio signal is too short for analysis. At least {} samples are required, found {}.",
            consts::FFT_SIZE,
            audio.len()
        ));
    }
    let harvest_opts = HarvestOption {
        f0_floor: consts::F0_FLOOR,
        f0_ceil: consts::F0_CEIL,
        frame_period: consts::FRAME_PERIOD,
    };

    let mut cheaptrick_opts = CheapTrickOption {
        q1: consts::SPEC_Q1,
        f0_floor: consts::F0_FLOOR,
        fft_size: consts::FFT_SIZE,
    };

    let d4c_opts = D4COption {
        threshold: threshold.unwrap_or(consts::D4C_THRESHOLD),
    };

    let (t, f0) = harvest(&audio, consts::SAMPLE_RATE as i32, &harvest_opts);
    let sp = cheaptrick(
        &audio,
        consts::SAMPLE_RATE as i32,
        &t,
        &f0,
        &mut cheaptrick_opts,
    );
    let mut ap = d4c(&audio, consts::SAMPLE_RATE as i32, &t, &f0, &d4c_opts);

    ap.iter_mut().for_each(|ap_frame| {
        ap_frame.iter_mut().for_each(|a| {
            if a.is_nan() {
                *a = 0.;
            }
        })
    });

    let base_f0 = calculate_base_f0(&f0);
    let mgc = code_spectral_envelope(
        &sp,
        f0.len() as i32,
        consts::SAMPLE_RATE as i32,
        consts::FFT_SIZE,
        consts::MGC_DIMS,
    );
    let bap = code_aperiodicity(&ap, f0.len() as i32, consts::SAMPLE_RATE as i32);

    let features = WorldFeatures {
        base_f0,
        f0,
        mgc,
        bap,
    };

    Ok(features)
}
