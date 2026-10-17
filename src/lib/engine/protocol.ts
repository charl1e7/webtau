import type { AnalysisMode, EngineNote, PlanEntry, RenderReport } from './bridge';

/** Requests understood by `synth.worker.ts`; every one is answered by id. */
export type SynthRequest =
	| { type: 'init'; module?: WebAssembly.Module }
	| { type: 'reset' }
	| { type: 'load_voicebank'; oto: Uint8Array; prefixMap: Uint8Array | null }
	| { type: 'required_files'; notes: EngineNote[] }
	| { type: 'cache_features'; name: string; data: Uint8Array }
	| { type: 'render'; notes: EngineNote[]; tempo: number }
	| { type: 'stream_begin'; notes: EngineNote[]; tempo: number }
	| { type: 'stream_render'; indices: number[] }
	| { type: 'stream_read'; start: number; len: number }
	| { type: 'stream_end'; complete: boolean };

export type SynthResponseMap = {
	init: { analysisVersion: number };
	reset: void;
	load_voicebank: { entries: [string, string][] };
	required_files: { files: string[]; missing: number[] };
	cache_features: boolean;
	render: { pcm: Float32Array; report: RenderReport } | { cancelled: true };
	stream_begin: { plan: PlanEntry[] };
	stream_render: { remaining: number };
	stream_read: { pcm: Float32Array };
	stream_end: { report: RenderReport | null };
};

export type WorkerEnvelope = { id: number } & SynthRequest;
export type WorkerCancel = { type: 'cancel'; id: number };

export type SynthReply =
	| { id: number; ok: true; result: unknown }
	| { id: number; ok: false; error: string; fatal?: boolean }
	| { id: number; progress: { done: number; total: number } };

/** Requests understood by `analyzer.worker.ts`. */
export type AnalyzerRequest =
	| { type: 'init'; module?: WebAssembly.Module }
	| { type: 'analyze'; id: number; wav: Uint8Array; mode: AnalysisMode };

export type AnalyzerReply =
	{ type: 'ready' } | { type: 'result'; id: number; features: Uint8Array | null; error?: string };
