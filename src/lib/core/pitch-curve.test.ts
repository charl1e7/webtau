import { describe, expect, it } from 'vitest';
import { createNote, createTrack } from './music';
import { compilePitch } from './pitch';
import {
	bakeCurve,
	curveAt,
	eraseRange,
	insertStroke,
	overlayFor,
	simplify,
	strokesToMs
} from './pitch-curve';
import { toEngineNotes } from './engine-notes';
import { TempoMap } from './tempo';
import type { CurvePoint } from './types';

const map = new TempoMap([{ tick: 0, bpm: 120 }]); // 1 tick = 1000/960 ms
const ramp = (t0: number, t1: number, p0: number, p1: number, n = 20): CurvePoint[] =>
	Array.from({ length: n + 1 }, (_, i) => ({
		tick: t0 + ((t1 - t0) * i) / n,
		pitch: p0 + ((p1 - p0) * i) / n
	}));

describe('pitch strokes', () => {
	it('simplifies a straight ramp to its end points', () => {
		expect(simplify(ramp(0, 960, 60, 62))).toHaveLength(2);
	});

	it('a new stroke replaces what lies under it and splits older ones', () => {
		const first = insertStroke([], ramp(0, 1920, 60, 60));
		const next = insertStroke(first, ramp(480, 960, 63, 63));
		expect(next).toHaveLength(3);
		expect(curveAt(next, 240)).toBeCloseTo(60);
		expect(curveAt(next, 720)).toBeCloseTo(63);
		expect(curveAt(next, 1500)).toBeCloseTo(60);
	});

	it('drawing right to left gives the same stroke as left to right', () => {
		const forward = insertStroke([], ramp(0, 960, 60, 64));
		const backward = insertStroke([], ramp(0, 960, 60, 64).reverse());
		expect(backward).toEqual(forward);
	});

	it('ignores a stroke that is only a tap', () => {
		expect(insertStroke([], [{ tick: 10, pitch: 60 }])).toEqual([]);
	});

	it('erasing a range leaves the rest', () => {
		const s = insertStroke([], ramp(0, 1920, 60, 66));
		const cut = eraseRange(s, 600, 1200);
		expect(curveAt(cut, 900)).toBeNull();
		expect(curveAt(cut, 300)).not.toBeNull();
		expect(curveAt(cut, 1500)).not.toBeNull();
	});
});

describe('track curve in the engine notes', () => {
	const track = (strokes: CurvePoint[][]) => createTrack(0, { pitchCurve: strokes });
	const note = createNote({ tick: 0, length: 960, pitch: 60 });

	it('notes outside any stroke are untouched', () => {
		const far = createNote({ tick: 4800, length: 480, pitch: 60 });
		const t = track([ramp(0, 960, 60, 62)]);
		const { notes } = toEngineNotes([far], map, [t]);
		expect(notes[0].pitchbend).toEqual([]);
	});

	it('a stroke over a note becomes cents relative to the note pitch', () => {
		const t = track([ramp(0, 960, 62, 62)]); // flat two semitones up for the whole note
		const { notes } = toEngineNotes([note], map, [t]);
		const pts = notes[0].pitchbend;
		expect(pts.length).toBeGreaterThan(2);
		const mid = pts.find((p) => p.offset >= 400)!;
		expect(mid.value).toBeCloseTo(200, 0);
	});

	it('the stroke ramps back to the note pitch after it ends inside the note', () => {
		const ms = strokesToMs([ramp(0, 480, 62, 62)], map);
		const ov = overlayFor(ms, 0, 1000, 60)!;
		expect(ov.at(100)).toBeCloseTo(200);
		expect(ov.at(ms[0].ms[ms[0].ms.length - 1] + 20)).toBeGreaterThan(0);
		expect(ov.at(ms[0].ms[ms[0].ms.length - 1] + 200)).toBe(0);
	});

	it('combines with the note’s own points and vibrato', () => {
		const own = createNote({
			tick: 0,
			length: 960,
			pitch: 60,
			vibrato: { length: 50, period: 200, depth: 30, fadeIn: 0, fadeOut: 0, phase: 0 }
		});
		const ms = strokesToMs([ramp(0, 960, 61, 61)], map);
		const plain = compilePitch(own, 1000, null);
		const both = compilePitch(own, 1000, overlayFor(ms, 0, 1000, 60));
		const early = (list: typeof plain) => list.find((p) => p.offset >= 100)!.value;
		expect(early(both) - early(plain)).toBeCloseTo(100, 0);
	});

	it('muted tracks stay out and other tracks keep their own curve', () => {
		const a = track([ramp(0, 960, 62, 62)]);
		const b = createTrack(1, { pitchCurve: [] });
		const n2 = createNote({ tick: 0, length: 960, pitch: 60, track: b.id });
		const { notes } = toEngineNotes([note, n2], map, [a, b]);
		const byTrack = (i: number) => notes.find((n) => n.track === i)!;
		expect(byTrack(0).pitchbend.length).toBeGreaterThan(0);
		expect(byTrack(1).pitchbend).toEqual([]);
	});

	it('bakes into per-note pitch points for UST export', () => {
		const baked = bakeCurve([note], track([ramp(0, 960, 60, 62)]), map);
		expect(baked[0].pitchPoints.length).toBeGreaterThan(1);
		const last = baked[0].pitchPoints[baked[0].pitchPoints.length - 1];
		expect(last.y).toBeGreaterThan(100);
	});
});
