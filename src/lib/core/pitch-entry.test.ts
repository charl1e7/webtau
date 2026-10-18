import { describe, expect, it } from 'vitest';
import { createNote, createPitchPoint, createTrack } from './music';
import { toEngineNotes } from './engine-notes';
import { compilePitch, type EnginePitchPoint } from './pitch';
import { overlayFor, strokesToMs } from './pitch-curve';
import { TempoMap } from './tempo';

/** The pitch deviation (cents) the engine ends up with at `ms`, interpolating like it does. */
function valueAt(points: EnginePitchPoint[], ms: number, duration = 1000): number {
	const p = [...points].sort((a, b) => a.offset - b.offset);
	if (p.length === 0 || p[0].offset > 0) p.unshift({ offset: 0, value: 0 });
	if (p[p.length - 1].offset < duration) p.push({ offset: duration, value: 0 });
	if (ms <= p[0].offset) return p[0].value;
	for (let i = 1; i < p.length; i++) {
		if (ms <= p[i].offset) {
			const a = p[i - 1];
			const b = p[i];
			return b.offset === a.offset
				? b.value
				: a.value + ((b.value - a.value) * (ms - a.offset)) / (b.offset - a.offset);
		}
	}
	return p[p.length - 1].value;
}

const monotonic = (pts: EnginePitchPoint[]) =>
	pts.every((p, i) => i === 0 || p.offset >= pts[i - 1].offset);

describe('the pitch carried into a note from the previous one', () => {
	const none = { pitchPoints: [], vibrato: null };

	it('without a previous note nothing is added', () => {
		expect(compilePitch(none, 500)).toEqual([]);
		expect(compilePitch(none, 500, null, { cents: 0, until: 0 })).toEqual([]);
	});

	it('a note that follows directly sings its lead-in at the previous pitch and glides in', () => {
		// The previous note is five semitones higher and ends right here.
		const pts = compilePitch(none, 500, null, { cents: 500, until: 0 });
		expect(monotonic(pts)).toBe(true);
		expect(valueAt(pts, -300)).toBeCloseTo(500);
		expect(valueAt(pts, -26)).toBeCloseTo(500);
		expect(valueAt(pts, 0)).toBeCloseTo(250, 0);
		expect(valueAt(pts, 26)).toBeCloseTo(0);
		expect(valueAt(pts, 400)).toBe(0);
	});

	it('after a gap only the part of the lead-in over the previous note is carried', () => {
		const pts = compilePitch(none, 500, null, { cents: -300, until: -120 });
		expect(monotonic(pts)).toBe(true);
		expect(valueAt(pts, -400)).toBeCloseTo(-300);
		expect(valueAt(pts, -121)).toBeCloseTo(-300);
		expect(valueAt(pts, -100)).toBe(0);
		expect(valueAt(pts, 0)).toBe(0);
	});

	it('a gap longer than any lead-in changes nothing', () => {
		expect(compilePitch(none, 500, null, { cents: 700, until: -5000 })).toEqual([]);
	});

	it('the note’s own points take over where they begin (OpenUtau’s default −25 / +25)', () => {
		const own = {
			pitchPoints: [createPitchPoint(-25, 0, 's'), createPitchPoint(25, 0, 's')],
			vibrato: null
		};
		const pts = compilePitch(own, 500, null, { cents: 500, until: 0 });
		expect(monotonic(pts)).toBe(true);
		expect(valueAt(pts, -200)).toBeCloseTo(500); // still the previous note
		expect(valueAt(pts, -26)).toBeCloseTo(500);
		expect(valueAt(pts, -24)).toBeCloseTo(0, 0); // then the note's own curve
		expect(valueAt(pts, 100)).toBe(0);
	});

	it('a first point that already follows the previous note (snapped) is continuous', () => {
		const own = {
			pitchPoints: [createPitchPoint(-25, 500, 's'), createPitchPoint(25, 0, 's')],
			vibrato: null
		};
		const pts = compilePitch(own, 500, null, { cents: 500, until: 0 });
		expect(valueAt(pts, -300)).toBeCloseTo(500);
		expect(valueAt(pts, -25)).toBeCloseTo(500);
		expect(valueAt(pts, 25)).toBeCloseTo(0);
	});

	it('works together with vibrato and a track curve', () => {
		const vib = {
			pitchPoints: [],
			vibrato: { length: 100, period: 100, depth: 30, fadeIn: 0, fadeOut: 0, phase: 0 }
		};
		const a = compilePitch(vib, 500, null, { cents: 400, until: 0 });
		expect(monotonic(a)).toBe(true);
		expect(valueAt(a, -300)).toBeCloseTo(400);
		expect(valueAt(a, 40)).not.toBeCloseTo(400);

		const map = new TempoMap([{ tick: 0, bpm: 120 }]);
		const ms = strokesToMs(
			[
				[
					{ tick: 0, pitch: 62 },
					{ tick: 480, pitch: 62 }
				]
			],
			map
		);
		const overlay = overlayFor(ms, 0, 500, 60)!;
		const b = compilePitch(none, 500, overlay, { cents: 400, until: 0 });
		expect(monotonic(b)).toBe(true);
		expect(valueAt(b, -300)).toBeCloseTo(400);
		expect(valueAt(b, 100)).toBeCloseTo(200, 0);
	});
});

describe('toEngineNotes carries the previous pitch into the lead-in', () => {
	const map = new TempoMap([{ tick: 0, bpm: 120 }]);
	const track = createTrack(0, {});
	const note = (tick: number, pitch: number, length = 240) =>
		createNote({ track: track.id, tick, length, pitch });

	it('adjacent notes of different pitch', () => {
		const { notes } = toEngineNotes([note(0, 77), note(240, 72)], map, [track]);
		expect(notes[0].pitchbend).toEqual([]); // the first note has nothing before it
		expect(valueAt(notes[1].pitchbend, -200)).toBeCloseTo(500); // 77 − 72 semitones
		expect(valueAt(notes[1].pitchbend, 200)).toBe(0);
	});

	it('the same pitch needs no points', () => {
		const { notes } = toEngineNotes([note(0, 72), note(240, 72)], map, [track]);
		expect(notes[1].pitchbend).toEqual([]);
	});

	it('does not look across tracks', () => {
		const other = createTrack(1, {});
		const { notes } = toEngineNotes(
			[note(0, 77), createNote({ track: other.id, tick: 240, length: 240, pitch: 72 })],
			map,
			[track, other]
		);
		expect(notes[1].pitchbend).toEqual([]);
	});

	it('a lower note after a higher one and back up', () => {
		const { notes } = toEngineNotes([note(0, 60), note(240, 55), note(480, 62)], map, [track]);
		expect(valueAt(notes[1].pitchbend, -100)).toBeCloseTo(500);
		expect(valueAt(notes[2].pitchbend, -100)).toBeCloseTo(-700);
	});
});
