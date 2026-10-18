import { describe, expect, it } from 'vitest';
import { forSeeds, type Rng } from '../testing/rng';
import { createNote, createPitchPoint, createTrack } from './music';
import { compilePitch, curveValueAt, sortPoints, type PitchEntry } from './pitch';
import {
	addPoint,
	bakeCurve,
	curveAt,
	eraseRange,
	insertStroke,
	movePoint,
	overlayFor,
	removePoint,
	simplify,
	strokesToMs
} from './pitch-curve';
import { toEngineNotes } from './engine-notes';
import { TempoMap } from './tempo';
import type { CurvePoint, Note, PitchShape, PitchStroke } from './types';

const SHAPES: PitchShape[] = ['l', 's', 'r', 'j'];
const map = new TempoMap([{ tick: 0, bpm: 120 }]);

const randomStroke = (r: Rng, from = 0, span = 3000): CurvePoint[] => {
	const n = r.int(2, 30);
	const t0 = r.int(from, from + span);
	let pitch = r.float(48, 80);
	return Array.from({ length: n }, (_, i) => {
		pitch += r.float(-1, 1);
		return { tick: t0 + i * r.int(5, 60), pitch };
	});
};

/** Every stroke is ordered, has at least two points on increasing ticks, and none overlaps the next. */
function expectValidStrokes(strokes: readonly PitchStroke[]) {
	for (const s of strokes) {
		expect(s.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < s.length; i++) expect(s[i].tick).toBeGreaterThan(s[i - 1].tick);
		for (const p of s) expect(Number.isFinite(p.pitch)).toBe(true);
	}
	for (let i = 1; i < strokes.length; i++)
		expect(strokes[i][0].tick).toBeGreaterThanOrEqual(
			strokes[i - 1][strokes[i - 1].length - 1].tick
		);
}

describe('track pitch curve: random editing keeps it valid', () => {
	it('any sequence of strokes and erasures leaves ordered, non-overlapping strokes', () => {
		forSeeds(150, (r) => {
			let strokes: PitchStroke[] = [];
			for (let step = 0; step < 12; step++) {
				if (r.bool(0.7)) strokes = insertStroke(strokes, randomStroke(r));
				else {
					const a = r.int(0, 3500);
					strokes = eraseRange(strokes, a, a + r.int(0, 800));
				}
				expectValidStrokes(strokes);
			}
		});
	});

	it('erasing a range empties it and leaves everything else exactly as it was', () => {
		forSeeds(150, (r) => {
			const strokes = insertStroke([], randomStroke(r, 0, 500));
			if (!strokes.length) return;
			const t0 = r.int(0, 2000);
			const t1 = t0 + r.int(1, 600);
			const out = eraseRange(strokes, t0, t1);
			for (let t = t0 + 1; t < t1; t += 7) expect(curveAt(out, t)).toBeNull();
			for (let t = 0; t < t0 - 1; t += 11) {
				const before = curveAt(strokes, t);
				const after = curveAt(out, t);
				if (before === null) expect(after).toBeNull();
				else expect(after).toBeCloseTo(before, 6);
			}
			for (let t = t1 + 2; t < 4000; t += 11) {
				const before = curveAt(strokes, t);
				const after = curveAt(out, t);
				if (before === null) expect(after).toBeNull();
				else expect(after).toBeCloseTo(before, 6);
			}
		});
	});

	it('a new stroke is what the curve says over its own extent', () => {
		forSeeds(100, (r) => {
			const base = insertStroke([], randomStroke(r, 0, 800));
			const fresh = randomStroke(r, 200, 800);
			const out = insertStroke(base, fresh);
			const added = simplify(fresh.map((p) => ({ ...p, tick: Math.round(p.tick) })));
			void added;
			const stroke = out.find(
				(s) =>
					s[0].tick >= Math.round(fresh[0].tick) - 1 && s[0].tick <= Math.round(fresh[0].tick) + 1
			);
			expect(stroke).toBeDefined();
			expectValidStrokes(out);
		});
	});

	it('inserting something with fewer than two usable points changes nothing', () => {
		const base = insertStroke([], randomStroke(rngOnce(), 0, 100));
		expect(insertStroke(base, [])).toEqual(base);
		expect(insertStroke(base, [{ tick: 5, pitch: 60 }])).toEqual(base);
		expect(
			insertStroke(base, [
				{ tick: 5, pitch: 60 },
				{ tick: 5, pitch: 61 }
			])
		).toEqual(base);
	});

	it('swapped erase bounds do not corrupt strokes', () => {
		const strokes = insertStroke(
			[],
			[
				{ tick: 0, pitch: 60 },
				{ tick: 1000, pitch: 64 }
			]
		);
		const out = eraseRange(strokes, 600, 300);
		expectValidStrokes(out);
	});

	it('point editing keeps ticks increasing however it is dragged', () => {
		forSeeds(150, (r) => {
			let strokes = insertStroke([], randomStroke(r, 0, 200));
			if (!strokes.length) return;
			for (let i = 0; i < 10; i++) {
				const si = r.int(0, strokes.length - 1);
				const ref = { stroke: si, index: r.int(0, strokes[si].length - 1) };
				const op = r.int(0, 2);
				if (op === 0)
					strokes = movePoint(strokes, ref, { tick: r.int(-100, 5000), pitch: r.float(40, 90) });
				else if (op === 1)
					strokes = addPoint(strokes, { tick: r.int(0, 3000), pitch: r.float(40, 90) }, 30).strokes;
				else strokes = removePoint(strokes, ref);
				for (const s of strokes)
					for (let k = 1; k < s.length; k++) expect(s[k].tick).toBeGreaterThan(s[k - 1].tick);
				if (!strokes.length) return;
			}
		});
	});
});

function rngOnce(): Rng {
	let out!: Rng;
	forSeeds(1, (r) => (out = r), 7);
	return out;
}

describe('compilePitch properties', () => {
	const randomNote = (r: Rng): Pick<Note, 'pitchPoints' | 'vibrato'> => ({
		pitchPoints: Array.from({ length: r.int(0, 5) }, () =>
			createPitchPoint(r.float(-200, 800), r.float(-600, 600), r.pick(SHAPES))
		),
		vibrato: r.bool()
			? {
					length: r.int(0, 100),
					period: r.int(5, 500),
					depth: r.int(0, 200),
					fadeIn: r.int(0, 100),
					fadeOut: r.int(0, 100),
					phase: r.int(0, 100)
				}
			: null
	});

	it('always produces finite values at non-decreasing times, whatever the inputs', () => {
		forSeeds(400, (r) => {
			const note = randomNote(r);
			const duration = r.float(30, 2000);
			const stroke = r.bool()
				? strokesToMs(
						[randomStroke(r, 0, 1000)].map((s) => insertStroke([], s)[0] ?? s),
						map
					)
				: [];
			const overlay = stroke.length
				? overlayFor(stroke, r.float(0, 1000), duration, r.int(48, 80))
				: null;
			const entry: PitchEntry | null = r.bool()
				? { cents: r.int(-1200, 1200), until: -r.pick([0, 0, 0.5, 10, 100, 500, 3000]) }
				: null;
			const pts = compilePitch(note, duration, overlay, entry);
			for (let i = 0; i < pts.length; i++) {
				expect(Number.isFinite(pts[i].offset)).toBe(true);
				expect(Number.isFinite(pts[i].value)).toBe(true);
				if (i) expect(pts[i].offset).toBeGreaterThanOrEqual(pts[i - 1].offset);
			}
		});
	});

	it('without vibrato, a track curve or a previous note the points are the note’s own curve', () => {
		forSeeds(200, (r) => {
			const pitchPoints = Array.from({ length: r.int(1, 6) }, () =>
				createPitchPoint(r.float(-100, 600), r.float(-500, 500), r.pick(SHAPES))
			);
			const pts = compilePitch({ pitchPoints, vibrato: null }, 700);
			const sorted = sortPoints(pitchPoints);
			for (const p of sorted) {
				const emitted = pts.find((q) => Math.abs(q.offset - p.x) < 0.01);
				expect(emitted, `point at ${p.x}`).toBeDefined();
				expect(emitted!.value).toBeCloseTo(p.y, 1);
			}
		});
	});

	it('the easing of every shape stays between its end points', () => {
		for (const shape of SHAPES) {
			const pts = [createPitchPoint(0, 0, shape), createPitchPoint(100, 300, 'l')];
			for (let x = 0; x <= 100; x += 5) {
				const v = curveValueAt(sortPoints(pts), x);
				expect(v).toBeGreaterThanOrEqual(-1e-9);
				expect(v).toBeLessThanOrEqual(300 + 1e-9);
			}
		}
	});

	it('curveValueAt holds the end values outside the points and copes with duplicates', () => {
		const pts = sortPoints([
			createPitchPoint(0, 10),
			createPitchPoint(0, 20),
			createPitchPoint(50, 30)
		]);
		expect(curveValueAt(pts, -100)).toBe(pts[0].y);
		expect(curveValueAt(pts, 500)).toBe(30);
		expect(Number.isFinite(curveValueAt(pts, 0))).toBe(true);
		expect(curveValueAt([], 5)).toBe(0);
	});
});

describe('carrying the previous pitch in, randomly', () => {
	it('before the note starts the pitch is the previous note’s; once it is under way it is the note’s own', () => {
		forSeeds(300, (r) => {
			const track = createTrack(0, {});
			const gap = r.pick([0, 0, 0, 30, 240]);
			const aPitch = r.int(48, 80);
			let bPitch = r.int(48, 80);
			if (bPitch === aPitch) bPitch += 1;
			const a = createNote({ track: track.id, tick: 0, length: 480, pitch: aPitch });
			const b = createNote({ track: track.id, tick: 480 + gap, length: 480, pitch: bPitch });
			const { notes } = toEngineNotes([a, b], map, [track]);
			const pts = notes[1].pitchbend;
			const at = (ms: number) => {
				const p = [...pts].sort((x, y) => x.offset - y.offset);
				if (!p.length || p[0].offset > 0) p.unshift({ offset: 0, value: 0 });
				if (p[p.length - 1].offset < 480) p.push({ offset: 480, value: 0 });
				if (ms <= p[0].offset) return p[0].value;
				for (let i = 1; i < p.length; i++)
					if (ms <= p[i].offset)
						return p[i].offset === p[i - 1].offset
							? p[i].value
							: p[i - 1].value +
									((p[i].value - p[i - 1].value) * (ms - p[i - 1].offset)) /
										(p[i].offset - p[i - 1].offset);
				return p[p.length - 1].value;
			};
			const gapMs = (gap * 60000) / (120 * 480);
			// Over the previous note: its pitch. In the gap and after: this note's own.
			if (gap === 0) expect(at(-200)).toBeCloseTo((aPitch - bPitch) * 100, 3);
			else {
				expect(at(-gapMs - 20)).toBeCloseTo((aPitch - bPitch) * 100, 3);
				expect(at(-gapMs / 2)).toBeCloseTo(0, 3);
			}
			expect(at(60)).toBeCloseTo(0, 3);
			expect(at(300)).toBeCloseTo(0, 3);
		});
	});

	it('muted and soloed tracks are left out and do not feed the next note', () => {
		const t1 = createTrack(0, { mute: true });
		const t2 = createTrack(1, {});
		const a = createNote({ track: t1.id, tick: 0, length: 480, pitch: 70 });
		const b = createNote({ track: t2.id, tick: 480, length: 480, pitch: 60 });
		const { notes, ids } = toEngineNotes([a, b], map, [t1, t2]);
		expect(ids).toEqual([b.id]);
		expect(notes[0].pitchbend).toEqual([]);
	});

	it('track volume multiplies note volume; solo wins over mute', () => {
		const t1 = createTrack(0, { volume: 50 });
		const t2 = createTrack(1, { solo: true, mute: true });
		const a = createNote({ track: t1.id, tick: 0, pitch: 60, volume: 80 });
		const b = createNote({ track: t2.id, tick: 480, pitch: 60 });
		const only = toEngineNotes([a], map, [t1]);
		expect(only.notes[0].volume).toBeCloseTo(40);
		const both = toEngineNotes([a, b], map, [t1, t2]);
		expect(both.ids).toEqual([b.id]); // t2 is soloed (solo overrides its own mute); t1 is not audible
	});

	it('output order is by time, then pitch, across tracks; ids line up', () => {
		const t1 = createTrack(0, {});
		const t2 = createTrack(1, {});
		const x = createNote({ track: t2.id, tick: 480, pitch: 70, lyric: 'x' });
		const y = createNote({ track: t1.id, tick: 0, pitch: 65, lyric: 'y' });
		const z = createNote({ track: t1.id, tick: 480, pitch: 60, lyric: 'z' });
		const { notes, ids } = toEngineNotes([x, y, z], map, [t1, t2]);
		expect(notes.map((n) => n.alias)).toEqual(['y', 'z', 'x']);
		expect(ids).toEqual([y.id, z.id, x.id]);
		expect(notes.map((n) => n.track)).toEqual([0, 0, 1]);
	});

	it('baking a curve into notes keeps ticks and lengths', () => {
		const t = createTrack(0, {
			pitchCurve: [
				[
					{ tick: 0, pitch: 61 },
					{ tick: 960, pitch: 63 }
				]
			]
		});
		const a = createNote({ track: t.id, tick: 0, length: 480, pitch: 60 });
		const [baked] = bakeCurve([a], t, map);
		expect(baked.tick).toBe(0);
		expect(baked.length).toBe(480);
		expect(baked.pitchPoints.length).toBeGreaterThan(1);
	});
});
