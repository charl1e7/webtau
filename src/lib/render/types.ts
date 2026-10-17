import type { EngineNote, RenderReport } from '#lib/engine/bridge';
import type { Voicebank } from '#lib/voicebank/types';
import type { Interval } from './intervals';

/**
 * A synthesis backend: something that turns notes into audio with a voicebank.
 * The editor, playback and export only ever talk to this interface, so a
 * backend of another kind (a neural voice, say) is added by implementing it
 * and registering it, without touching the editor or the existing backends.
 */

/** What every backend is given: absolute times in ms and a flat pitch contour in cents. */
export type RenderNote = EngineNote;

export interface RenderHooks {
	onAnalyze?: (done: number, total: number) => void;
	onSynthesize?: (done: number, total: number) => void;
}

export interface RenderOutcome {
	/** Mono audio at 44.1 kHz, starting at time zero. */
	pcm: Float32Array;
	report: RenderReport;
}

export interface RenderJob {
	/** Resolves with null when cancelled. */
	promise: Promise<RenderOutcome | null>;
	cancel(): void;
}

/**
 * A render that can be listened to while it is still going on. The whole mix
 * lives in `buffer` from the start (silence where nothing is ready); stretches
 * become final one after the other, in whatever order `focus` asks for.
 */
export interface RenderStream {
	/** Mono audio at 44.1 kHz for the whole project, filled in progressively. */
	readonly buffer: Float32Array;
	readonly durationMs: number;
	/** Render what is around `ms` first (the playhead moved). */
	focus(ms: number): void;
	/** Up to which time the audio is final when starting at `ms`; `ms` itself when it is not ready yet. */
	readyUntil(ms: number): number;
	/** The final stretches so far. */
	ready(): Interval[];
	readonly complete: boolean;
	/** Notes rendered so far / to render. */
	readonly progress: { done: number; total: number };
	/** What the render is waiting for right now ("Analyzing 3 samples"), if anything. */
	readonly waiting: string | null;
	/** Called whenever more audio became ready. */
	onChange: (() => void) | null;
	/** Resolves with the finished mix, or null when cancelled. */
	readonly promise: Promise<RenderOutcome | null>;
	cancel(): void;
}

export interface RendererBackend {
	/** Stable id stored in projects ("world"). */
	readonly id: string;
	readonly name: string;
	readonly description: string;

	/** Whether this backend can sing with the voicebank. */
	supports(voicebank: Voicebank): boolean;
	/** Prepares for a voicebank (parse it, index it). Called when one is loaded. */
	load(voicebank: Voicebank): Promise<void>;
	render(notes: RenderNote[], tempo: number, hooks?: RenderHooks): RenderJob;
	/** Optional: render progressively so that playback can start early. Without it the app renders in one go. */
	stream?(notes: RenderNote[], tempo: number, hooks?: RenderHooks): RenderStream;
	dispose?(): void;
}
