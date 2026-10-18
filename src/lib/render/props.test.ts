import { describe, expect, it, vi } from 'vitest';
import { forSeeds, type Rng } from '../testing/rng';
import { createNote, createTrack } from '#lib/core/music';
import { complement, endOfRunAt, subtract, union, type Interval } from './intervals';
import { BLOCK, DEFAULT_CEILING, LIMITER_LOOKAHEAD, LIMITER_LOOKBACK, limit } from './limiter';
import {
	DEFAULT_RENDERER,
	RendererRegistry,
	mixOutcomes,
	startRender,
	type RenderGroup
} from './registry';
import type {
	RenderHooks,
	RenderNote,
	RenderOutcome,
	RenderStream,
	RendererBackend
} from './types';

// ---- intervals ------------------------------------------------------------------------------

const randomIntervals = (r: Rng, max = 1000): Interval[] =>
	Array.from({ length: r.int(0, 8) }, () => {
		const start = r.int(0, max);
		return { start, end: start + r.int(-20, 200) };
	});

/** Is `t` inside any of the intervals (half-open)? */
const inside = (list: readonly Interval[], t: number) =>
	list.some((i) => t >= i.start && t < i.end);

describe('interval algebra', () => {
	it('union covers exactly the same points, sorted and apart', () => {
		forSeeds(300, (r) => {
			const raw = randomIntervals(r);
			const u = union(raw);
			for (let i = 0; i < u.length; i++) {
				expect(u[i].end).toBeGreaterThan(u[i].start);
				if (i) expect(u[i].start).toBeGreaterThan(u[i - 1].end); // touching ones are merged too
			}
			for (let t = -10; t < 1300; t += 3) expect(inside(u, t), `t=${t}`).toBe(inside(raw, t));
			expect(union(u)).toEqual(u);
		});
	});

	it('does not change what it is given', () => {
		const raw = [
			{ start: 50, end: 60 },
			{ start: 0, end: 10 }
		];
		const copy = JSON.parse(JSON.stringify(raw));
		union(raw);
		expect(raw).toEqual(copy);
	});

	it('complement and the busy set tile the range exactly', () => {
		forSeeds(300, (r) => {
			const busy = randomIntervals(r);
			const from = r.int(0, 300);
			const to = from + r.int(0, 800);
			const free = complement(busy, from, to);
			for (let t = from - 5; t < to + 5; t += 2) {
				const inRange = t >= from && t < to;
				expect(inside(free, t), `t=${t}`).toBe(inRange && !inside(busy, t));
			}
		});
	});

	it('subtract is set difference', () => {
		forSeeds(300, (r) => {
			const a = randomIntervals(r);
			const b = randomIntervals(r);
			const d = subtract(a, b);
			for (let t = -5; t < 1300; t += 3) expect(inside(d, t)).toBe(inside(a, t) && !inside(b, t));
		});
	});

	it('endOfRunAt agrees with a scan', () => {
		forSeeds(300, (r) => {
			const u = union(randomIntervals(r));
			for (let i = 0; i < 20; i++) {
				const at = r.int(-10, 1300);
				const run = u.find((x) => at >= x.start && at < x.end);
				expect(endOfRunAt(u, at)).toBe(run ? run.end : at);
			}
		});
		expect(endOfRunAt([], 5)).toBe(5);
	});
});

// ---- limiter --------------------------------------------------------------------------------

const randomSignal = (r: Rng, length: number): Float32Array => {
	const out = new Float32Array(length);
	const level = r.pick([0.2, 0.9, 1.5, 4, 30]);
	for (let i = 0; i < length; i++) out[i] = (r.next() * 2 - 1) * level * (r.bool(0.02) ? 3 : 1);
	if (r.bool()) out[0] = level * 2; // peaks at the very edges
	if (r.bool()) out[length - 1] = -level * 2;
	return out;
};

describe('limiter, randomly', () => {
	it('never exceeds the ceiling, at the edges, in any piece', () => {
		forSeeds(120, (r) => {
			const pcm = randomSignal(r, r.int(1, 6000));
			const ceiling = r.pick([0.5, 0.95, 1]);
			const from = r.int(-300, pcm.length);
			const to = from + r.int(0, 3000);
			const { pcm: out } = limit(pcm, from, to, ceiling);
			for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(ceiling + 1e-6);
		});
	});

	it('is identical whichever way the song is cut up', () => {
		forSeeds(40, (r) => {
			const pcm = randomSignal(r, r.int(500, 5000));
			const whole = limit(pcm, 0, pcm.length).pcm;
			const stitched = new Float32Array(pcm.length);
			for (let at = 0; at < pcm.length;) {
				const to = Math.min(pcm.length, at + r.int(1, 1500));
				stitched.set(limit(pcm, at, to).pcm, at);
				at = to;
			}
			expect(Array.from(stitched)).toEqual(Array.from(whole));
		});
	});

	it('depends only on audio within the declared look-ahead', () => {
		forSeeds(40, (r) => {
			const pcm = randomSignal(r, 20000);
			const a = r.int(2000, 9000);
			const b = a + r.int(1, 1500);
			const copy = pcm.slice();
			// Rubbish further away than the look-ahead (after) or the matching reach before.
			for (let i = b + LIMITER_LOOKAHEAD + BLOCK; i < copy.length; i++) copy[i] = 9;
			for (let i = 0; i < a - LIMITER_LOOKBACK - BLOCK; i++) copy[i] = -9;
			expect(Array.from(limit(copy, a, b).pcm)).toEqual(Array.from(limit(pcm, a, b).pcm));
		});
	});

	it('never turns a sample the wrong way round or louder', () => {
		forSeeds(60, (r) => {
			const pcm = randomSignal(r, 4000);
			const { pcm: out } = limit(pcm, 0, pcm.length);
			for (let i = 0; i < pcm.length; i++) {
				expect(Math.abs(out[i])).toBeLessThanOrEqual(Math.abs(pcm[i]) + 1e-6);
				if (pcm[i] !== 0) expect(Math.sign(out[i])).toBe(Math.sign(pcm[i]));
			}
		});
	});

	it('handles silence, empty and tiny inputs', () => {
		expect(limit(new Float32Array(0), 0, 0).pcm).toHaveLength(0);
		expect(limit(new Float32Array(10), 0, 10).minGain).toBe(1);
		expect(limit(new Float32Array([5]), 0, 1).pcm[0]).toBeLessThanOrEqual(DEFAULT_CEILING);
		expect(limit(new Float32Array(100), 50, 20).pcm).toHaveLength(0);
	});
});

// ---- registry / streams ---------------------------------------------------------------------

const report = (over: Partial<RenderOutcome['report']> = {}): RenderOutcome['report'] => ({
	total: 0,
	rendered: 0,
	cached: 0,
	skipped_rests: 0,
	missing_alias: [],
	missing_features: [],
	errors: [],
	...over
});

const plain = (id: string, level: number, stream?: RendererBackend['stream']): RendererBackend => ({
	id,
	name: id,
	description: '',
	supports: () => true,
	load: async () => {},
	render: (notes: RenderNote[], _t: number, hooks?: RenderHooks) => {
		hooks?.onSynthesize?.(notes.length, notes.length);
		return {
			cancel: () => {},
			promise: Promise.resolve({
				pcm: new Float32Array(44100).fill(level),
				report: report({ rendered: notes.length })
			})
		};
	},
	stream
});

const group = (backend: RendererBackend, n = 1): RenderGroup => ({
	backend,
	notes: Array.from({ length: n }, () => ({}) as RenderNote),
	ids: Array.from({ length: n }, (_, i) => `${backend.id}${i}`)
});

describe('startRender', () => {
	it('a lone streaming backend is used as a stream', async () => {
		const stream = {
			buffer: new Float32Array(10),
			durationMs: 1,
			focus: vi.fn(),
			readyUntil: (ms: number) => ms,
			ready: () => [],
			complete: false,
			progress: { done: 0, total: 1 },
			waiting: null,
			onChange: null,
			promise: Promise.resolve({ pcm: new Float32Array(10), report: report({ rendered: 1 }) }),
			cancel: vi.fn()
		} as RenderStream;
		const backend = plain('s', 1, () => stream);
		const run = startRender([group(backend)], 120);
		expect(run.stream).toBe(stream);
		run.cancel();
		expect(stream.cancel).toHaveBeenCalled();
		const out = await run.result;
		expect(out!.rendered).toBe(1);
	});

	it('anything else is rendered whole, and the stream is ready only when it is done', async () => {
		const run = startRender([group(plain('a', 0.25)), group(plain('b', 0.5))], 120);
		expect(run.stream.complete).toBe(false);
		expect(run.stream.ready()).toEqual([]);
		expect(run.stream.readyUntil(500)).toBe(500);
		expect(run.stream.durationMs).toBe(0);
		const changes = vi.fn();
		run.stream.onChange = changes;
		const out = await run.result;
		await run.stream.promise;
		expect(run.stream.complete).toBe(true);
		expect(out!.pcm[0]).toBeCloseTo(0.75);
		expect(run.stream.ready()).toEqual([{ start: 0, end: 1000 }]);
		expect(run.stream.readyUntil(500)).toBe(1000);
		expect(run.stream.readyUntil(5000)).toBe(5000);
		expect(run.stream.buffer).toHaveLength(44100);
		expect(changes).toHaveBeenCalled();
	});

	it('a single backend that cannot stream also takes the batch path', async () => {
		const run = startRender([group(plain('a', 0.5))], 120);
		const out = await run.result;
		expect(out!.pcm[0]).toBeCloseTo(0.5);
		expect(run.stream.complete).toBe(true);
	});

	it('cancelling a batch render resolves everything with null', async () => {
		const slow: RendererBackend = {
			...plain('slow', 1),
			render: () => ({ cancel: () => {}, promise: Promise.resolve(null) })
		};
		const run = startRender([group(slow), group(plain('b', 1))], 120);
		expect(await run.result).toBeNull();
		expect(await run.stream.promise).toBeNull();
		expect(run.stream.complete).toBe(false);
	});
});

describe('mixOutcomes', () => {
	it('sums overlapping audio and keeps ids of every backend apart', () => {
		const a = plain('a', 0);
		const b = plain('b', 0);
		const out = mixOutcomes(
			[group(a, 2), group(b, 2)],
			[
				{
					pcm: Float32Array.of(0.1, 0.2),
					report: report({
						missing_alias: [1],
						spans: [{ index: 1, start: 1, end: 2, fade_in: 3, fade_out: 4 }]
					})
				},
				{
					pcm: Float32Array.of(0.3, 0.3, 0.3),
					report: report({ missing_features: [0], cached: 2 })
				}
			]
		);
		expect(Array.from(out.pcm).map((v) => +v.toFixed(2))).toEqual([0.4, 0.5, 0.3]);
		expect(out.missingAlias).toEqual(['a1']);
		expect(out.missingFeatures).toEqual(['b0']);
		expect(out.cached).toBe(2);
		expect(out.spans).toEqual([{ id: 'a1', start: 1, end: 2, fadeIn: 3, fadeOut: 4 }]);
	});

	it('copes with nothing at all', () => {
		const out = mixOutcomes([], []);
		expect(out.pcm).toHaveLength(0);
		expect(out.rendered).toBe(0);
	});
});

describe('RendererRegistry.plan', () => {
	it('keeps the order of notes within a group and handles no notes', () => {
		const registry = new RendererRegistry().register(plain(DEFAULT_RENDERER, 0));
		const t = createTrack(0, {});
		const notes = [3, 1, 2].map((tick) => createNote({ track: t.id, tick, pitch: 60 }));
		expect(registry.plan(notes, [t])[0].notes.map((n) => n.tick)).toEqual([3, 1, 2]);
		expect(registry.plan([], [t])).toEqual([]);
	});

	it('a note whose track is gone still gets the default renderer', () => {
		const registry = new RendererRegistry().register(plain(DEFAULT_RENDERER, 0));
		const orphan = createNote({ track: 'deleted', tick: 0, pitch: 60 });
		expect(registry.plan([orphan], [])[0].backend.id).toBe(DEFAULT_RENDERER);
	});

	it('registering an id twice replaces the backend', () => {
		const first = plain('x', 1);
		const second = plain('x', 2);
		const registry = new RendererRegistry().register(first).register(second);
		expect(registry.get('x')).toBe(second);
		expect(registry.all()).toHaveLength(1);
	});
});
