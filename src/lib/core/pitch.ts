import type { PitchOverlay } from './pitch-curve';
import type { Note, PitchPoint, PitchShape, Vibrato } from './types';

/** Resolution of the contour sent to the engine, in milliseconds. */
const STEP_MS = 10;

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
	overlay: PitchOverlay | null = null
): EnginePitchPoint[] {
	const sorted = sortPoints(note.pitchPoints);
	const vib = note.vibrato && note.vibrato.depth !== 0 ? note.vibrato : null;
	if (!sorted.length && !vib && !overlay) return [];

	const out: EnginePitchPoint[] = [];
	const push = (offset: number, value: number) => {
		out.push({ offset: round(offset), value: round(value) });
	};

	if (!vib && !overlay) {
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
	const from = overlayOnly
		? overlay!.from
		: Math.min(0, sorted.length ? sorted[0].x : 0, overlay?.from ?? 0);
	const to = overlayOnly
		? overlay!.to
		: Math.max(durationMs, sorted.length ? sorted[sorted.length - 1].x : 0, overlay?.to ?? 0);
	const total = (x: number) =>
		curveValueAt(sorted, x) +
		(vib ? vibratoValueAt(vib, x, durationMs) : 0) +
		(overlay && x >= overlay.from && x <= overlay.to ? overlay.at(x) : 0);
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
