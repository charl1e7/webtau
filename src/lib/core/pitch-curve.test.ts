import { describe, expect, it } from 'vitest';
import { createNote, createTrack } from './music';
import { compilePitch } from './pitch';
import {
	addPoint,
	bakeCurve,
	curveAt,
	eraseRange,
	followMovedNotes,
	insertStroke,
	movePoint,
	overlayFor,
	paintStrokeOnNotes,
	removePoint,
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

	it('interpolates along slopes (cut edges keep the drawn value)', () => {
		const s = [ramp(0, 1920, 60, 66, 4)];
		expect(curveAt(s, 600)).toBeCloseTo(61.875, 5);
		const cut = eraseRange(s, 600, 1200);
		expect(cut[0][cut[0].length - 1]).toEqual({ tick: 600, pitch: expect.closeTo(61.875, 5) });
		expect(cut[1][0]).toEqual({ tick: 1200, pitch: expect.closeTo(63.75, 5) });
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

describe('placing points by hand', () => {
	const gap = 1920;
	it('starts a stroke, extends it, and inserts between existing points', () => {
		let strokes = addPoint([], { tick: 100, pitch: 60 }, gap).strokes;
		expect(strokes).toEqual([[{ tick: 100, pitch: 60 }]]);
		strokes = addPoint(strokes, { tick: 900, pitch: 62 }, gap).strokes;
		expect(strokes).toHaveLength(1);
		const mid = addPoint(strokes, { tick: 500, pitch: 65 }, gap);
		expect(mid.strokes[0].map((p) => p.tick)).toEqual([100, 500, 900]);
		expect(mid.at).toEqual({ stroke: 0, index: 1 });
	});

	it('a point far from every stroke starts a new one', () => {
		const first = addPoint([], { tick: 0, pitch: 60 }, gap).strokes;
		const far = addPoint(first, { tick: 9000, pitch: 61 }, gap);
		expect(far.strokes).toHaveLength(2);
		expect(far.at).toEqual({ stroke: 1, index: 0 });
	});

	it('a moved point stays between its neighbours', () => {
		const s = [
			[
				{ tick: 0, pitch: 60 },
				{ tick: 500, pitch: 61 },
				{ tick: 900, pitch: 62 }
			]
		];
		const moved = movePoint(s, { stroke: 0, index: 1 }, { tick: 5000, pitch: 70 });
		expect(moved[0][1]).toEqual({ tick: 899, pitch: 70 });
		expect(removePoint(moved, { stroke: 0, index: 1 })[0]).toHaveLength(2);
		expect(removePoint([[{ tick: 1, pitch: 1 }]], { stroke: 0, index: 0 })).toEqual([]);
	});

	it('a lone point does not bend a note', () => {
		const n = createNote({ tick: 0, length: 960, pitch: 60 });
		const t = createTrack(0, { pitchCurve: [[{ tick: 300, pitch: 64 }]] });
		expect(toEngineNotes([n], map, [t]).notes[0].pitchbend).toEqual([]);
	});
});

describe('freehand drawing in the single-note mode', () => {
	it('writes the stroke into the notes it passes over and keeps points outside it', () => {
		const a = createNote({ tick: 0, length: 960, pitch: 60 });
		const b = createNote({ tick: 960, length: 960, pitch: 64 });
		const painted = paintStrokeOnNotes(
			[a, b],
			[...ramp(200, 700, 61, 62, 10), ...ramp(700, 1700, 62, 65, 20).slice(1)],
			map,
			() => true
		);
		expect(painted[0].pitchPoints.length).toBeGreaterThan(1);
		expect(painted[1].pitchPoints.length).toBeGreaterThan(1);
		const last = painted[1].pitchPoints[painted[1].pitchPoints.length - 1];
		expect(last.y).toBeCloseTo(100, -1); // 65 over a note on 64
	});

	it('leaves excluded notes alone', () => {
		const a = createNote({ tick: 0, length: 960, pitch: 60 });
		const out = paintStrokeOnNotes([a], ramp(0, 900, 61, 62), map, () => false);
		expect(out[0]).toBe(a);
	});
});

describe('the curve follows notes that move', () => {
	const a = createNote({ tick: 0, length: 960, pitch: 60 });
	const b = createNote({ tick: 960, length: 960, pitch: 64 });
	const track = () => createTrack(0, { pitchCurve: [ramp(100, 1800, 60, 66, 8)] });

	it('transposing a note shifts only the curve under it', () => {
		const t = track();
		const [out] = followMovedNotes([t], [a, b], [{ ...a, pitch: 62 }, b]);
		expect(curveAt(out.pitchCurve, 400)).toBeCloseTo(curveAt(t.pitchCurve, 400)! + 2, 5);
		expect(curveAt(out.pitchCurve, 1400)).toBeCloseTo(curveAt(t.pitchCurve, 1400)!, 5);
	});

	it('moving in time carries the curve to the new place', () => {
		const t = track();
		const [out] = followMovedNotes([t], [a, b], [a, { ...b, tick: 1440 }]);
		expect(curveAt(out.pitchCurve, 1500)).toBeCloseTo(curveAt(t.pitchCurve, 1020)!, 5);
	});

	it('does nothing for resizes, other tracks and tracks without a curve', () => {
		const t = track();
		expect(followMovedNotes([t], [a], [{ ...a, length: 480 }])).toEqual([t]);
		const blank = createTrack(1, {});
		expect(followMovedNotes([blank], [a], [{ ...a, pitch: 70 }])).toEqual([blank]);
		const other = { ...a, pitch: 70, track: 'elsewhere' };
		expect(followMovedNotes([t], [a], [other])[0]).toBe(t);
	});
});

describe('project files and the curve', async () => {
	const { parseProject, serializeProject } = await import('../io/project-file');

	it('round-trips curves, including a lone point', () => {
		const track = createTrack(0, {
			pitchCurve: [ramp(0, 960, 60, 62, 2), [{ tick: 3000, pitch: 64 }]]
		});
		const data = {
			name: 'x',
			notes: [],
			tracks: [track],
			tempos: [],
			timeSignature: { numerator: 4, denominator: 4 },
			voicebank: ''
		};
		const back = parseProject(serializeProject(data));
		expect(back.tracks[0].pitchCurve).toEqual(track.pitchCurve);
	});

	it('loads files written before curves existed and drops broken strokes', () => {
		const old = JSON.stringify({
			format: 'webtau-project',
			version: 1,
			tracks: [{ id: 't', name: 'Old', color: '#fff', mute: false, solo: false, volume: 100 }],
			notes: []
		});
		expect(parseProject(old).tracks[0].pitchCurve).toEqual([]);
		const broken = JSON.stringify({
			format: 'webtau-project',
			tracks: [{ id: 't', pitchCurve: [[{ tick: 'a' }], 'x', [{ tick: 1, pitch: 60 }]] }],
			notes: []
		});
		expect(parseProject(broken).tracks[0].pitchCurve).toEqual([[{ tick: 1, pitch: 60 }]]);
	});
});
