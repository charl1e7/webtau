#![allow(dead_code)]
use anyhow::Result;
use std::{mem::discriminant, str::FromStr};

use crate::consts;

#[derive(Debug)]
pub struct Flags {
    pub generate_features: Option<f64>,
    pub fry_enable: f64,
    pub fry_offset: f64,
    pub fry_transition: f64,
    pub fry_volume: f64,
    pub fry_pitch: f64,
    pub devoice_enable: f64,
    pub devoice_offset: f64,
    pub devoice_transition: f64,
    pub gender: f64,
    pub breathiness: f64,
    pub peak_compression: f64,
    pub peak_normalization: f64,
    pub tremolo: f64,
    pub pitch_offset: f64,
    pub aperiodic_mix: f64,
    pub growl: f64,
}

enum FlagToken {
    GenerateFeatures,
    FryEnable,
    FryOffset,
    FryTransition,
    FryVolume,
    FryPitch,
    DevoiceEnable,
    DevoiceOffset,
    DevoiceTransition,
    Gender,
    Breathiness,
    PeakCompression,
    PeakNormalization,
    Tremolo,
    PitchOffset,
    AperiodicMix,
    Growl,
    Number(f64),
}

impl Flags {
    pub fn new() -> Self {
        Self {
            generate_features: None,
            fry_enable: 0.,
            fry_offset: 0.,
            fry_transition: 75.,
            fry_volume: 10.,
            fry_pitch: consts::F0_FLOOR,
            devoice_enable: 0.,
            devoice_offset: 0.,
            devoice_transition: 75.,
            gender: 0.,
            breathiness: 50.,
            peak_compression: 86.,
            peak_normalization: 4.,
            tremolo: 0.,
            pitch_offset: 0.,
            aperiodic_mix: 0.,
            growl: 0.,
        }
    }
}

impl FromStr for Flags {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        let mut flags = Self::new();
        let mut flag_tokens = Vec::new();
        // Flags are plain ASCII. Working on bytes keeps any other character (which the user can type
        // into the flags box) from being split in the middle, and simply never matches a flag.
        let bytes = s.as_bytes();
        let length = bytes.len();

        // tokenize flags
        let mut i = 0;
        while i < length {
            let curr = bytes[i];
            // two characters
            let two_chars = bytes.get(i + 1).map(|&next| [curr, next]);

            // check single character flags
            match curr {
                b'g' => flag_tokens.push(FlagToken::Gender),
                b'B' => flag_tokens.push(FlagToken::Breathiness),
                b'P' => flag_tokens.push(FlagToken::PeakCompression),
                b'p' => flag_tokens.push(FlagToken::PeakNormalization),
                b'A' => flag_tokens.push(FlagToken::Tremolo),
                b't' => flag_tokens.push(FlagToken::PitchOffset),
                b'S' => flag_tokens.push(FlagToken::AperiodicMix),
                b'G' => flag_tokens.push(FlagToken::GenerateFeatures),
                _ => (),
            }

            // check two character flags
            if let Some(flag) = two_chars {
                let mut matched = true;
                match &flag {
                    b"fe" => flag_tokens.push(FlagToken::FryEnable),
                    b"fo" => flag_tokens.push(FlagToken::FryOffset),
                    b"fl" => flag_tokens.push(FlagToken::FryTransition),
                    b"fv" => flag_tokens.push(FlagToken::FryVolume),
                    b"fp" => flag_tokens.push(FlagToken::FryPitch),
                    b"ve" => flag_tokens.push(FlagToken::DevoiceEnable),
                    b"vo" => flag_tokens.push(FlagToken::DevoiceOffset),
                    b"vl" => flag_tokens.push(FlagToken::DevoiceTransition),
                    b"gw" => flag_tokens.push(FlagToken::Growl),
                    _ => matched = false,
                }
                if matched {
                    i += 1; // increment index if matched
                }
            }

            // parse numbers: an optional sign and digits (a sign on its own means nothing)
            if curr.is_ascii_digit() || curr == b'+' || curr == b'-' {
                let st = i;
                while i + 1 < length && bytes[i + 1].is_ascii_digit() {
                    i += 1;
                }
                // Digits only, so this cannot fail unless the number is out of range.
                if let Ok(value) = s[st..=i].parse::<f64>() {
                    flag_tokens.push(FlagToken::Number(value));
                }
            }

            // increment
            i += 1;
        }

        i = 0; // recycle index
        let length = flag_tokens.len();
        // parse flags
        while i < length {
            let curr = &flag_tokens[i];
            // if it's not a numerical token
            if discriminant(curr) != discriminant(&FlagToken::Number(0.)) {
                if i < length - 1 {
                    // get next token
                    let next = &flag_tokens[i + 1];
                    if let FlagToken::Number(value) = next {
                        match curr {
                            FlagToken::GenerateFeatures => {
                                flags.generate_features = Some(value.clamp(0., 100.))
                            }
                            FlagToken::FryEnable => flags.fry_enable = *value,
                            FlagToken::FryOffset => flags.fry_offset = *value,
                            FlagToken::FryTransition => flags.fry_transition = value.max(1.),
                            FlagToken::FryVolume => flags.fry_volume = value.clamp(0., 100.),
                            FlagToken::FryPitch => flags.fry_pitch = value.max(0.),
                            FlagToken::DevoiceEnable => flags.devoice_enable = *value,
                            FlagToken::DevoiceOffset => flags.devoice_offset = *value,
                            FlagToken::DevoiceTransition => {
                                flags.devoice_transition = value.max(1.)
                            }
                            FlagToken::Gender => flags.gender = *value,
                            FlagToken::Breathiness => flags.breathiness = value.clamp(0., 100.),
                            FlagToken::PeakCompression => {
                                flags.peak_compression = value.clamp(0., 100.)
                            }
                            FlagToken::PeakNormalization => flags.peak_normalization = *value,
                            FlagToken::Tremolo => flags.tremolo = *value,
                            FlagToken::PitchOffset => flags.pitch_offset = *value,
                            FlagToken::AperiodicMix => flags.aperiodic_mix = value.clamp(0., 100.),
                            FlagToken::Growl => flags.growl = value.clamp(0., 100.),
                            _ => (),
                        }
                        i += 1;
                    } else {
                        match curr {
                            FlagToken::GenerateFeatures => {
                                flags.generate_features = Some(consts::D4C_THRESHOLD * 100.)
                            }
                            _ => (),
                        }
                    }
                } else {
                    // Last token, only check possible option flag
                    match curr {
                        FlagToken::GenerateFeatures => {
                            flags.generate_features = Some(consts::D4C_THRESHOLD * 100.)
                        }
                        _ => (),
                    }
                }
            }
            // increment
            i += 1;
        }

        Ok(flags)
    }
}

#[cfg(test)]
mod tests {
    use super::Flags;

    fn parse(s: &str) -> Flags {
        s.replace('/', "").parse().expect("flags should parse")
    }

    #[test]
    fn defaults_when_empty() {
        let f = parse("");
        assert_eq!(f.gender, 0.0);
        assert_eq!(f.breathiness, 50.0);
        assert_eq!(f.fry_enable, 0.0);
        assert_eq!(f.pitch_offset, 0.0);
        assert!(f.generate_features.is_none());
    }

    #[test]
    fn every_flag_reads_its_number() {
        let f = parse("g-5B30P80p6A20t-100S40fe100fo5fl60fv20fp90ve10vo2vl30gw15");
        assert_eq!(f.gender, -5.0);
        assert_eq!(f.breathiness, 30.0);
        assert_eq!(f.peak_compression, 80.0);
        assert_eq!(f.peak_normalization, 6.0);
        assert_eq!(f.tremolo, 20.0);
        assert_eq!(f.pitch_offset, -100.0);
        assert_eq!(f.aperiodic_mix, 40.0);
        assert_eq!(f.fry_enable, 100.0);
        assert_eq!(f.fry_offset, 5.0);
        assert_eq!(f.fry_transition, 60.0);
        assert_eq!(f.fry_volume, 20.0);
        assert_eq!(f.fry_pitch, 90.0);
        assert_eq!(f.devoice_enable, 10.0);
        assert_eq!(f.devoice_offset, 2.0);
        assert_eq!(f.devoice_transition, 30.0);
        assert_eq!(f.growl, 15.0);
    }

    #[test]
    fn values_are_clamped_to_their_range() {
        assert_eq!(parse("B500").breathiness, 100.0);
        assert_eq!(parse("B-500").breathiness, 0.0);
        assert_eq!(parse("P999").peak_compression, 100.0);
        assert_eq!(parse("fv-3").fry_volume, 0.0);
        assert_eq!(parse("fl0").fry_transition, 1.0);
        assert_eq!(parse("fp-5").fry_pitch, 0.0);
        assert_eq!(parse("vl0").devoice_transition, 1.0);
        assert_eq!(parse("S101").aperiodic_mix, 100.0);
        assert_eq!(parse("gw-1").growl, 0.0);
    }

    #[test]
    fn a_flag_without_a_number_changes_nothing() {
        let f = parse("gB");
        assert_eq!(f.gender, 0.0);
        assert_eq!(f.breathiness, 50.0);
        // The generator flag alone selects the default threshold.
        assert_eq!(parse("G").generate_features, Some(25.0));
        assert_eq!(parse("G30").generate_features, Some(30.0));
        assert_eq!(parse("g5G").generate_features, Some(25.0));
        assert_eq!(parse("G200").generate_features, Some(100.0));
    }

    #[test]
    fn the_next_number_belongs_to_the_flag_before_it() {
        let f = parse("g5B");
        assert_eq!(f.gender, 5.0);
        // "g" is not followed by a number here: B takes nothing, g keeps its default.
        let f = parse("B g7");
        assert_eq!(f.gender, 7.0);
        assert_eq!(f.breathiness, 50.0);
    }

    #[test]
    fn unknown_text_is_ignored() {
        let f = parse("xyz g3 ?! B20 zz");
        assert_eq!(f.gender, 3.0);
        assert_eq!(f.breathiness, 20.0);
    }

    #[test]
    fn a_sign_on_its_own_is_ignored_not_an_error() {
        for s in ["g-", "g+", "-", "+", "B-g5", "--5", "g-+3"] {
            assert!(s.parse::<Flags>().is_ok(), "{s}");
        }
        assert_eq!(parse("B-g5").gender, 5.0);
        assert_eq!(parse("g+7").gender, 7.0);
    }

    #[test]
    fn non_ascii_text_in_the_flags_box_does_not_crash() {
        for s in ["あ", "あg5", "g5あ", "gあ5", "é", "🎤g5", "g5🎤", "fあ", "日本語"] {
            let parsed = std::panic::catch_unwind(|| s.parse::<Flags>());
            assert!(parsed.is_ok(), "{s} panicked");
            assert!(parsed.unwrap().is_ok(), "{s}");
        }
        assert_eq!(parse("あg5").gender, 5.0);
        assert_eq!(parse("g5あ").gender, 5.0);
    }

    #[test]
    fn random_text_never_panics() {
        let alphabet: Vec<char> = "gBPpAtSGfevolwgw0123456789+-/ .,xあ♪".chars().collect();
        let mut seed = 12345u32;
        for _ in 0..5000 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let len = (seed >> 24) as usize % 24;
            let mut text = String::new();
            for _ in 0..len {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                text.push(alphabet[(seed >> 16) as usize % alphabet.len()]);
            }
            let result = std::panic::catch_unwind(|| text.parse::<Flags>().is_ok());
            assert!(matches!(result, Ok(true)), "{text:?}");
        }
    }

    #[test]
    fn huge_numbers_do_not_break_parsing() {
        let f = parse("g99999999999999999999999");
        assert!(f.gender.is_finite() || f.gender.is_infinite());
        assert!("B99999999999999999999999".parse::<Flags>().is_ok());
    }

    #[test]
    fn later_values_win() {
        assert_eq!(parse("g1g2g3").gender, 3.0);
    }

    #[test]
    fn the_slash_form_from_old_ust_files_is_handled_by_the_caller() {
        let flag = "f/e1000t100";
        let f = parse(flag);
        assert_eq!(f.pitch_offset, 100.0);
    }
}
