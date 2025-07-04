// Resamplers only work in 44100 16-bit WAV
pub const SAMPLE_RATE: u32 = 44100;
// WORLD constants
pub const SPEC_Q1: f64 = -0.15;
pub const F0_FLOOR: f64 = 71.;
pub const F0_CEIL: f64 = 1760.;
pub const FRAME_PERIOD: f64 = 5.;
pub const FFT_SIZE: i32 = 2048;
pub const D4C_THRESHOLD: f64 = 0.25;
pub const MGC_DIMS: i32 = 64;
pub const FEATURE_EXT: &'static str = "sc";
