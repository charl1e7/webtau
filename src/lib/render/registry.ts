import type { Note, Track } from '#lib/core/types';
import type {
	RenderHooks,
	RenderJob,
	RenderNote,
	RenderOutcome,
	RenderStream,
	RendererBackend
} from './types';
import type { Interval } from './intervals';

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

/** Mixes what the backends returned into one buffer and maps their reports back to note ids. */
export function mixOutcomes(groups: RenderGroup[], done: RenderOutcome[]): MixedOutcome {
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

	const promise = Promise.all(jobs.map((j) => j.promise)).then((outcomes): MixedOutcome | null =>
		outcomes.some((o) => o === null) ? null : mixOutcomes(groups, outcomes as RenderOutcome[])
	);

	return { promise, cancel: () => jobs.forEach((j) => j.cancel()) };
}

/** A render of the whole project that can be listened to while it goes on. */
export interface ProjectRender {
	stream: RenderStream;
	/** The finished mix with its report mapped to note ids; null when cancelled. */
	result: Promise<MixedOutcome | null>;
	cancel(): void;
}

/**
 * Starts rendering the project. A single backend that can stream does so, so
 * playback may begin before the end; otherwise everything is rendered first and
 * the stream only becomes ready when it is done.
 */
export function startRender(
	groups: RenderGroup[],
	tempo: number,
	hooks: RenderHooks = {}
): ProjectRender {
	if (groups.length === 1 && groups[0].backend.stream) {
		const stream = groups[0].backend.stream(groups[0].notes, tempo, hooks);
		return {
			stream,
			result: stream.promise.then((o) => (o ? mixOutcomes(groups, [o]) : null)),
			cancel: () => stream.cancel()
		};
	}
	const progress = { done: 0, total: 0 };
	const job = renderMixed(groups, tempo, {
		...hooks,
		onSynthesize: (done, total) => {
			progress.done = done;
			progress.total = total;
			hooks.onSynthesize?.(done, total);
		}
	});
	const stream = batchStream(progress, job);
	return { stream, result: job.promise, cancel: () => job.cancel() };
}

/** The stream of a render that is only ready as a whole. */
function batchStream(progress: { done: number; total: number }, job: MixedJob): RenderStream {
	let pcm: Float32Array = new Float32Array(0);
	let complete = false;
	const empty: RenderOutcome['report'] = {
		total: 0,
		rendered: 0,
		cached: 0,
		skipped_rests: 0,
		missing_alias: [],
		missing_features: [],
		errors: []
	};
	const stream: RenderStream = {
		get buffer() {
			return pcm;
		},
		get durationMs() {
			return (pcm.length / 44100) * 1000;
		},
		focus: () => {},
		readyUntil: (ms) => (complete ? Math.max(ms, stream.durationMs) : ms),
		ready: (): Interval[] => (complete ? [{ start: 0, end: stream.durationMs }] : []),
		get complete() {
			return complete;
		},
		progress,
		waiting: 'Rendering',
		onChange: null,
		promise: job.promise.then((o) => {
			if (!o) return null;
			pcm = o.pcm;
			complete = true;
			stream.onChange?.();
			return { pcm: o.pcm, report: empty };
		}),
		cancel: () => job.cancel()
	};
	return stream;
}
