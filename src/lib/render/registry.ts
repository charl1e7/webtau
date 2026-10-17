import type { Note, Track } from '#lib/core/types';
import type { RenderHooks, RenderJob, RenderNote, RendererBackend } from './types';

export const DEFAULT_RENDERER = 'world';

/** The renderers the app knows, and which one each track uses. */
export class RendererRegistry {
	private readonly backends = new Map<string, RendererBackend>();

	register(backend: RendererBackend): this {
		this.backends.set(backend.id, backend);
		return this;
	}

	all(): RendererBackend[] {
		return [...this.backends.values()];
	}

	get(id: string): RendererBackend | undefined {
		return this.backends.get(id);
	}

	/** The backend of a track; unknown ids (a project from a newer version) fall back to the default. */
	forTrack(track: Pick<Track, 'renderer'> | undefined): RendererBackend {
		const backend =
			this.backends.get(track?.renderer ?? DEFAULT_RENDERER) ?? this.backends.get(DEFAULT_RENDERER);
		if (!backend) throw new Error('No renderer is registered.');
		return backend;
	}

	/** Splits notes into one group per backend, following each note's track. */
	plan(
		notes: readonly Note[],
		tracks: readonly Track[]
	): { backend: RendererBackend; notes: Note[] }[] {
		const byTrack = new Map(tracks.map((t) => [t.id, t]));
		const groups = new Map<RendererBackend, Note[]>();
		for (const n of notes) {
			const backend = this.forTrack(byTrack.get(n.track));
			const list = groups.get(backend);
			if (list) list.push(n);
			else groups.set(backend, [n]);
		}
		return [...groups].map(([backend, list]) => ({ backend, notes: list }));
	}
}

/** One backend's share of a render: its notes, and the id of each note. */
export interface RenderGroup {
	backend: RendererBackend;
	notes: RenderNote[];
	ids: string[];
}

export interface MixedOutcome {
	pcm: Float32Array;
	rendered: number;
	cached: number;
	/** Ids of notes whose lyric is not in the voicebank. */
	missingAlias: string[];
	/** Ids of notes whose samples could not be analyzed. */
	missingFeatures: string[];
	errors: string[];
	/** The audible stretch of every rendered note, by note id. */
	spans: NoteSpanInfo[];
}

export interface NoteSpanInfo {
	id: string;
	/** Absolute ms. The note fades in over `fadeIn` from `start` and fades out over `fadeOut` up to `end`. */
	start: number;
	end: number;
	fadeIn: number;
	fadeOut: number;
}

export interface MixedJob {
	promise: Promise<MixedOutcome | null>;
	cancel(): void;
}

/**
 * Renders every group on its own backend (in parallel) and mixes the results
 * into one buffer. With a single backend the buffer is returned as it is.
 */
export function renderMixed(
	groups: RenderGroup[],
	tempo: number,
	hooks: RenderHooks = {}
): MixedJob {
	// Progress of the whole is the sum of the progress of its parts.
	const analyze = groups.map(() => [0, 0] as [number, number]);
	const synth = groups.map(() => [0, 0] as [number, number]);
	const report = (parts: [number, number][], fn?: (done: number, total: number) => void) => {
		if (!fn) return;
		fn(
			parts.reduce((s, p) => s + p[0], 0),
			parts.reduce((s, p) => s + p[1], 0)
		);
	};

	const jobs: RenderJob[] = groups.map((g, i) =>
		g.backend.render(g.notes, tempo, {
			onAnalyze: (done, total) => {
				analyze[i] = [done, total];
				report(analyze, hooks.onAnalyze);
			},
			onSynthesize: (done, total) => {
				synth[i] = [done, total];
				report(synth, hooks.onSynthesize);
			}
		})
	);

	const promise = Promise.all(jobs.map((j) => j.promise)).then((outcomes): MixedOutcome | null => {
		if (outcomes.some((o) => o === null)) return null;
		const done = outcomes as NonNullable<(typeof outcomes)[number]>[];
		const length = done.reduce((m, o) => Math.max(m, o.pcm.length), 0);
		let pcm: Float32Array;
		if (done.length === 1) pcm = done[0].pcm;
		else {
			pcm = new Float32Array(length);
			for (const o of done) for (let i = 0; i < o.pcm.length; i++) pcm[i] += o.pcm[i];
		}
		const out: MixedOutcome = {
			pcm,
			rendered: 0,
			cached: 0,
			missingAlias: [],
			missingFeatures: [],
			errors: [],
			spans: []
		};
		done.forEach((o, g) => {
			out.rendered += o.report.rendered;
			out.cached += o.report.cached;
			out.missingAlias.push(...o.report.missing_alias.map((i) => groups[g].ids[i]));
			out.missingFeatures.push(...o.report.missing_features.map((i) => groups[g].ids[i]));
			out.errors.push(...o.report.errors);
			for (const sp of o.report.spans ?? []) {
				out.spans.push({
					id: groups[g].ids[sp.index],
					start: sp.start,
					end: sp.end,
					fadeIn: sp.fade_in,
					fadeOut: sp.fade_out
				});
			}
		});
		return out;
	});

	return { promise, cancel: () => jobs.forEach((j) => j.cancel()) };
}
