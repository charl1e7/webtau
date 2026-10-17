import { describe, expect, it } from 'vitest';
import { BLOCK, DEFAULT_CEILING, LIMITER_LOOKAHEAD, limit } from './limiter';

const SR = 44100;

/** Voice-like test signal: a few sines, with a loud stretch in the middle. */
function signal(seconds: number, loudFrom: number, loudTo: number, level: number): Float32Array {
	const out = new Float32Array(Math.floor(seconds * SR));
	for (let i = 0; i < out.length; i++) {
		const t = i / SR;
		const amp = t >= loudFrom && t < loudTo ? level : 0.3;
		out[i] =
			amp * (0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.4 * Math.sin(2 * Math.PI * 660 * t + 1));
	}
	return out;
}

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('limiter', () => {
	it('leaves audio below the ceiling exactly as it is', () => {
		const pcm = signal(1, 0, 0, 0.5);
		const { pcm: out, minGain } = limit(pcm, 0, pcm.length);
		expect(minGain).toBe(1);
		expect(Array.from(out)).toEqual(Array.from(pcm));
	});

	it('never lets a sample past the ceiling, however loud', () => {
		for (const level of [1.2, 2, 5, 40]) {
			const pcm = signal(2, 0.7, 1.3, level);
			const { pcm: out, minGain } = limit(pcm, 0, pcm.length);
			expect(peak(out)).toBeLessThanOrEqual(DEFAULT_CEILING + 1e-6);
			expect(minGain).toBeLessThan(1);
		}
	});

	it('only touches the neighbourhood of the loud part', () => {
		const pcm = signal(3, 1.4, 1.6, 3);
		const { pcm: out } = limit(pcm, 0, pcm.length);
		// Far before and far after: untouched.
		expect(out[Math.floor(0.5 * SR)]).toBe(pcm[Math.floor(0.5 * SR)]);
		expect(out[Math.floor(2.8 * SR)]).toBe(pcm[Math.floor(2.8 * SR)]);
		// The signal is not turned into mush: the quiet part right after recovers within a second.
		const after = Math.floor(2.2 * SR);
		expect(Math.abs(out[after])).toBeCloseTo(Math.abs(pcm[after]), 5);
	});

	it('gives the same samples however the song is cut into pieces', () => {
		const pcm = signal(2, 0.5, 1.2, 3);
		const whole = limit(pcm, 0, pcm.length).pcm;
		for (const size of [997, 8820, 12345]) {
			const stitched = new Float32Array(pcm.length);
			for (let from = 0; from < pcm.length; from += size) {
				const to = Math.min(pcm.length, from + size);
				stitched.set(limit(pcm, from, to).pcm, from);
			}
			let worst = 0;
			for (let i = 0; i < pcm.length; i++)
				worst = Math.max(worst, Math.abs(stitched[i] - whole[i]));
			expect(worst).toBe(0);
		}
	});

	it('moves smoothly: no step in the gain', () => {
		const pcm = new Float32Array(SR).fill(0);
		pcm.fill(2, SR / 2, SR / 2 + 2000); // a hard DC burst, the worst case for steps
		const { pcm: out } = limit(pcm, 0, pcm.length);
		let step = 0;
		for (let i = SR / 2 - 6000; i < SR / 2 + 8000; i++) {
			const g = (j: number) => (pcm[j] === 0 ? NaN : out[j] / pcm[j]);
			if (!Number.isNaN(g(i)) && !Number.isNaN(g(i - 1)))
				step = Math.max(step, Math.abs(g(i) - g(i - 1)));
		}
		expect(step).toBeLessThan(0.002);
		expect(peak(out)).toBeLessThanOrEqual(DEFAULT_CEILING + 1e-6);
	});

	it('already dips before the peak arrives (look-ahead) and recovers after it', () => {
		const pcm = new Float32Array(SR);
		const at = SR / 2;
		pcm.fill(0.4);
		pcm.fill(1.9, at, at + BLOCK);
		const { pcm: out } = limit(pcm, 0, pcm.length);
		const gainAt = (i: number) => out[i] / pcm[i];
		expect(gainAt(at - 20 * BLOCK)).toBeLessThan(1);
		expect(gainAt(at - 200 * BLOCK)).toBe(1);
		expect(gainAt(at + 200 * BLOCK)).toBe(1);
		expect(gainAt(at + 5 * BLOCK)).toBeLessThan(gainAt(at + 100 * BLOCK));
	});

	it('needs only a bounded look-ahead: audio further away does not change a piece', () => {
		const a = signal(3, 0.2, 0.4, 1);
		const b = a.slice();
		// A huge peak well beyond the declared look-ahead.
		const far = Math.floor(1 * SR) + LIMITER_LOOKAHEAD + 4 * BLOCK;
		b.fill(9, far, far + 500);
		const piece = (pcm: Float32Array) => limit(pcm, Math.floor(0.9 * SR), Math.floor(1 * SR)).pcm;
		expect(Array.from(piece(a))).toEqual(Array.from(piece(b)));
	});

	it('treats the area outside the song as silence', () => {
		const pcm = new Float32Array(1000).fill(3);
		const { pcm: out } = limit(pcm, 0, 2000);
		expect(out.length).toBe(2000);
		expect(Math.max(...out.slice(0, 1000).map(Math.abs))).toBeLessThanOrEqual(
			DEFAULT_CEILING + 1e-6
		);
		expect(limit(pcm, 5, 5).pcm.length).toBe(0);
	});
});
