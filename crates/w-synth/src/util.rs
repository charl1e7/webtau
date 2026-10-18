use anyhow::{Result, anyhow};

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a * (1. - t) + b * t
}

pub fn midi_to_hz(x: f64) -> f64 {
    440. * ((x - 69.) / 12.).exp2()
}

/// Parses either a plain MIDI number ("60") or a note name ("C4", "F#3").
pub fn pitch_parser(arg: &str) -> Result<i32> {
    let arg = arg.trim();
    if let Ok(v) = arg.parse::<i32>() {
        return Ok(v);
    }

    let mut chars = arg.chars();
    let letter = chars.next().ok_or_else(|| anyhow!("empty note name"))?;
    let base = match letter.to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return Err(anyhow!("invalid note name '{arg}'")),
    };
    let rest = chars.as_str();
    let (accidental, octave_str) = match rest.chars().next() {
        Some('#') => (1, &rest[1..]),
        Some('b') => (-1, &rest[1..]),
        _ => (0, rest),
    };
    let octave: i32 = octave_str
        .parse()
        .map_err(|_| anyhow!("invalid octave in '{arg}'"))?;
    Ok((octave + 1) * 12 + base + accidental)
}

#[cfg(test)]
mod tests {
    use super::pitch_parser;

    #[test]
    fn test_pitch() {
        assert_eq!(pitch_parser("C4").unwrap(), 60);
        assert_eq!(pitch_parser("C5").unwrap(), 72);
        assert_eq!(pitch_parser("A4").unwrap(), 69);
        assert_eq!(pitch_parser("F#3").unwrap(), 54);
        assert_eq!(pitch_parser("Bb2").unwrap(), 46);
        assert_eq!(pitch_parser("60").unwrap(), 60);
        assert!(pitch_parser("H4").is_err());
    }

    #[test]
    fn note_names_in_every_spelling() {
        use super::pitch_parser;
        assert_eq!(pitch_parser("c4").unwrap(), 60);
        assert_eq!(pitch_parser("C-1").unwrap(), 0);
        assert_eq!(pitch_parser("G9").unwrap(), 127);
        assert_eq!(pitch_parser("Db4").unwrap(), 61);
        assert_eq!(pitch_parser("C#4").unwrap(), 61);
        assert_eq!(pitch_parser(" 72 ").unwrap(), 72);
        assert_eq!(pitch_parser("-5").unwrap(), -5);
        for bad in ["", "C", "C#", "Cx4", "C4.5", "C 4", "♯", "あ4", "C♯4"] {
            assert!(pitch_parser(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn hertz_and_interpolation() {
        use super::{lerp, midi_to_hz};
        assert!((midi_to_hz(69.0) - 440.0).abs() < 1e-9);
        assert!((midi_to_hz(81.0) - 880.0).abs() < 1e-9);
        assert!((midi_to_hz(57.0) - 220.0).abs() < 1e-9);
        assert!((midi_to_hz(60.5) / midi_to_hz(60.0) - 2f64.powf(0.5 / 12.0)).abs() < 1e-12);
        assert_eq!(lerp(2.0, 10.0, 0.0), 2.0);
        assert_eq!(lerp(2.0, 10.0, 1.0), 10.0);
        assert_eq!(lerp(2.0, 10.0, 0.25), 4.0);
        assert_eq!(lerp(2.0, 10.0, 2.0), 18.0, "no clamping");
    }
}
