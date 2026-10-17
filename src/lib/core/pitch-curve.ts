import { createPitchPoint } from './music';
import { compilePitch } from './pitch';
import type { TempoMap } from './tempo';
import type { CurvePoint, Note, PitchStroke, Track } from './types';

/** Strokes are simplified until the curve deviates by more than this many semitones. */
const SIMPLIFY_TOLERANCE = 0.03;
/** How far before its start a note may be bent by a stroke that runs into it, ms. */
const LEAD_MS = 300;
/** A stroke ends with a short ramp back to the note's own pitch, ms. */
const FADE_MS = 40;

function valueAt(stroke: readonly CurvePoint[], tick: number): number {
	let lo = 0;
	let hi = stroke.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (stroke[mid].tick <= tick) lo = mid;
		else hi = mid;
	}
	const a = stroke[lo];
	const b = stroke[hi];
	const span = b.tick - a.tick;
	if (span <= 0) return b.pitch;
	return a.pitch + (b.pitch - a.pitch) * Math.min(1, Math.max(0, (tick - a.tick) / span));
}

/** Pitch of the curve at `tick`, or null where no stroke covers it. */
export function curveAt(strokes: readonly PitchStroke[], tick: number): number | null {
	for (const s of strokes) {
		if (tick >= s[0].tick && tick <= s[s.length - 1].tick) return valueAt(s, tick);
	}
	return null;
}

/** Orders by time and keeps the last point when several share a tick. */
function tidy(points: readonly CurvePoint[]): CurvePoint[] {
	const sorted = points
		.map((p) => ({ tick: Math.round(p.tick), pitch: p.pitch }))
		.sort((a, b) => a.tick - b.tick);
	const out: CurvePoint[] = [];
	for (const p of sorted) {
		if (out.length && out[out.length - 1].tick === p.tick) out[out.length - 1] = p;
		else out.push(p);
	}
	return out;
}

/** Light 1-2-1 smoothing that takes the jitter of a hand out of the line. */
function smooth(points: readonly CurvePoint[]): CurvePoint[] {
	if (points.length < 3) return [...points];
	return points.map((p, i) =>
		i === 0 || i === points.length - 1
			? p
			: { tick: p.tick, pitch: (points[i - 1].pitch + 2 * p.pitch + points[i + 1].pitch) / 4 }
	);
}

/** Douglas–Peucker on the pitch axis: drops points that the line between neighbours already predicts. */
export function simplify(
	points: readonly CurvePoint[],
	tolerance = SIMPLIFY_TOLERANCE
): CurvePoint[] {
	if (points.length < 3) return [...points];
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length) {
		const [from, to] = stack.pop()!;
		const a = points[from];
		const b = points[to];
		let worst = 0;
		let at = -1;
		for (let i = from + 1; i < to; i++) {
			const t = (points[i].tick - a.tick) / (b.tick - a.tick || 1);
			const err = Math.abs(points[i].pitch - (a.pitch + (b.pitch - a.pitch) * t));
			if (err > worst) {
				worst = err;
				at = i;
			}
		}
		if (at > 0 && worst > tolerance) {
			keep[at] = 1;
			stack.push([from, at], [at, to]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

/** Cuts the part between `t0` and `t1` out of every stroke. */
export function eraseRange(strokes: readonly PitchStroke[], t0: number, t1: number): PitchStroke[] {
	const out: PitchStroke[] = [];
	for (const s of strokes) {
		const first = s[0].tick;
		const last = s[s.length - 1].tick;
		if (last < t0 || first > t1) {
			out.push(s);
			continue;
		}
		if (first < t0) {
			const left = s.filter((p) => p.tick < t0);
			left.push({ tick: t0, pitch: valueAt(s, t0) });
			if (left.length >= 2) out.push(left);
		}
		if (last > t1) {
			const right = s.filter((p) => p.tick > t1);
			right.unshift({ tick: t1, pitch: valueAt(s, t1) });
			if (right.length >= 2) out.push(right);
		}
	}
	return out;
}

/** Adds a freshly drawn stroke; what it covers replaces the older strokes underneath. */
export function insertStroke(
	strokes: readonly PitchStroke[],
	raw: readonly CurvePoint[]
): PitchStroke[] {
	const stroke = simplify(smooth(tidy(raw)));
	if (stroke.length < 2) return [...strokes];
	const rest = eraseRange(strokes, stroke[0].tick, stroke[stroke.length - 1].tick);
	return [...rest, stroke].sort((a, b) => a[0].tick - b[0].tick);
}

// ---- engine side ------------------------------------------------------------------------

/** A stroke converted to milliseconds, ready for sampling. */
export interface MsStroke {
	ms: number[];
	pitch: number[];
}

export function strokesToMs(strokes: readonly PitchStroke[], map: TempoMap): MsStroke[] {
	// A lone point (still being placed) has no extent and does not bend anything.
	return strokes
		.filter((s) => s.length >= 2)
		.map((s) => ({
			ms: s.map((p) => map.tickToMs(p.tick)),
			pitch: s.map((p) => p.pitch)
		}));
}

function sampleMs(s: MsStroke, ms: number): number {
	let lo = 0;
	let hi = s.ms.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (s.ms[mid] <= ms) lo = mid;
		else hi = mid;
	}
	const span = s.ms[hi] - s.ms[lo];
	if (span <= 0) return s.pitch[hi];
	const t = Math.min(1, Math.max(0, (ms - s.ms[lo]) / span));
	return s.pitch[lo] + (s.pitch[hi] - s.pitch[lo]) * t;
}

/** How a track's drawn curve bends one note. Times are relative to the note start. */
export interface PitchOverlay {
	/** Range in which `at` may be non-zero. */
	from: number;
	to: number;
	/** Pitch deviation from the note's own pitch, cents. */
	at(ms: number): number;
}

/**
 * The deviation that a track's curve adds to a note, or null when no stroke
 * touches the note. A stroke that runs into the note from before its start also
 * bends the lead-in (a glide), and one that ends inside it ramps back to the
 * note's own pitch.
 */
export function overlayFor(
	strokes: readonly MsStroke[],
	noteStartMs: number,
	durationMs: number,
	notePitch: number
): PitchOverlay | null {
	const used: { s: MsStroke; a: number; b: number }[] = [];
	for (const s of strokes) {
		const a = s.ms[0] - noteStartMs;
		const b = s.ms[s.ms.length - 1] - noteStartMs;
		if (b >= 0 && a <= durationMs) used.push({ s, a, b });
	}
	if (!used.length) return null;
	const first = used[0];
	const last = used[used.length - 1];
	const from = first.a < 0 ? Math.max(-LEAD_MS, first.a) : Math.max(0, first.a - FADE_MS);
	const to = last.b > durationMs ? durationMs : Math.min(durationMs, last.b + FADE_MS);
	return {
		from,
		to,
		at(ms) {
			for (const { s, a, b } of used) {
				if (ms >= a && ms <= b) return (sampleMs(s, noteStartMs + ms) - notePitch) * 100;
				if (ms < a && ms >= a - FADE_MS && a > 0) {
					const edge = (s.pitch[0] - notePitch) * 100;
					return edge * (1 - (a - ms) / FADE_MS);
				}
				if (ms > b && ms <= b + FADE_MS) {
					const edge = (s.pitch[s.pitch.length - 1] - notePitch) * 100;
					return edge * (1 - (ms - b) / FADE_MS);
				}
			}
			return 0;
		}
	};
}

/**
 * Writes a track's drawn curve into the per-note pitch points (what UST can
 * hold). Notes that no stroke touches are returned as they are.
 */
export function bakeCurve(notes: readonly Note[], track: Track, map: TempoMap): Note[] {
	if (!track.pitchCurve?.length) return [...notes];
	const strokes = strokesToMs(track.pitchCurve, map);
	return notes.map((n) => {
		const start = map.tickToMs(n.tick);
		const duration = map.tickToMs(n.tick + n.length) - start;
		const overlay = overlayFor(strokes, start, duration, n.pitch);
		if (!overlay) return n;
		const raw = compilePitch({ pitchPoints: n.pitchPoints, vibrato: null }, duration, overlay);
		const thin = simplify(
			raw.map((p) => ({ tick: p.offset, pitch: p.value })),
			2
		);
		return {
			...n,
			pitchPoints: thin.map((p) => createPitchPoint(Math.round(p.tick), Math.round(p.pitch), 'l'))
		};
	});
}

// ---- point editing (the "points" drawing style) --------------------------------------------

export interface PointRef {
	stroke: number;
	index: number;
}

/**
 * Places a point on the curve: inside a stroke it is inserted between its
 * neighbours, close to the end of a stroke it extends that stroke, and anywhere
 * else it starts a new one.
 */
export function addPoint(
	strokes: readonly PitchStroke[],
	pt: CurvePoint,
	joinGap: number
): { strokes: PitchStroke[]; at: PointRef } {
	const tick = Math.max(0, Math.round(pt.tick));
	const point = { tick, pitch: pt.pitch };
	const next = strokes.map((s) => [...s]);

	let best = -1;
	let bestGap = Infinity;
	next.forEach((s, i) => {
		const first = s[0].tick;
		const last = s[s.length - 1].tick;
		const gap = tick < first ? first - tick : tick > last ? tick - last : 0;
		if (gap < bestGap) {
			bestGap = gap;
			best = i;
		}
	});

	if (best < 0 || bestGap > joinGap) {
		next.push([point]);
		next.sort((a, b) => a[0].tick - b[0].tick);
		return { strokes: next, at: { stroke: next.findIndex((s) => s[0] === point), index: 0 } };
	}
	const s = next[best];
	const same = s.findIndex((q) => q.tick === tick);
	if (same >= 0) s[same] = point;
	else {
		s.push(point);
		s.sort((a, b) => a.tick - b.tick);
	}
	return { strokes: next, at: { stroke: best, index: s.indexOf(point) } };
}

/** Moves a point; it stays between its neighbours so a stroke never folds back on itself. */
export function movePoint(
	strokes: readonly PitchStroke[],
	ref: PointRef,
	to: CurvePoint
): PitchStroke[] {
	return strokes.map((s, i) => {
		if (i !== ref.stroke) return s;
		const lo = ref.index > 0 ? s[ref.index - 1].tick + 1 : 0;
		const hi = ref.index < s.length - 1 ? s[ref.index + 1].tick - 1 : Infinity;
		const tick = Math.round(Math.min(hi, Math.max(lo, to.tick)));
		return s.map((p, j) => (j === ref.index ? { tick, pitch: to.pitch } : p));
	});
}

export function removePoint(strokes: readonly PitchStroke[], ref: PointRef): PitchStroke[] {
	return strokes
		.map((s, i) => (i === ref.stroke ? s.filter((_, j) => j !== ref.index) : s))
		.filter((s) => s.length > 0);
}

// ---- freehand drawing on single notes -------------------------------------------------------

/**
 * Freehand drawing in the single-note mode: the stroke is written into the
 * pitch points of every note it passes over, replacing the points that were
 * inside the stretch it covers.
 */
export function paintStrokeOnNotes(
	notes: readonly Note[],
	raw: readonly CurvePoint[],
	map: TempoMap,
	include: (n: Note) => boolean
): Note[] {
	const stroke = simplify(smooth(tidy(raw)));
	if (stroke.length < 2) return notes as Note[];
	const [ms] = strokesToMs([stroke], map);
	const sa = ms.ms[0];
	const sb = ms.ms[ms.ms.length - 1];
	return notes.map((n) => {
		if (!include(n)) return n;
		const start = map.tickToMs(n.tick);
		const duration = map.tickToMs(n.tick + n.length) - start;
		const a = Math.max(0, sa - start);
		const b = Math.min(duration, sb - start);
		if (b - a < 10) return n;
		const samples: CurvePoint[] = [];
		for (let x = a; x < b; x += 10) {
			samples.push({ tick: x, pitch: (sampleMs(ms, start + x) - n.pitch) * 100 });
		}
		samples.push({ tick: b, pitch: (sampleMs(ms, start + b) - n.pitch) * 100 });
		const painted = simplify(samples, 2).map((p) =>
			createPitchPoint(Math.round(p.tick), Math.round(p.pitch), 'l')
		);
		const kept = n.pitchPoints.filter((p) => p.x < a - 0.5 || p.x > b + 0.5);
		return { ...n, pitchPoints: [...kept, ...painted].sort((p, q) => p.x - q.x) };
	});
}

// ---- the curve follows its notes ------------------------------------------------------------

/** The parts of the strokes that lie within [t0, t1], cut exactly at the edges. */
export function clipRange(strokes: readonly PitchStroke[], t0: number, t1: number): PitchStroke[] {
	const out: PitchStroke[] = [];
	for (const s of strokes) {
		const first = s[0].tick;
		const last = s[s.length - 1].tick;
		if (last < t0 || first > t1) continue;
		const part = s.filter((p) => p.tick >= t0 && p.tick <= t1);
		if (s.length >= 2) {
			if (first < t0) part.unshift({ tick: t0, pitch: valueAt(s, t0) });
			if (last > t1) part.push({ tick: t1, pitch: valueAt(s, t1) });
		}
		if (part.length) out.push(part);
	}
	return out;
}

export interface MovedSpan {
	/** The time span the note occupied before it moved, ticks. */
	t0: number;
	t1: number;
	dTick: number;
	/** Semitones. */
	dPitch: number;
}

/**
 * Moves the part of the curve that lies under moved notes together with them
 * (what the curve did under a note before it moved is carried to where the note
 * went). What was drawn at the destination is replaced.
 */
export function shiftSpans(
	strokes: readonly PitchStroke[],
	spans: readonly MovedSpan[]
): PitchStroke[] {
	const carried = spans
		.map((sp) => ({ sp, parts: clipRange(strokes, sp.t0, sp.t1) }))
		.filter((c) => c.parts.length);
	if (!carried.length) return strokes as PitchStroke[];
	let out: PitchStroke[] = [...strokes];
	for (const { sp } of carried) out = eraseRange(out, sp.t0, sp.t1);
	for (const { sp, parts } of carried) {
		for (const part of parts) {
			const moved = part.map((p) => ({
				tick: Math.max(0, p.tick + sp.dTick),
				pitch: p.pitch + sp.dPitch
			}));
			out = [...eraseRange(out, moved[0].tick, moved[moved.length - 1].tick), moved];
		}
	}
	return out.sort((a, b) => a[0].tick - b[0].tick);
}

/**
 * Tracks whose curve follows notes that were moved (same note, same length, new
 * start or pitch) between two versions of the note list. Returns `tracks`
 * itself when nothing that has a curve moved.
 */
export function followMovedNotes(
	tracks: readonly Track[],
	before: readonly Note[],
	after: readonly Note[]
): readonly Track[] {
	if (!tracks.some((t) => t.pitchCurve.length)) return tracks;
	const old = new Map(before.map((n) => [n.id, n]));
	const moves = new Map<string, MovedSpan[]>();
	for (const n of after) {
		const o = old.get(n.id);
		if (!o || o.track !== n.track || o.length !== n.length) continue;
		const dTick = n.tick - o.tick;
		const dPitch = n.pitch - o.pitch;
		if (!dTick && !dPitch) continue;
		const list = moves.get(n.track) ?? [];
		list.push({ t0: o.tick, t1: o.tick + o.length, dTick, dPitch });
		moves.set(n.track, list);
	}
	if (!moves.size) return tracks;
	let changed = false;
	const next = tracks.map((t) => {
		const spans = moves.get(t.id);
		if (!spans || !t.pitchCurve.length) return t;
		const pitchCurve = shiftSpans(t.pitchCurve, spans);
		if (pitchCurve === t.pitchCurve) return t;
		changed = true;
		return { ...t, pitchCurve };
	});
	return changed ? next : tracks;
}
