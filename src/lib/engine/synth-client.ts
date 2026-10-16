import type { EngineNote, RenderReport } from './bridge';
import type {
	SynthReply,
	SynthRequest,
	SynthResponseMap,
	WorkerCancel,
	WorkerEnvelope
} from './protocol';

interface Pending {
	resolve: (value: never) => void;
	reject: (reason: Error) => void;
	onProgress?: (done: number, total: number) => void;
}

export class WorkerCrashedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WorkerCrashedError';
	}
}

export interface RenderResult {
	pcm: Float32Array;
	report: RenderReport;
}

/** Promise-based client of the synthesis worker. */
export class SynthClient {
	private worker: Worker;
	private nextId = 1;
	private pending = new Map<number, Pending>();

	/** Called when the worker died and had to be replaced; its state is gone. */
	onCrash: (() => void) | null = null;

	constructor(private readonly module: WebAssembly.Module | null) {
		this.worker = this.spawn();
	}

	private spawn(): Worker {
		const worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<SynthReply>) => this.onReply(e.data);
		worker.onerror = (e) => {
			e.preventDefault();
			this.crash(e.message || 'The audio engine stopped unexpectedly.');
		};
		worker.onmessageerror = () => this.crash('The audio engine sent an unreadable message.');
		return worker;
	}

	private crash(reason: string) {
		this.worker.terminate();
		const error = new WorkerCrashedError(reason);
		for (const p of this.pending.values()) p.reject(error);
		this.pending.clear();
		this.worker = this.spawn();
		this.onCrash?.();
	}

	private onReply(reply: SynthReply) {
		const pending = this.pending.get(reply.id);
		if (!pending) return;
		if ('progress' in reply) {
			pending.onProgress?.(reply.progress.done, reply.progress.total);
			return;
		}
		this.pending.delete(reply.id);
		if (reply.ok) pending.resolve(reply.result as never);
		else {
			pending.reject(new Error(reply.error));
			if (reply.fatal) this.crash(reply.error);
		}
	}

	private request<K extends SynthRequest['type']>(
		request: Extract<SynthRequest, { type: K }>,
		options: { transfer?: Transferable[]; onProgress?: Pending['onProgress']; id?: number } = {}
	): Promise<SynthResponseMap[K]> {
		const id = options.id ?? this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
			this.worker.postMessage({ id, ...request } as WorkerEnvelope, options.transfer ?? []);
		});
	}

	/** Initializes the engine. Must be repeated after a crash. */
	init() {
		return this.request({ type: 'init', module: this.module ?? undefined });
	}

	loadVoicebank(oto: Uint8Array, prefixMap: Uint8Array | null) {
		// Copies: the voicebank keeps its own bytes for crash recovery.
		return this.request({
			type: 'load_voicebank',
			oto: oto.slice(),
			prefixMap: prefixMap?.slice() ?? null
		});
	}

	requiredFiles(notes: EngineNote[]) {
		return this.request({ type: 'required_files', notes });
	}

	cacheFeatures(name: string, data: Uint8Array) {
		return this.request({ type: 'cache_features', name, data }, { transfer: [data.buffer] });
	}

	/**
	 * Renders notes. Resolves with `null` if cancelled. The returned `cancel`
	 * function aborts the render at the next note boundary.
	 */
	render(
		notes: EngineNote[],
		tempo: number,
		onProgress?: (done: number, total: number) => void
	): { promise: Promise<RenderResult | null>; cancel: () => void } {
		const id = this.nextId++;
		const promise = this.request({ type: 'render', notes, tempo }, { id, onProgress }).then((r) =>
			'cancelled' in r ? null : r
		);
		const cancel = () => {
			if (this.pending.has(id))
				this.worker.postMessage({ type: 'cancel', id } satisfies WorkerCancel);
		};
		return { promise, cancel };
	}

	terminate() {
		this.worker.terminate();
		const error = new Error('The audio engine was shut down.');
		for (const p of this.pending.values()) p.reject(error);
		this.pending.clear();
	}
}
