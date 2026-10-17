/// <reference lib="webworker" />
import { WasmBridge, type EngineHandle } from './bridge';
import type { SynthReply, WorkerCancel, WorkerEnvelope } from './protocol';

let bridge: WasmBridge | null = null;
let engine: EngineHandle | null = null;
const cancelled = new Set<number>();
/** A progressive render owns the engine's session; one-off renders must not disturb it. */
let streaming = false;

const reply = (msg: SynthReply, transfer: Transferable[] = []) => self.postMessage(msg, transfer);
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

function requireEngine(): EngineHandle {
	if (!engine) throw new Error('The audio engine is not initialized.');
	return engine;
}

async function handle(msg: WorkerEnvelope) {
	switch (msg.type) {
		case 'init': {
			bridge ??= await WasmBridge.create(msg.module);
			engine ??= bridge.createEngine();
			return { analysisVersion: bridge.analysisVersion };
		}
		case 'reset':
			requireEngine().reset();
			return;
		case 'load_voicebank': {
			const e = requireEngine();
			e.reset();
			if (!e.loadOto(msg.oto)) throw new Error('oto.ini contains no usable entries.');
			if (msg.prefixMap) e.loadPrefixMap(msg.prefixMap);
			return { entries: e.otoEntries() };
		}
		case 'required_files':
			return requireEngine().requiredFiles(msg.notes);
		case 'cache_features':
			return requireEngine().cacheFeatures(msg.name, msg.data);
		case 'render': {
			const e = requireEngine();
			if (streaming) {
				const side = e.renderOneshot(msg.notes, msg.tempo);
				if (!side) throw new Error('Synthesis failed.');
				return side;
			}
			const total = e.beginSession(msg.notes, msg.tempo);
			if (total < 0) throw new Error('Nothing to synthesize.');
			let remaining = total;
			let lastYield = performance.now();
			let lastProgress = 0;
			while (remaining > 0) {
				if (cancelled.has(msg.id)) return { cancelled: true };
				remaining = e.step(1);
				if (remaining < 0) throw new Error('Synthesis failed.');
				const now = performance.now();
				if (now - lastYield > 30) {
					if (now - lastProgress > 100) {
						reply({ id: msg.id, progress: { done: total - remaining, total } });
						lastProgress = now;
					}
					await yieldToEventLoop();
					lastYield = performance.now();
				}
			}
			const pcm = e.finish();
			if (!pcm) throw new Error('Synthesis produced no audio.');
			return { pcm, report: e.report() };
		}
		case 'stream_begin': {
			const e = requireEngine();
			if (e.beginSession(msg.notes, msg.tempo) < 0) throw new Error('Nothing to synthesize.');
			streaming = true;
			return { plan: e.plan() };
		}
		case 'stream_render': {
			const remaining = requireEngine().renderPlanned(msg.indices);
			if (remaining < 0) throw new Error('Synthesis failed.');
			return { remaining };
		}
		case 'stream_read': {
			const pcm = requireEngine().read(msg.start, msg.len);
			if (!pcm) throw new Error('Reading the rendered audio failed.');
			return { pcm };
		}
		case 'stream_end': {
			const e = requireEngine();
			streaming = false;
			e.endStream(msg.complete);
			return { report: e.report() };
		}
	}
}

// Requests are processed one at a time, but `cancel` must be seen while a
// render yields, so it is handled synchronously outside the queue.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerEnvelope | WorkerCancel>) => {
	const msg = event.data;
	if (msg.type === 'cancel') {
		cancelled.add(msg.id);
		return;
	}
	queue = queue.then(async () => {
		try {
			const result = await handle(msg);
			const transfer =
				typeof result === 'object' && result !== null && 'pcm' in result
					? [(result as { pcm: Float32Array }).pcm.buffer]
					: [];
			reply({ id: msg.id, ok: true, result }, transfer);
		} catch (error) {
			// A trap inside wasm (e.g. a Rust panic) leaves the instance unusable.
			const fatal = error instanceof WebAssembly.RuntimeError;
			reply({
				id: msg.id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				fatal
			});
		} finally {
			cancelled.delete(msg.id);
		}
	});
};
