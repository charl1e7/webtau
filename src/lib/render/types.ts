import type { EngineNote, RenderReport } from '#lib/engine/bridge';
import type { Voicebank } from '#lib/voicebank/types';

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
	dispose?(): void;
}
