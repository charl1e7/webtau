use std::os::raw::{c_double, c_int};

// CheapTrick
#[repr(C)]
#[derive(Debug, PartialEq)]
pub struct CheapTrickOption {
    pub q1: c_double,
    pub f0_floor: c_double,
    pub fft_size: c_int,
}

impl CheapTrickOption {
    pub fn new(fs: c_int) -> Self {
        unsafe {
            let mut option = std::mem::MaybeUninit::<CheapTrickOption>::uninit();
            InitializeCheapTrickOption(fs, option.as_mut_ptr());
            option.assume_init()
        }
    }
}

#[link(name = "cheaptrick")]
unsafe extern "C" {
    pub fn CheapTrick(
        x: *const c_double,
        x_length: c_int,
        fs: c_int,
        temporal_positions: *const c_double,
        f0: *const c_double,
        f0_length: c_int,
        option: *const CheapTrickOption,
        spectrogram: *mut *mut c_double,
    );
    pub fn InitializeCheapTrickOption(fs: c_int, option: *mut CheapTrickOption);
    pub fn GetFFTSizeForCheapTrick(fs: c_int, option: *mut CheapTrickOption) -> c_int;
}

// Codec
#[link(name = "codec")]
unsafe extern "C" {
    pub fn GetNumberOfAperiodicities(fs: c_int) -> c_int;
    pub fn CodeAperiodicity(
        aperiodicity: *const *const c_double,
        f0_length: c_int,
        fs: c_int,
        fft_size: c_int,
        coded_aperiodicity: *mut *mut c_double,
    );
    pub fn DecodeAperiodicity(
        coded_aperiodicity: *const *const c_double,
        f0_length: c_int,
        fs: c_int,
        fft_size: c_int,
        aperiodicity: *mut *mut c_double,
    );
    pub fn CodeSpectralEnvelope(
        spectrogram: *const *const c_double,
        f0_length: c_int,
        fs: c_int,
        fft_size: c_int,
        numver_of_dimensions: c_int,
        coded_spectral_envelope: *mut *mut c_double,
    );
    pub fn DecodeSpectralEnvelope(
        coded_spectral_envelope: *const *const c_double,
        f0_length: c_int,
        fs: c_int,
        fft_size: c_int,
        number_of_dimensions: c_int,
        spectrogram: *mut *mut c_double,
    );
}

// D4C
#[repr(C)]
#[derive(Debug, PartialEq)]
pub struct D4COption {
    pub threshold: c_double,
}

impl D4COption {
    pub fn new() -> Self {
        unsafe {
            let mut option = std::mem::MaybeUninit::<D4COption>::uninit();
            InitializeD4COption(option.as_mut_ptr());
            option.assume_init()
        }
    }
}

#[link(name = "d4c")]
unsafe extern "C" {
    pub fn InitializeD4COption(option: *mut D4COption);
    pub fn D4C(
        x: *const c_double,
        x_length: c_int,
        fs: c_int,
        temporal_positions: *const c_double,
        f0: *const c_double,
        f0_length: c_int,
        fft_size: c_int,
        option: *const D4COption,
        aperiodicity: *mut *mut c_double,
    );
}

// Dio
#[repr(C)]
#[derive(Debug, PartialEq)]
pub struct DioOption {
    pub f0_floor: c_double,
    pub f0_ceil: c_double,
    pub channels_in_octave: c_double,
    pub frame_period: c_double,
    pub speed: c_int,
    pub allowed_range: c_double,
}

impl DioOption {
    pub fn new() -> Self {
        unsafe {
            let mut option = std::mem::MaybeUninit::<DioOption>::uninit();
            InitializeDioOption(option.as_mut_ptr());
            option.assume_init()
        }
    }
}

#[link(name = "dio")]
unsafe extern "C" {
    pub fn Dio(
        x: *const c_double,
        x_length: c_int,
        fs: c_int,
        option: *const DioOption,
        temporal_positions: *mut c_double,
        f0: *mut c_double,
    );
    pub fn InitializeDioOption(option: *mut DioOption);
    pub fn GetSamplesForDIO(fs: c_int, x_length: c_int, frame_period: c_double) -> c_int;
}

// Harvest
#[repr(C)]
#[derive(Debug, PartialEq)]
pub struct HarvestOption {
    pub f0_floor: c_double,
    pub f0_ceil: c_double,
    pub frame_period: c_double,
}

impl HarvestOption {
    pub fn new() -> Self {
        unsafe {
            let mut option = std::mem::MaybeUninit::<HarvestOption>::uninit();
            InitializeHarvestOption(option.as_mut_ptr());
            option.assume_init()
        }
    }
}

#[link(name = "harvest")]
unsafe extern "C" {
    pub fn Harvest(
        x: *const c_double,
        x_length: c_int,
        fs: c_int,
        option: *const HarvestOption,
        temporal_positions: *mut c_double,
        f0: *mut c_double,
    );
    pub fn InitializeHarvestOption(option: *mut HarvestOption);
    pub fn GetSamplesForHarvest(fs: c_int, x_length: c_int, frame_period: c_double) -> c_int;
}

// StoneMask
#[link(name = "stonemask")]
unsafe extern "C" {
    pub fn StoneMask(
        x: *const c_double,
        x_length: c_int,
        fs: c_int,
        temporal_positions: *const c_double,
        f0: *const c_double,
        f0_length: c_int,
        refined_f0: *mut c_double,
    );
}

// Synthesis
#[link(name = "synthesis")]
unsafe extern "C" {
    pub fn Synthesis(
        f0: *const c_double,
        f0_length: c_int,
        spectrogram: *const *const c_double,
        aperiodicity: *const *const c_double,
        fft_size: c_int,
        frame_period: c_double,
        fs: c_int,
        y_length: c_int,
        y: *mut c_double,
    );
}

#[cfg(test)]
mod tests {
    #[allow(dead_code)]
    fn get_type<T>(_: T) -> &'static str {
        std::any::type_name::<T>()
    }

    // CheapTrick test
    use crate::{CheapTrick, CheapTrickOption, GetFFTSizeForCheapTrick};

    #[test]
    fn test_initialize_cheaptrick_option() {
        let fs = 44100;
        let option = CheapTrickOption::new(fs);
        assert_eq!(
            option,
            CheapTrickOption {
                q1: -0.15,
                f0_floor: 71.0,
                fft_size: 2048
            }
        );
    }

    #[test]
    fn test_get_fft_size_for_cheaptrick() {
        let fs = 44100;
        let mut option = CheapTrickOption::new(fs);
        unsafe {
            GetFFTSizeForCheapTrick(fs, &mut option as *mut _);
            assert_eq!(option.fft_size, 2048);
        }
    }

    #[test]
    fn test_cheaptrick() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100;
        let temporal_positions = vec![0.0, 0.005];
        let f0 = vec![0.0, 0.0];
        let f0_length = f0.len() as i32;
        let mut option = CheapTrickOption::new(fs);
        unsafe {
            GetFFTSizeForCheapTrick(fs, &mut option as *mut _);
        }
        let xl = (option.fft_size / 2 + 1) as usize;
        let yl = f0_length as usize;
        let mut spectrogram = vec![vec![0.0; xl]; yl];
        let mut spectrogram_ptr = spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_mut_ptr();
        unsafe {
            CheapTrick(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length,
                &option as *const _,
                spectrogram_ptr,
            );
        }
        assert_eq!(spectrogram.len(), yl);
        assert_eq!(spectrogram[0].len(), xl);
        // assert_eq!(spectrogram[0][0], 0.0000000000000000973637408614245);
    }

    // Codec test
    use crate::{
        CodeAperiodicity, CodeSpectralEnvelope, DecodeAperiodicity, DecodeSpectralEnvelope,
        GetNumberOfAperiodicities,
    };
    #[test]
    fn test_get_number_of_aperiodicities() {
        let fs = 44100;
        let n_aperiodicities;
        unsafe {
            n_aperiodicities = GetNumberOfAperiodicities(fs);
        }
        assert_eq!(n_aperiodicities, 5);
    }

    #[test]
    fn test_code_aperiodicity() {
        let fs = 44100_i32;
        let f0_length = 2_i32;
        let fft_size = 2048_i32;
        let aperiodicity =
            vec![vec![0.999999999999; (fft_size / 2 + 1) as usize]; f0_length as usize];
        let aperiodicity_ptr = aperiodicity
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let aperiodicity_ptr = aperiodicity_ptr.as_ptr();
        let n_aperiodicity;
        unsafe {
            n_aperiodicity = GetNumberOfAperiodicities(fs);
        }
        let mut coded_aperiodicity = vec![vec![0.0; n_aperiodicity as usize]; f0_length as usize];
        let mut coded_aperiodicity_ptr = coded_aperiodicity
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let coded_aperiodicity_ptr = coded_aperiodicity_ptr.as_mut_ptr();
        unsafe {
            CodeAperiodicity(
                aperiodicity_ptr,
                f0_length,
                fs,
                fft_size,
                coded_aperiodicity_ptr,
            );
        }
        assert_eq!(coded_aperiodicity.len(), f0_length as usize);
        assert_eq!(coded_aperiodicity[0].len(), n_aperiodicity as usize);
        // assert_eq!(coded_aperiodicity[0][0], -0.0000000000086856974912498);
    }

    #[test]
    fn test_decode_aperiodicity() {
        let fs = 44100_i32;
        let f0_length = 2_i32;
        let fft_size = 2048_i32;
        let mut aperiodicity = vec![vec![0.0; (fft_size / 2 + 1) as usize]; f0_length as usize];
        let mut aperiodicity_ptr = aperiodicity
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let aperiodicity_ptr = aperiodicity_ptr.as_mut_ptr();
        let n_aperiodicity;
        unsafe {
            n_aperiodicity = GetNumberOfAperiodicities(fs);
        }
        let coded_aperiodicity =
            vec![vec![-0.0000000000086856974912498; n_aperiodicity as usize]; f0_length as usize];
        let coded_aperiodicity_ptr = coded_aperiodicity
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let coded_aperiodicity_ptr = coded_aperiodicity_ptr.as_ptr();
        unsafe {
            DecodeAperiodicity(
                coded_aperiodicity_ptr,
                f0_length,
                fs,
                fft_size,
                aperiodicity_ptr,
            );
        }
        assert_eq!(aperiodicity.len(), f0_length as usize);
        assert_eq!(aperiodicity[0].len(), (fft_size / 2 + 1) as usize);
        assert_eq!(aperiodicity[0][0], 0.999999999999);
    }

    #[test]
    fn test_code_spectral_envelope() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100_i32;
        let temporal_positions = vec![0.0, 0.005];
        let f0 = vec![0.0, 0.0];
        let f0_length = f0.len() as i32;
        let mut option = CheapTrickOption::new(fs);
        unsafe {
            GetFFTSizeForCheapTrick(fs, &mut option as *mut _);
        }
        let number_of_dimensions = 256_i32;
        let xl = (option.fft_size / 2 + 1) as usize;
        let yl = f0_length as usize;
        let mut spectrogram = vec![vec![0.0; xl]; yl];
        let mut spectrogram_ptr = spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_mut_ptr();
        unsafe {
            CheapTrick(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length,
                &option as *const _,
                spectrogram_ptr,
            );
        }
        let spectrogram_ptr = spectrogram
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_ptr();
        let mut coded_spectrogram =
            vec![vec![0.0; number_of_dimensions as usize]; f0_length as usize];
        let mut coded_spectrogram_ptr = coded_spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let coded_spectrogram_ptr = coded_spectrogram_ptr.as_mut_ptr();
        unsafe {
            CodeSpectralEnvelope(
                spectrogram_ptr,
                f0_length,
                fs,
                option.fft_size,
                number_of_dimensions,
                coded_spectrogram_ptr,
            );
        }
        assert_eq!(coded_spectrogram.len(), f0_length as usize);
        assert_eq!(coded_spectrogram[0].len(), number_of_dimensions as usize);
        // assert_eq!(coded_spectrogram[0][0], -36.675606765357735);
    }

    #[test]
    fn test_decode_spectral_envelope() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100_i32;
        let temporal_positions = vec![0.0, 0.005];
        let f0 = vec![0.0, 0.0];
        let f0_length = f0.len() as i32;
        let mut option = CheapTrickOption::new(fs);
        unsafe {
            GetFFTSizeForCheapTrick(fs, &mut option as *mut _);
        }
        let number_of_dimensions = 256_i32;
        let xl = (option.fft_size / 2 + 1) as usize;
        let yl = f0_length as usize;
        let mut spectrogram = vec![vec![0.0; xl]; yl];
        let mut spectrogram_ptr = spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_mut_ptr();
        unsafe {
            CheapTrick(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length,
                &option as *const _,
                spectrogram_ptr,
            );
        }
        let spectrogram_ptr = spectrogram
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_ptr();
        let mut coded_spectrogram =
            vec![vec![0.0; number_of_dimensions as usize]; f0_length as usize];
        let mut coded_spectrogram_ptr = coded_spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let coded_spectrogram_ptr = coded_spectrogram_ptr.as_mut_ptr();
        unsafe {
            CodeSpectralEnvelope(
                spectrogram_ptr,
                f0_length,
                fs,
                option.fft_size,
                number_of_dimensions,
                coded_spectrogram_ptr,
            );
        }
        let coded_spectrogram_ptr = coded_spectrogram
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let coded_spectrogram_ptr = coded_spectrogram_ptr.as_ptr();
        let mut spectrogram = vec![vec![0.0; xl]; yl];
        let mut spectrogram_ptr = spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_mut_ptr();
        unsafe {
            DecodeSpectralEnvelope(
                coded_spectrogram_ptr,
                f0_length,
                fs,
                option.fft_size,
                number_of_dimensions,
                spectrogram_ptr,
            );
        }
        assert_eq!(spectrogram.len(), yl);
        assert_eq!(spectrogram[0].len(), xl);
    }

    // D4C test
    use crate::{D4C, D4COption};

    #[test]
    fn test_initialize_d4c_option() {
        let option = D4COption::new();
        assert_eq!(option, D4COption { threshold: 0.85 });
    }

    #[test]
    fn test_d4c() {
        let x = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100 as i32;
        let temporal_positions = vec![0.0, 0.005];
        let f0 = vec![0.0, 0.0];
        let f0_length = f0.len() as i32;
        let fft_size = 2048 as i32;
        let option = D4COption::new();
        let mut aperiodicity = vec![vec![0.0; (fft_size / 2 + 1) as usize]; f0_length as usize];
        let mut aperiodicity_ptr = aperiodicity
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let aperiodicity_ptr = aperiodicity_ptr.as_mut_ptr();
        unsafe {
            D4C(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length,
                fft_size,
                &option as *const _,
                aperiodicity_ptr,
            );
            assert_eq!(aperiodicity.len(), f0_length as usize);
            assert_eq!(aperiodicity[0].len(), (fft_size / 2 + 1) as usize);
            assert_eq!(aperiodicity[0][0], 0.999999999999);
        }
    }

    // Dio test
    use crate::{Dio, DioOption, GetSamplesForDIO};

    #[test]
    fn test_initialize_dio_option() {
        let option = DioOption::new();
        assert_eq!(
            option,
            DioOption {
                f0_floor: 71.0,
                f0_ceil: 800.0,
                channels_in_octave: 2.0,
                frame_period: 5.0,
                speed: 1,
                allowed_range: 0.1
            }
        );
    }

    #[test]
    fn test_get_samples_for_dio() {
        let fs = 44100;
        let x_length = 256;
        let frame_period = 5.0;
        unsafe {
            let samples = GetSamplesForDIO(fs, x_length, frame_period);
            assert_eq!(samples, 2);
        }
    }

    #[test]
    fn test_dio() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100;
        let option = DioOption::new();
        let f0_length: usize;
        unsafe {
            f0_length = GetSamplesForDIO(fs, x_length, option.frame_period) as usize;
        }
        let mut temporal_positions: Vec<f64> = vec![0.0; f0_length];
        let mut f0: Vec<f64> = vec![0.0; f0_length];
        unsafe {
            Dio(
                x.as_ptr(),
                x_length,
                fs,
                &option as *const _,
                temporal_positions.as_mut_ptr(),
                f0.as_mut_ptr(),
            );
        }
        assert_eq!(temporal_positions, vec![0.0, 0.005]);
        assert_eq!(f0, vec![0.0, 0.0]);
    }

    // Harvest test
    use crate::{GetSamplesForHarvest, Harvest, HarvestOption};

    #[test]
    fn test_initalize_harvest_option() {
        let option = HarvestOption::new();
        assert_eq!(
            option,
            HarvestOption {
                f0_floor: 71.0,
                f0_ceil: 800.0,
                frame_period: 5.0
            }
        );
    }

    #[test]
    fn test_get_samples_for_harvest() {
        let fs = 44100;
        let x_length = 256;
        let frame_period = 5.0;
        unsafe {
            let samples = GetSamplesForHarvest(fs, x_length, frame_period);
            assert_eq!(samples, 2);
        }
    }

    #[test]
    fn test_harvest() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100;
        let option = HarvestOption::new();
        let f0_length: usize;
        unsafe {
            f0_length = GetSamplesForHarvest(fs, x_length, option.frame_period) as usize;
        }
        let mut temporal_positions: Vec<f64> = vec![0.0; f0_length];
        let mut f0: Vec<f64> = vec![0.0; f0_length];
        unsafe {
            Harvest(
                x.as_ptr(),
                x_length,
                fs,
                &option as *const _,
                temporal_positions.as_mut_ptr(),
                f0.as_mut_ptr(),
            );
        }
        assert_eq!(temporal_positions, vec![0.0, 0.005]);
        assert_eq!(f0, vec![0.0, 0.0]);
    }

    // StoneMask test
    use crate::StoneMask;

    #[test]
    fn test_stonemask() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100;
        let option = DioOption::new();
        let f0_length: usize;
        unsafe {
            f0_length = GetSamplesForDIO(fs, x_length, option.frame_period) as usize;
        }
        let mut temporal_positions: Vec<f64> = vec![0.0; f0_length];
        let mut f0: Vec<f64> = vec![0.0; f0_length];
        unsafe {
            Dio(
                x.as_ptr(),
                x_length,
                fs,
                &option as *const _,
                temporal_positions.as_mut_ptr(),
                f0.as_mut_ptr(),
            );
        }
        let mut refined_f0 = vec![0.0; f0_length];
        unsafe {
            StoneMask(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length as i32,
                refined_f0.as_mut_ptr(),
            );
        }
        assert_eq!(refined_f0, vec![0.0, 0.0]);
    }

    // Synthesis test
    use crate::Synthesis;

    #[test]
    fn test_synthesis() {
        let x: Vec<f64> = vec![0.0; 256];
        let x_length = x.len() as i32;
        let fs = 44100;
        let option = DioOption::new();
        let f0_length: usize;
        unsafe {
            f0_length = GetSamplesForDIO(fs, x_length, option.frame_period) as usize;
        }
        let frame_period = option.frame_period;
        let mut temporal_positions: Vec<f64> = vec![0.0; f0_length];
        let mut f0: Vec<f64> = vec![0.0; f0_length];
        unsafe {
            Dio(
                x.as_ptr(),
                x_length,
                fs,
                &option as *const _,
                temporal_positions.as_mut_ptr(),
                f0.as_mut_ptr(),
            );
        }

        let mut option = CheapTrickOption::new(fs);
        unsafe {
            GetFFTSizeForCheapTrick(fs, &mut option as *mut _);
        }
        let xl = (option.fft_size / 2 + 1) as usize;
        let yl = f0_length as usize;
        let mut spectrogram = vec![vec![0.0; xl]; yl];
        let mut spectrogram_ptr = spectrogram
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_mut_ptr();
        unsafe {
            CheapTrick(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length as i32,
                &option as *const _,
                spectrogram_ptr,
            );
        }
        let fft_size = option.fft_size;
        let option = D4COption::new();
        let mut aperiodicity = vec![vec![0.0; (fft_size / 2 + 1) as usize]; f0_length as usize];
        let mut aperiodicity_ptr = aperiodicity
            .iter_mut()
            .map(|inner| inner.as_mut_ptr())
            .collect::<Vec<_>>();
        let aperiodicity_ptr = aperiodicity_ptr.as_mut_ptr();
        unsafe {
            D4C(
                x.as_ptr(),
                x_length,
                fs,
                temporal_positions.as_ptr(),
                f0.as_ptr(),
                f0_length as i32,
                fft_size,
                &option as *const _,
                aperiodicity_ptr,
            );
        }

        let spectrogram_ptr = spectrogram
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let spectrogram_ptr = spectrogram_ptr.as_ptr();
        let aperiodicity_ptr = aperiodicity
            .iter()
            .map(|inner| inner.as_ptr())
            .collect::<Vec<_>>();
        let aperiodicity_ptr = aperiodicity_ptr.as_ptr();
        let y_length = f0_length as i32 * frame_period as i32 * fs as i32 / 1000;
        let mut y = vec![0.0; y_length as usize];
        unsafe {
            Synthesis(
                f0.as_ptr(),
                f0_length as i32,
                spectrogram_ptr,
                aperiodicity_ptr,
                fft_size,
                frame_period,
                fs,
                y_length as i32,
                y.as_mut_ptr(),
            )
        }
        assert_eq!(y.len(), y_length as usize);
    }
}
