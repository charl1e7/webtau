import { describe, expect, it, vi } from 'vitest';
import { createNote, createTrack } from '#lib/core/music';
import { DEFAULT_RENDERER, RendererRegistry, renderMixed, type RenderGroup } from './registry';
import type { RenderHooks, RenderNote, RenderOutcome, RendererBackend } from './types';
import type { Voicebank } from '#lib/voicebank/types';

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

/** A backend that "renders" every note as a constant level and reports what it was told to. */
function fake(
	id: string,
	level: number,
	extra: Partial<RenderOutcome['report']> = {},
	opts: { cancelled?: boolean } = {}
): RendererBackend & { cancel: ReturnType<typeof vi.fn>; seen: RenderNote[][] } {
	const cancel = vi.fn();
	const seen: RenderNote[][] = [];
	return {
		id,
		name: id,
		description: '',
		cancel,
		seen,
		supports: (vb: Voicebank) => vb.kind === 'utau',
		load: async () => {},
		render(notes: RenderNote[], _tempo: number, hooks?: RenderHooks) {
			seen.push(notes);
			hooks?.onSynthesize?.(0, notes.length);
			hooks?.onSynthesize?.(notes.length, notes.length);
			return {
				cancel,
				promise: Promise.resolve(
					opts.cancelled
						? null
						: {
								pcm: new Float32Array(notes.length * 2).fill(level),
								report: report({ rendered: notes.length, ...extra })
							}
				)
			};
		}
	};
}

const note = (track: string, lyric = 'a') => createNote({ tick: 0, pitch: 60, track, lyric });

describe('RendererRegistry', () => {
	it('follows each track to its backend and falls back to the default for unknown ids', () => {
		const world = fake(DEFAULT_RENDERER, 1);
		const other = fake('other', 2);
		const registry = new RendererRegistry().register(world).register(other);
		const a = createTrack(0, { renderer: DEFAULT_RENDERER });
		const b = createTrack(1, { renderer: 'other' });
		const c = createTrack(2, { renderer: 'from-the-future' });
		const notes = [note(a.id), note(b.id), note(c.id), note(b.id)];
		const plan = registry.plan(notes, [a, b, c]);
		expect(plan.map((g) => [g.backend.id, g.notes.length])).toEqual([
			[DEFAULT_RENDERER, 2],
			['other', 2]
		]);
	});

	it('fails clearly without any renderer', () => {
		expect(() => new RendererRegistry().forTrack(undefined)).toThrow(/No renderer/);
	});
});

describe('renderMixed', () => {
	const group = (backend: RendererBackend, count: number): RenderGroup => ({
		backend,
		notes: Array.from({ length: count }, () => ({}) as RenderNote),
		ids: Array.from({ length: count }, (_, i) => `${backend.id}-${i}`)
	});

	it('returns a single backend as it is', async () => {
		const a = fake('a', 0.5);
		const out = await renderMixed([group(a, 2)], 120).promise;
		expect(out!.pcm).toHaveLength(4);
		expect(out!.rendered).toBe(2);
	});

	it('mixes backends, maps their reports back to note ids and sums progress', async () => {
		const a = fake('a', 0.25, { missing_alias: [1], missing_features: [0] });
		const b = fake('b', 0.5, { missing_alias: [0], errors: ['boom'] });
		const progress: [number, number][] = [];
		const out = await renderMixed([group(a, 3), group(b, 1)], 120, {
			onSynthesize: (d, t) => progress.push([d, t])
		}).promise;
		expect(out!.pcm).toHaveLength(6); // the longer one
		expect(out!.pcm[0]).toBeCloseTo(0.75); // both contribute
		expect(out!.pcm[5]).toBeCloseTo(0.25); // only the longer one reaches here
		expect(out!.rendered).toBe(4);
		expect(out!.missingAlias).toEqual(['a-1', 'b-0']);
		expect(out!.missingFeatures).toEqual(['a-0']);
		expect(out!.errors).toEqual(['boom']);
		expect(progress.at(-1)).toEqual([4, 4]);
	});

	it('cancels every backend and resolves null when one is cancelled', async () => {
		const a = fake('a', 1);
		const b = fake('b', 1, {}, { cancelled: true });
		const job = renderMixed([group(a, 1), group(b, 1)], 120);
		job.cancel();
		expect(a.cancel).toHaveBeenCalled();
		expect(b.cancel).toHaveBeenCalled();
		expect(await job.promise).toBeNull();
	});
});
