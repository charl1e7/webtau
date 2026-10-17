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
	return a.pitch + ((b.pitch - a.pitch) * Math.min(1, Math.max(0, tick - a.tick))) / span;
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
	return strokes.map((s) => ({
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
