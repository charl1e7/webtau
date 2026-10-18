/** Small seeded generator for property-style tests: failures reproduce from the seed. */
export function rng(seed: number) {
	let a = seed >>> 0 || 1;
	const next = () => {
		// mulberry32
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		/** Integer in [lo, hi]. */
		int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
		float: (lo: number, hi: number) => lo + next() * (hi - lo),
		pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
		bool: (p = 0.5) => next() < p
	};
}

export type Rng = ReturnType<typeof rng>;

/** Runs `fn` for many seeds; the seed is part of the failure message. */
export function forSeeds(count: number, fn: (r: Rng, seed: number) => void, base = 1) {
	for (let s = base; s < base + count; s++) {
		try {
			fn(rng(s), s);
		} catch (e) {
			if (e instanceof Error) e.message = `[seed ${s}] ${e.message}`;
			throw e;
		}
	}
}
