/**
 * A look-ahead peak limiter that works on any piece of a mix without remembering anything
 * between pieces. The gain at a moment depends only on the audio around that moment, so the
 * result is the same whichever way the song is cut into pieces, whatever is played first and
 * wherever the playhead jumps — which is what lets playback limit audio that is still being
 * rendered, with no second pass and no whole-song peak search.
 *
 * Quiet audio passes untouched (gain 1 exactly). Where it would exceed the ceiling the gain
 * dips smoothly: it starts falling before the peak and recovers slowly after it.
 */

/** Gain is decided per block of this many samples (2 ms at 44.1 kHz). */
export const BLOCK = 88;
/** The gain starts falling this many blocks before a peak … */
const ATTACK = 30;
/** … and stays down this many blocks after it. */
const RELEASE = 120;
/** The two stages are smoothed with a box of this half-width (must stay below ATTACK). */
const SMOOTH = ATTACK - 1;

/**
 * How much final audio must exist after a sample before its limited value is known.
 * (Gain of a block depends on blocks up to SMOOTH + RELEASE later; interpolation looks one more ahead.)
 */
export const LIMITER_LOOKAHEAD = (SMOOTH + RELEASE + 2) * BLOCK;

export const DEFAULT_CEILING = 0.95;

export interface Limited {
	pcm: Float32Array;
	/** Smallest gain applied to this piece (1 = untouched). */
	minGain: number;
}

/**
 * The samples [from, to) of `pcm` with the limiter applied. Audio outside `pcm` counts as
 * silence. Returns a view of `pcm` itself when nothing needed limiting.
 */
export function limit(
	pcm: Float32Array,
	from: number,
	to: number,
	ceiling = DEFAULT_CEILING
): Limited {
	const piece = pcm.subarray(Math.max(0, from), Math.max(0, Math.min(to, pcm.length)));
	if (to <= from) return { pcm: piece, minGain: 1 };

	// Gains are needed for blocks b0 … b1 (each sample is interpolated between two block centres).
	const b0 = Math.floor(from / BLOCK) - 1;
	const b1 = Math.floor((to - 1) / BLOCK) + 1;
	// Which blocks have to be looked at, working backwards through the stages.
	const m0 = b0 - SMOOTH;
	const m1 = b1 + SMOOTH;
	const t0 = m0 - ATTACK;
	const t1 = m1 + RELEASE;

	// Stage 0: the gain each block alone needs.
	const target = new Float32Array(t1 - t0 + 1).fill(1);
	let needed = false;
	for (let b = t0; b <= t1; b++) {
		const start = Math.max(0, b * BLOCK);
		const end = Math.min(pcm.length, (b + 1) * BLOCK);
		let peak = 0;
		for (let i = start; i < end; i++) {
			const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
			if (v > peak) peak = v;
		}
		if (peak > ceiling) {
			target[b - t0] = ceiling / peak;
			needed = true;
		}
	}
	if (!needed) return { pcm: piece, minGain: 1 };

	// Stage 1: the lowest target within the attack/release window.
	const held = new Float32Array(m1 - m0 + 1);
	for (let x = m0; x <= m1; x++) {
		let low = 1;
		for (let y = x - ATTACK; y <= x + RELEASE; y++) low = Math.min(low, target[y - t0]);
		held[x - m0] = low;
	}
	// Stage 2: smooth it, so the gain moves in ramps instead of steps.
	const gain = new Float32Array(b1 - b0 + 1);
	for (let b = b0; b <= b1; b++) {
		let sum = 0;
		for (let x = b - SMOOTH; x <= b + SMOOTH; x++) sum += held[x - m0];
		gain[b - b0] = sum / (2 * SMOOTH + 1);
	}

	const out = new Float32Array(to - from);
	let minGain = 1;
	const last = Math.min(to, pcm.length);
	for (let s = Math.max(from, 0); s < last; s++) {
		const x = s / BLOCK - 0.5;
		const i = Math.floor(x);
		const f = x - i;
		const g = gain[i - b0] * (1 - f) + gain[i + 1 - b0] * f;
		if (g < minGain) minGain = g;
		out[s - from] = pcm[s] * g;
	}
	return { pcm: out, minGain };
}
