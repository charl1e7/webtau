import WSynthFactory, { type WSynthModule } from './wasm/w-synth.js';
import wasmUrl from './wasm/w-synth.wasm?url';

export type AnalysisMode = 0 | 1; // 0 = accurate (Harvest), 1 = fast (DIO)

export interface EngineNote {
	alias: string;
	pitch: number;
	start_time: number;
	duration: number;
	pitchbend: { offset: number; value: number }[];
	flags: string;
	velocity: number;
	volume: number;
	modulation: number;
}

export interface RenderReport {
	total: number;
	rendered: number;
	cached: number;
	skipped_rests: number;
	missing_alias: number[];
	missing_features: number[];
	errors: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Typed, memory-safe wrapper over the raw C exports of the engine.
 * Must only be used inside a worker: calls block until they finish.
 */
export class WasmBridge {
	private readonly fn: Record<string, (...args: number[]) => number>;

	private constructor(private readonly m: WSynthModule) {
		const f = (name: string, ret: 'number' | 'boolean' | null, args: number) =>
			m.cwrap(name, ret, Array<'number'>(args).fill('number'));
		this.fn = {
			init: f('wsynth_init', null, 0),
			version: f('wsynth_analysis_version', 'number', 0),
			create: f('wsynth_engine_create', 'number', 0),
			destroy: f('wsynth_engine_destroy', null, 1),
			reset: f('wsynth_engine_reset', null, 1),
			loadOto: f('wsynth_engine_load_oto', 'boolean', 3),
			loadPrefix: f('wsynth_engine_load_prefix_map', 'boolean', 3),
			otoJson: f('wsynth_engine_oto_json', 'number', 1),
			required: f('wsynth_engine_required_files', 'number', 3),
			hasFeatures: f('wsynth_engine_has_features', 'boolean', 3),
			cacheFeatures: f('wsynth_engine_cache_features', 'boolean', 5),
			analyze: f('wsynth_analyze_wav', 'number', 3),
			begin: f('wsynth_session_begin', 'number', 3),
			step: f('wsynth_session_step', 'number', 2),
			finish: f('wsynth_session_finish', 'number', 1),
			report: f('wsynth_engine_report', 'number', 1),
			free: f('wsynth_free_buffer', null, 1)
		};
		this.fn.init();
	}

	static async create(module?: WebAssembly.Module): Promise<WasmBridge> {
		const instantiateWasm = (
			imports: WebAssembly.Imports,
			receive: (i: WebAssembly.Instance, m: WebAssembly.Module) => void
		) => {
			(async () => {
				const mod = module ?? (await WebAssembly.compileStreaming(fetch(wasmUrl)));
				receive(await WebAssembly.instantiate(mod, imports), mod);
			})().catch((e) => console.error('[engine] failed to instantiate wasm', e));
			return {};
		};
		const m = await WSynthFactory({ instantiateWasm, print: () => {}, printErr: console.warn });
		return new WasmBridge(m);
	}

	get analysisVersion(): number {
		return this.fn.version();
	}

	// ---- memory helpers -------------------------------------------------

	private withBytes<T>(data: Uint8Array, fn: (ptr: number, len: number) => T): T {
		const ptr = this.m._malloc(Math.max(1, data.length));
		if (!ptr) throw new Error('Out of memory in the audio engine.');
		try {
			this.m.HEAPU8.set(data, ptr);
			return fn(ptr, data.length);
		} finally {
			this.m._free(ptr);
		}
	}

	private withText<T>(text: string, fn: (ptr: number, len: number) => T): T {
		return this.withBytes(encoder.encode(text), fn);
	}

	/** Copies a returned WasmBuffer out of the heap and frees it. */
	private take(bufferPtr: number): Uint8Array | null {
		if (!bufferPtr) return null;
		try {
			const ptr = this.m.getValue(bufferPtr, 'i32') >>> 0;
			const len = this.m.getValue(bufferPtr + 4, 'i32') >>> 0;
			return this.m.HEAPU8.slice(ptr, ptr + len);
		} finally {
			this.fn.free(bufferPtr);
		}
	}

	private takeJson<T>(bufferPtr: number): T | null {
		const bytes = this.take(bufferPtr);
		return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : null;
	}

	// ---- stateless analysis ----------------------------------------------

	/** Returns serialized features of a WAV file, or null if it cannot be analyzed. */
	analyze(wav: Uint8Array, mode: AnalysisMode): Uint8Array | null {
		return this.take(this.withBytes(wav, (p, l) => this.fn.analyze(p, l, mode)));
	}

	createEngine(): EngineHandle {
		const ptr = this.fn.create();
		if (!ptr) throw new Error('Failed to create the synthesis engine.');
		return new EngineHandle(this, ptr);
	}

	/** @internal */
	call = {
		reset: (e: number) => this.fn.reset(e),
		destroy: (e: number) => this.fn.destroy(e),
		loadOto: (e: number, d: Uint8Array) => !!this.withBytes(d, (p, l) => this.fn.loadOto(e, p, l)),
		loadPrefix: (e: number, d: Uint8Array) =>
			!!this.withBytes(d, (p, l) => this.fn.loadPrefix(e, p, l)),
		otoEntries: (e: number) =>
			this.takeJson<{ entries: [string, string][] }>(this.fn.otoJson(e))?.entries ?? [],
		required: (e: number, notesJson: string) =>
			this.takeJson<{ files: string[]; missing: number[] }>(
				this.withText(notesJson, (p, l) => this.fn.required(e, p, l))
			),
		hasFeatures: (e: number, name: string) =>
			!!this.withText(name, (p, l) => this.fn.hasFeatures(e, p, l)),
		cacheFeatures: (e: number, name: string, data: Uint8Array) =>
			!!this.withText(name, (np, nl) =>
				this.withBytes(data, (dp, dl) => this.fn.cacheFeatures(e, np, nl, dp, dl))
			),
		begin: (e: number, json: string) => this.withText(json, (p, l) => this.fn.begin(e, p, l)),
		step: (e: number, n: number) => this.fn.step(e, n),
		finish: (e: number): Float32Array | null => {
			const bytes = this.take(this.fn.finish(e));
			return bytes ? new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2) : null;
		},
		report: (e: number) => this.takeJson<RenderReport>(this.fn.report(e))
	};
}

export class EngineHandle {
	constructor(
		private readonly bridge: WasmBridge,
		private ptr: number
	) {}

	reset() {
		this.bridge.call.reset(this.ptr);
	}
	destroy() {
		if (this.ptr) this.bridge.call.destroy(this.ptr);
		this.ptr = 0;
	}
	loadOto(data: Uint8Array) {
		return this.bridge.call.loadOto(this.ptr, data);
	}
	loadPrefixMap(data: Uint8Array) {
		return this.bridge.call.loadPrefix(this.ptr, data);
	}
	otoEntries() {
		return this.bridge.call.otoEntries(this.ptr);
	}
	requiredFiles(notes: EngineNote[]) {
		return this.bridge.call.required(this.ptr, JSON.stringify(notes));
	}
	hasFeatures(name: string) {
		return this.bridge.call.hasFeatures(this.ptr, name);
	}
	cacheFeatures(name: string, data: Uint8Array) {
		return this.bridge.call.cacheFeatures(this.ptr, name, data);
	}
	beginSession(notes: EngineNote[], tempo: number): number {
		return this.bridge.call.begin(this.ptr, JSON.stringify({ notes, tempo }));
	}
	step(count: number): number {
		return this.bridge.call.step(this.ptr, count);
	}
	finish() {
		return this.bridge.call.finish(this.ptr);
	}
	report() {
		return this.bridge.call.report(this.ptr);
	}
}
