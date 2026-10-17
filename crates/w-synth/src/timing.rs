//! How neighbouring notes of one track are laid on the time axis.
//!
//! A UTAU sample is placed so that its *preutterance* point (the start of the
//! vowel, after the consonant) falls on the note start, so the sound begins
//! `preutter` milliseconds before the note. The previous note must therefore
//! give way: its sound ends `preutter - overlap` milliseconds early, and the
//! two cross-fade over the `overlap` region. When a note is too short for the
//! preutterance of the next one (short notes with a VCV voicebank), the
//! preutterance and overlap are squeezed so that the previous note keeps at
//! least half of its length. Without this the vowels of neighbouring notes
//! sound at the same time.

/// Fade at the start of a note that does not overlap its predecessor, ms.
pub const DEFAULT_FADE_IN_MS: f64 = 5.0;
/// Fade at the end of a note that is not cross-faded into its successor, ms.
pub const DEFAULT_FADE_OUT_MS: f64 = 35.0;

/// One note of a track, in time order. `preutter` and `overlap` are the oto
/// values already scaled by the consonant stretch (velocity).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TimingInput {
    pub start: f64,
    pub duration: f64,
    pub preutter: f64,
    pub overlap: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NoteTiming {
    /// How long before the note start the sound begins (effective preutterance).
    pub preutter: f64,
    /// Length of the cross-fade with the previous note (0 when they do not touch).
    pub overlap: f64,
    pub fade_in: f64,
    /// Added to the note duration to find where its sound ends (usually negative:
    /// the next note's preutterance eats into this note's end).
    pub tail_adjust: f64,
    pub fade_out: f64,
}

impl NoteTiming {
    fn plain(input: &TimingInput) -> Self {
        Self {
            preutter: input.preutter.max(0.0),
            overlap: input.overlap,
            fade_in: DEFAULT_FADE_IN_MS,
            tail_adjust: 0.0,
            fade_out: DEFAULT_FADE_OUT_MS,
        }
    }

    /// Where the sound of the note ends, relative to its start.
    pub fn end_ms(&self, duration: f64) -> f64 {
        (duration + self.tail_adjust).max(5.0)
    }
}

/// Timings for the notes of one track, sorted by start time.
pub fn compute(inputs: &[TimingInput]) -> Vec<NoteTiming> {
    let mut out: Vec<NoteTiming> = inputs.iter().map(NoteTiming::plain).collect();

    for idx in 1..inputs.len() {
        let cur = inputs[idx];
        let prev = inputs[idx - 1];
        let prev_pre = out[idx - 1].preutter;
        let gap = cur.start - (prev.start + prev.duration);
        let adjacent = gap <= 0.0;

        let mut pre = cur.preutter.max(0.0);
        let mut overlap = cur.overlap;
        let mut max_pre = pre;
        if adjacent {
            if overlap > 0.0 && pre - overlap > prev.duration * 0.5 {
                max_pre = prev.duration * 0.5 / (pre - overlap) * pre;
            }
            max_pre = max_pre.min(prev.duration);
            if prev_pre < 5.0 {
                max_pre = max_pre.min(prev.duration + prev_pre - 5.0);
            }
        } else if gap < pre {
            // A small gap: the consonant may fill it but not reach into the previous note.
            max_pre = gap;
        }
        let max_pre = max_pre.max(0.0);
        if pre > max_pre {
            let ratio = if pre > 0.0 { max_pre / pre } else { 0.0 };
            pre = max_pre;
            overlap *= ratio;
        }
        if overlap < 0.0 {
            overlap = overlap.max((35.0 - prev.duration + pre).min(0.0));
        }
        if prev.duration - pre < 5.0 {
            overlap = overlap.max(5.0 - (prev.duration - pre));
        }

        let overlapped = adjacent && overlap > 0.0;
        out[idx].preutter = pre;
        out[idx].overlap = overlap;
        out[idx].fade_in = if overlapped { overlap } else { DEFAULT_FADE_IN_MS };

        let tail_intrude = if adjacent { pre.max(pre - overlap) } else { 0.0 };
        let tail_overlap = if adjacent { overlap.max(0.0) } else { 0.0 };
        // `gap` is negative when the notes overlap in time: the previous sound still stops at the same place.
        let cut = if adjacent { gap } else { 0.0 };
        out[idx - 1].tail_adjust = cut - tail_intrude + tail_overlap;
        out[idx - 1].fade_out = if overlapped { tail_overlap } else { DEFAULT_FADE_OUT_MS };
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(start: f64, duration: f64, preutter: f64, overlap: f64) -> TimingInput {
        TimingInput { start, duration, preutter, overlap }
    }

    /// Where the audible part of each note starts and ends on the time axis.
    fn spans(inputs: &[TimingInput], t: &[NoteTiming]) -> Vec<(f64, f64)> {
        inputs
            .iter()
            .zip(t)
            .map(|(i, t)| (i.start - t.preutter, i.start + t.end_ms(i.duration)))
            .collect()
    }

    #[test]
    fn a_lone_note_keeps_its_preutterance_and_default_fades() {
        let t = compute(&[note(1000.0, 500.0, 120.0, 40.0)]);
        assert_eq!(t[0].preutter, 120.0);
        assert_eq!(t[0].fade_in, DEFAULT_FADE_IN_MS);
        assert_eq!(t[0].fade_out, DEFAULT_FADE_OUT_MS);
        assert_eq!(t[0].tail_adjust, 0.0);
    }

    #[test]
    fn long_adjacent_notes_crossfade_over_the_overlap_and_the_previous_ends_early() {
        let inputs = [note(0.0, 1000.0, 100.0, 40.0), note(1000.0, 1000.0, 100.0, 40.0)];
        let t = compute(&inputs);
        assert_eq!(t[1].preutter, 100.0);
        assert_eq!(t[1].fade_in, 40.0);
        // The previous sound ends at (start - preutter + overlap) = 940 and fades over 40 ms.
        let s = spans(&inputs, &t);
        assert!((s[0].1 - 940.0).abs() < 1e-9);
        assert_eq!(t[0].fade_out, 40.0);
        // The next sound begins at 900: the two are only together inside the overlap.
        assert!((s[1].0 - 900.0).abs() < 1e-9);
        assert!(s[0].1 - t[0].fade_out >= s[1].0 - 1e-9 - 40.0);
    }

    #[test]
    fn short_notes_squeeze_the_preutterance_instead_of_stacking_the_sounds() {
        // Notes of 170 ms with a 250 ms preutterance: the old behaviour made them sound together.
        let inputs = [
            note(0.0, 170.0, 250.0, 60.0),
            note(170.0, 170.0, 250.0, 60.0),
            note(340.0, 170.0, 250.0, 60.0),
        ];
        let t = compute(&inputs);
        for (i, nt) in t.iter().enumerate().skip(1) {
            // The part of the previous note that the consonant takes is at most half of it.
            assert!(nt.preutter - nt.overlap <= inputs[i - 1].duration * 0.5 + 1e-9, "{nt:?}");
            assert!(nt.preutter < 250.0, "{nt:?}");
            // The overlap shrinks in the same proportion.
            assert!(nt.overlap < 60.0);
        }
        let s = spans(&inputs, &t);
        for pair in s.windows(2) {
            // The previous sound stops no later than the next one's overlap region ends.
            let next_overlap_end = pair[1].0 + 60.0;
            assert!(pair[0].1 <= next_overlap_end + 1e-9, "{pair:?}");
        }
    }

    #[test]
    fn the_sound_of_a_note_never_outlasts_the_next_notes_start() {
        let inputs = [note(0.0, 120.0, 200.0, 20.0), note(120.0, 120.0, 200.0, 20.0)];
        let t = compute(&inputs);
        let s = spans(&inputs, &t);
        assert!(s[0].1 <= inputs[1].start);
        assert!(t[0].end_ms(120.0) >= 5.0);
    }

    #[test]
    fn a_small_gap_limits_the_preutterance_to_the_gap() {
        let t = compute(&[note(0.0, 500.0, 100.0, 30.0), note(560.0, 500.0, 100.0, 30.0)]);
        assert_eq!(t[1].preutter, 60.0);
        // Not adjacent: no cross-fade, the previous note keeps its own end.
        assert_eq!(t[0].tail_adjust, 0.0);
        assert_eq!(t[0].fade_out, DEFAULT_FADE_OUT_MS);
        assert_eq!(t[1].fade_in, DEFAULT_FADE_IN_MS);
    }

    #[test]
    fn a_big_gap_changes_nothing() {
        let t = compute(&[note(0.0, 500.0, 100.0, 30.0), note(2000.0, 500.0, 100.0, 30.0)]);
        assert_eq!(t[1].preutter, 100.0);
        assert_eq!(t[0].tail_adjust, 0.0);
    }

    #[test]
    fn without_overlap_the_previous_note_still_leaves_room_for_the_consonant() {
        let inputs = [note(0.0, 1000.0, 90.0, 0.0), note(1000.0, 1000.0, 90.0, 0.0)];
        let t = compute(&inputs);
        assert!((spans(&inputs, &t)[0].1 - 910.0).abs() < 1e-9);
        assert_eq!(t[1].fade_in, DEFAULT_FADE_IN_MS);
    }

    #[test]
    fn overlapping_notes_in_a_track_do_not_make_sounds_pile_up() {
        // The second note starts 100 ms before the first one ends.
        let inputs = [note(0.0, 500.0, 80.0, 30.0), note(400.0, 500.0, 80.0, 30.0)];
        let t = compute(&inputs);
        let s = spans(&inputs, &t);
        assert!(s[0].1 <= s[1].0 + 30.0 + 1e-9, "{s:?} {t:?}");
    }

    #[test]
    fn zero_preutterance_banks_are_untouched() {
        let inputs = [note(0.0, 300.0, 0.0, 0.0), note(300.0, 300.0, 0.0, 0.0)];
        let t = compute(&inputs);
        assert_eq!(t[1].preutter, 0.0);
        assert_eq!(t[0].tail_adjust, 0.0);
    }
}
