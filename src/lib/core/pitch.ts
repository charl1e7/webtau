import type { PitchOverlay } from './pitch-curve';
import type { Note, PitchPoint, PitchShape, Vibrato } from './types';

/** Resolution of the contour sent to the engine, in milliseconds. */
const STEP_MS = 10;

/** How far before a note's start the pitch of the previous note is carried (longer than any preutterance). */
const ENTRY_REACH_MS = 1000;
/** A note that starts where the previous one ended glides in over this long, centred on its start. */
const ENTRY_GLIDE_MS = 50;

/**
 * Where a note's sound begins before its start (the preutterance of a VCV or CV sample) the
 * pitch is that of whatever note is still sounding there: the previous one. Without this the
 * lead-in is sung at the new note's pitch while the previous note fades out at its own, which
 * is heard as two different notes at once.
 */
export interface PitchEntry {
	/** Previous pitch minus this note's pitch, in cents. */
	cents: number;
	/** Where the previous note ends, in ms from this note's start (zero or less). */
	until: number;
}

export interface EnginePitchPoint {
	offset: number;
	value: number;
}

/** Easing from 0 to 1 for a pitch segment. */
export function ease(shape: PitchShape, t: number): number {
	switch (shape) {
		case 's':
			return (1 - Math.cos(Math.PI * t)) / 2;
		case 'r': // quick start, slow end
			return Math.sin((Math.PI * t) / 2);
		case 'j': // slow start, quick end
			return 1 - Math.cos((Math.PI * t) / 2);
		default:
			return t;
	}
}

export function sortPoints(points: readonly PitchPoint[]): PitchPoint[] {
	return [...points].sort((a, b) => a.x - b.x);
}

/** Pitch deviation (cents) of the hand-drawn curve at time `x` (ms). */
export function curveValueAt(sorted: readonly PitchPoint[], x: number): number {
	if (!sorted.length) return 0;
	if (x <= sorted[0].x) return sorted[0].y;
	const last = sorted[sorted.length - 1];
	if (x >= last.x) return last.y;
	let lo = 0;
	let hi = sorted.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid].x <= x) lo = mid;
		else hi = mid;
	}
	const a = sorted[lo];
	const b = sorted[hi];
	const span = b.x - a.x;
	if (span <= 0) return b.y;
	return a.y + (b.y - a.y) * ease(a.shape, (x - a.x) / span);
}

export function vibratoValueAt(v: Vibrato, x: number, durationMs: number): number {
	const vibLen = (durationMs * v.length) / 100;
	if (vibLen <= 0 || v.depth === 0 || v.period <= 0) return 0;
	const start = durationMs - vibLen;
	const t = x - start;
	if (t < 0 || t > vibLen) return 0;
	const fadeIn = (vibLen * v.fadeIn) / 100;
	const fadeOut = (vibLen * v.fadeOut) / 100;
	let env = 1;
	if (fadeIn > 0 && t < fadeIn) env = t / fadeIn;
	if (fadeOut > 0 && vibLen - t < fadeOut) env = Math.min(env, (vibLen - t) / fadeOut);
	return v.depth * env * Math.sin(2 * Math.PI * (t / v.period + v.phase / 100));
}

/**
 * Flattens a note's pitch description (shaped points + vibrato) into the
 * plain list of (ms, cents) points that the synthesis engine understands.
 */
export function compilePitch(
	note: Pick<Note, 'pitchPoints' | 'vibrato'>,
	durationMs: number,
	overlay: PitchOverlay | null = null,
	entryIn: PitchEntry | null = null
): EnginePitchPoint[] {
	const sorted = sortPoints(note.pitchPoints);
	const vib = note.vibrato && note.vibrato.depth !== 0 ? note.vibrato : null;
	// The note's own curve takes over from the carried pitch where it begins.
	const own = sorted.length ? sorted[0].x : overlay ? overlay.from : null;
	const entry =
		entryIn && entryIn.cents !== 0 && Math.min(entryIn.until, own ?? 0) > -ENTRY_REACH_MS + 1
			? entryIn
			: null;
	if (!sorted.length && !vib && !overlay && !entry) return [];

	const out: EnginePitchPoint[] = [];
	const push = (offset: number, value: number) => {
		out.push({ offset: round(offset), value: round(value) });
	};

	// The carried pitch ends where the note's own curve begins, or at the note start.
	const glide = !!entry && entry.until > -1 && own === null;
	const stop = entry ? Math.min(entry.until, 0, own ?? 0) : 0;
	const entryAt = (x: number): number => {
		if (!entry) return 0;
		if (glide) {
			if (x <= -ENTRY_GLIDE_MS / 2) return entry.cents;
			if (x >= ENTRY_GLIDE_MS / 2) return 0;
			return entry.cents * (1 - ease('s', (x + ENTRY_GLIDE_MS / 2) / ENTRY_GLIDE_MS));
		}
		return x < stop ? entry.cents : 0;
	};
	/** Points that carry the previous pitch up to where it stops, then hold the note's own pitch. */
	const pushEntry = (until: number) => {
		if (!entry) return;
		push(-ENTRY_REACH_MS, entry.cents);
		if (glide) {
			push(-ENTRY_GLIDE_MS / 2, entry.cents);
			push(ENTRY_GLIDE_MS / 2, 0);
			return;
		}
		push(stop - 0.01, entry.cents);
		// Where the note's own curve begins right there, it sets the value itself.
		if (own !== null && stop >= own) return;
		push(stop, 0);
		if (until - stop > 0.02) push(until - 0.01, 0);
	};

	if (!vib && !overlay) {
		pushEntry(Math.min(0, sorted.length ? sorted[0].x : 0));
		if (entry && sorted.length && sorted[0].x > 0) push(0, 0);
		for (let i = 0; i < sorted.length; i++) {
			const a = sorted[i];
			push(a.x, a.y);
			const b = sorted[i + 1];
			if (b && a.shape !== 'l') {
				const n = Math.max(2, Math.ceil((b.x - a.x) / STEP_MS));
				for (let k = 1; k < n; k++) {
					const x = a.x + ((b.x - a.x) * k) / n;
					push(x, curveValueAt(sorted, x));
				}
			}
		}
		return out;
	}

	// Only a track curve: sample just the stretch that it bends.
	const overlayOnly = !!overlay && !vib && !sorted.length;
	let from = overlayOnly
		? overlay!.from
		: Math.min(0, sorted.length ? sorted[0].x : 0, overlay?.from ?? 0);
	if (entry) {
		from = Math.min(from, glide ? -ENTRY_GLIDE_MS / 2 : stop - 1);
		if (from > -ENTRY_REACH_MS) push(-ENTRY_REACH_MS, entry.cents);
	}
	const to = overlayOnly
		? overlay!.to
		: Math.max(durationMs, sorted.length ? sorted[sorted.length - 1].x : 0, overlay?.to ?? 0);
	// Before its first point the note's curve gives way to the carried pitch.
	const custom = (x: number) =>
		entry && sorted.length && x < Math.min(0, sorted[0].x) ? 0 : curveValueAt(sorted, x);
	const total = (x: number) =>
		custom(x) +
		(vib ? vibratoValueAt(vib, x, durationMs) : 0) +
		(overlay && x >= overlay.from && x <= overlay.to ? overlay.at(x) : 0) +
		entryAt(x);
	for (let x = from; x < to; x += STEP_MS) push(x, total(x));
	push(to, total(to));
	return out;
}

function round(v: number): number {
	return Math.round(v * 100) / 100;
}

/**
 * Preset: slide into the note from `fromCents` below/above over `ms`.
 * Returns pitch points to store on the note.
 */
export function portamentoPoints(
	mkPoint: (x: number, y: number, shape: PitchShape) => PitchPoint,
	fromCents: number,
	ms: number
): PitchPoint[] {
	return [mkPoint(-ms, fromCents, 's'), mkPoint(0, 0, 'l')];
}
