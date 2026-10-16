import type { AnalysisMode } from './bridge';
import type { AnalyzerReply, AnalyzerRequest } from './protocol';
import type { FeatureCache } from './feature-cache';
import type { SynthClient } from './synth-client';
import type { SampleFile, Voicebank } from '#lib/voicebank/types';

export type Priority = 'now' | 'background';

export interface AnalysisStats {
	/** Samples referenced by the oto.ini (or all samples). */
	total: number;
	/** Samples whose features are loaded in the engine. */
	ready: number;
	/** Of those, how many came from the persistent cache. */
	fromCache: number;
	/** Samples that could not be analyzed. */
	failed: number;
	/** Samples currently being analyzed. */
	running: number;
}

interface Task {
	sample: SampleFile;
	priority: Priority;
	promise: Promise<void>;
	resolve: () => void;
	started: boolean;
}

interface PoolWorker {
	worker: Worker;
	busy: Task | null;
	ready: Promise<void>;
	taskId: number;
}

/**
 * Makes sure the features of samples are present in the synthesis engine,
 * loading them from the persistent cache or analyzing them on a pool of
 * workers. Analysis is lazy: only what a render needs is processed first;
 * the rest of the voicebank can be warmed up in the background.
 */
export class AnalysisScheduler {
	private voicebank: Voicebank | null = null;
	private generation = 0;
	private tasks = new Map<string, Task>();
	private done = new Set<string>();
	private failed = new Set<string>();
	private fromCache = 0;
	private pool: PoolWorker[] = [];
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private bgRun = 0;

	maxWorkers = 2;
	mode: AnalysisMode = 0;
	onStats: ((stats: AnalysisStats) => void) | null = null;

	constructor(
		private readonly synth: SynthClient,
		private readonly cache: FeatureCache | null,
		private readonly module: WebAssembly.Module | null,
		private readonly analysisVersion: number
	) {}

	get stats(): AnalysisStats {
		const total = this.voicebank?.samples.size ?? 0;
		return {
			total,
			ready: this.done.size,
			fromCache: this.fromCache,
			failed: this.failed.size,
			running: this.pool.filter((w) => w.busy).length
		};
	}

	private emit() {
		this.onStats?.(this.stats);
	}

	setVoicebank(voicebank: Voicebank | null) {
		this.generation++;
		this.bgRun++;
		this.voicebank = voicebank;
		this.resetState();
		if (voicebank) void this.cache?.touchBank(voicebank.id, voicebank.name);
		this.emit();
	}

	/** The engine lost its state (crash): everything has to be loaded again. */
	invalidate() {
		this.generation++;
		this.resetState();
		this.emit();
	}

	setMode(mode: AnalysisMode) {
		if (mode === this.mode) return;
		this.mode = mode;
		this.invalidate();
	}

	private resetState() {
		for (const task of this.tasks.values()) task.resolve();
		this.tasks.clear();
		this.done.clear();
		this.failed.clear();
		this.fromCache = 0;
		for (const w of this.pool) w.worker.terminate();
		this.pool = [];
	}

	private cacheKey(sample: SampleFile): string {
		return `${this.voicebank!.id}|${sample.key}|${this.mode}|${sample.size}|v${this.analysisVersion}`;
	}

	/** Resolves when the features of all `files` are loaded into the engine. */
	async ensure(
		files: string[],
		priority: Priority = 'now',
		onProgress?: (done: number, total: number) => void
	): Promise<void> {
		let finished = 0;
		const total = files.length;
		onProgress?.(0, total);
		await Promise.all(
			files.map((file) =>
				this.ensureOne(file, priority).then(() => onProgress?.(++finished, total))
			)
		);
	}

	private ensureOne(file: string, priority: Priority): Promise<void> {
		const vb = this.voicebank;
		if (!vb) return Promise.resolve();
		const key = file.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
		const sample = vb.samples.get(key);
		if (!sample || this.done.has(key) || this.failed.has(key)) return Promise.resolve();

		const existing = this.tasks.get(key);
		if (existing) {
			if (priority === 'now') existing.priority = 'now';
			this.pump();
			return existing.promise;
		}

		let resolve!: () => void;
		const promise = new Promise<void>((r) => (resolve = r));
		const task: Task = { sample, priority, promise, resolve, started: false };
		this.tasks.set(key, task);
		void this.run(task, this.generation);
		return promise;
	}

	private async run(task: Task, generation: number) {
		const { sample } = task;
		const finish = (ok: boolean, cached = false) => {
			if (generation !== this.generation) return;
			this.tasks.delete(sample.key);
			if (ok) {
				this.done.add(sample.key);
				if (cached) this.fromCache++;
			} else this.failed.add(sample.key);
			task.resolve();
			this.emit();
			this.pump();
		};

		try {
			const cached = this.cache ? await this.cache.get(this.cacheKey(sample)) : null;
			if (generation !== this.generation) return;
			if (cached) {
				await this.synth.cacheFeatures(sample.key, cached);
				finish(true, true);
				return;
			}
		} catch {
			/* fall through to a real analysis */
		}
		if (generation !== this.generation) return;
		this.queue.push(task);
		this.pump();
		await task.promise;
	}

	// ---- worker pool ------------------------------------------------------

	private queue: Task[] = [];

	private bgWorkerLimit(): number {
		return Math.max(1, Math.floor(this.maxWorkers / 2));
	}

	private pump() {
		clearTimeout(this.idleTimer);
		const generation = this.generation;
		// Foreground work first.
		this.queue.sort((a, b) => Number(b.priority === 'now') - Number(a.priority === 'now'));
		for (;;) {
			const task = this.queue[0];
			if (!task) break;
			const busyBg = this.pool.filter((w) => w.busy?.priority === 'background').length;
			if (task.priority === 'background' && busyBg >= this.bgWorkerLimit()) break;
			let worker = this.pool.find((w) => !w.busy);
			if (!worker && this.pool.length < this.maxWorkers) worker = this.spawnWorker();
			if (!worker) break;
			this.queue.shift();
			void this.dispatch(worker, task, generation);
		}
		if (!this.queue.length && !this.pool.some((w) => w.busy)) {
			// Free the memory held by idle wasm instances after a while.
			this.idleTimer = setTimeout(() => {
				if (!this.pool.some((w) => w.busy)) {
					for (const w of this.pool) w.worker.terminate();
					this.pool = [];
				}
			}, 20_000);
		}
	}

	private spawnWorker(): PoolWorker {
		const worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), {
			type: 'module'
		});
		const entry: PoolWorker = { worker, busy: null, taskId: 0, ready: Promise.resolve() };
		entry.ready = new Promise<void>((resolve) => {
			const onReady = (e: MessageEvent<AnalyzerReply>) => {
				if (e.data.type === 'ready') {
					worker.removeEventListener('message', onReady);
					resolve();
				}
			};
			worker.addEventListener('message', onReady);
		});
		worker.postMessage({
			type: 'init',
			module: this.module ?? undefined
		} satisfies AnalyzerRequest);
		this.pool.push(entry);
		return entry;
	}

	private async dispatch(entry: PoolWorker, task: Task, generation: number) {
		entry.busy = task;
		task.started = true;
		this.emit();
		const fail = () => {
			entry.busy = null;
			if (generation !== this.generation) return;
			this.tasks.delete(task.sample.key);
			this.failed.add(task.sample.key);
			task.resolve();
			this.emit();
			this.pump();
		};

		try {
			const [wav] = await Promise.all([task.sample.read(), entry.ready]);
			if (generation !== this.generation) return;
			const id = ++entry.taskId;
			const features = await new Promise<Uint8Array | null>((resolve, reject) => {
				const onMessage = (e: MessageEvent<AnalyzerReply>) => {
					const msg = e.data;
					if (msg.type !== 'result' || msg.id !== id) return;
					entry.worker.removeEventListener('message', onMessage);
					entry.worker.removeEventListener('error', onError);
					resolve(msg.features);
				};
				const onError = (e: ErrorEvent) => {
					entry.worker.removeEventListener('message', onMessage);
					entry.worker.removeEventListener('error', onError);
					reject(new Error(e.message));
				};
				entry.worker.addEventListener('message', onMessage);
				entry.worker.addEventListener('error', onError);
				entry.worker.postMessage(
					{ type: 'analyze', id, wav, mode: this.mode } satisfies AnalyzerRequest,
					[wav.buffer]
				);
			});
			if (generation !== this.generation) return;
			if (!features) return fail();

			void this.cache?.put(this.voicebank!.id, this.cacheKey(task.sample), features.slice());
			await this.synth.cacheFeatures(task.sample.key, features);
			entry.busy = null;
			if (generation !== this.generation) return;
			this.tasks.delete(task.sample.key);
			this.done.add(task.sample.key);
			task.resolve();
			this.emit();
			this.pump();
		} catch (error) {
			console.warn(`[analysis] ${task.sample.path}:`, error);
			// A crashed analyzer is replaced, the sample is given up on.
			const index = this.pool.indexOf(entry);
			if (index >= 0) {
				entry.worker.terminate();
				this.pool.splice(index, 1);
			}
			fail();
		}
	}

	// ---- background warm-up ---------------------------------------------

	/** Analyzes the rest of the voicebank at low priority. Returns when done or cancelled. */
	async warmUp(files: string[], onDone?: () => void): Promise<void> {
		const run = ++this.bgRun;
		const concurrency = this.bgWorkerLimit() + 1;
		let next = 0;
		const lane = async () => {
			while (run === this.bgRun && next < files.length) {
				await this.ensureOne(files[next++], 'background');
			}
		};
		await Promise.all(Array.from({ length: concurrency }, lane));
		if (run === this.bgRun) onDone?.();
	}

	stopWarmUp() {
		this.bgRun++;
	}

	dispose() {
		this.generation++;
		this.bgRun++;
		this.resetState();
		clearTimeout(this.idleTimer);
	}
}
