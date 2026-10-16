import type { EngineNote, RenderReport } from './bridge';
import { AnalysisScheduler, type AnalysisStats } from './analysis';
import { FeatureCache } from './feature-cache';
import { SynthClient, WorkerCrashedError } from './synth-client';
import { compileWasm } from './wasm';
import type { Voicebank } from '#lib/voicebank/types';
import type { AnalysisMode } from './bridge';

export interface RenderHooks {
	onAnalyze?: (done: number, total: number) => void;
	onSynthesize?: (done: number, total: number) => void;
}

export interface RenderOutcome {
	pcm: Float32Array;
	report: RenderReport;
}

export interface EngineOptions {
	workers: number;
	mode: AnalysisMode;
}

export const SAMPLE_RATE = 44100;

/**
 * Facade over the whole audio backend: the synthesis worker, the pool that
 * analyzes samples and the persistent feature cache.
 */
export class EngineSession {
	private voicebank: Voicebank | null = null;
	private recovery: Promise<void> | null = null;
	onStats: ((stats: AnalysisStats) => void) | null = null;

	private constructor(
		private readonly synth: SynthClient,
		private readonly scheduler: AnalysisScheduler,
		readonly cache: FeatureCache | null
	) {
		synth.onCrash = () => {
			this.recovery = this.recover().finally(() => (this.recovery = null));
		};
		scheduler.onStats = (s) => this.onStats?.(s);
	}

	static async create(options: EngineOptions): Promise<EngineSession> {
		const [module, cache] = await Promise.all([
			compileWasm().catch(() => null),
			FeatureCache.open()
		]);
		const synth = new SynthClient(module);
		const { analysisVersion } = await synth.init();
		const scheduler = new AnalysisScheduler(synth, cache, module, analysisVersion);
		scheduler.maxWorkers = options.workers;
		scheduler.mode = options.mode;
		return new EngineSession(synth, scheduler, cache);
	}

	private async recover() {
		await this.synth.init();
		if (this.voicebank) {
			await this.synth.loadVoicebank(this.voicebank.oto, this.voicebank.prefixMap);
		}
		this.scheduler.invalidate();
	}

	configure(options: Partial<EngineOptions>) {
		if (options.workers !== undefined) this.scheduler.maxWorkers = options.workers;
		if (options.mode !== undefined) this.scheduler.setMode(options.mode);
	}

	async loadVoicebank(vb: Voicebank): Promise<void> {
		this.scheduler.stopWarmUp();
		this.voicebank = null;
		const { entries } = await this.synth.loadVoicebank(vb.oto, vb.prefixMap);
		vb.aliasFile = new Map(entries.map(([alias, file]) => [alias, file]));
		vb.aliases = [...vb.aliasFile.keys()].sort((a, b) => a.localeCompare(b));
		this.voicebank = vb;
		this.scheduler.setVoicebank(vb);
	}

	/** Samples that oto.ini entries point to and that exist in the voicebank. */
	referencedFiles(): string[] {
		const vb = this.voicebank;
		if (!vb) return [];
		const files = new Set<string>();
		for (const file of vb.aliasFile.values()) {
			const key = file.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
			if (vb.samples.has(key)) files.add(key);
		}
		return [...files];
	}

	warmUp(onDone?: () => void) {
		void this.scheduler.warmUp(this.referencedFiles(), onDone);
	}

	stopWarmUp() {
		this.scheduler.stopWarmUp();
	}

	/**
	 * Analyzes whatever the notes need, then renders them. `cancel()` aborts
	 * whichever phase is running; the promise then resolves with `null`.
	 */
	render(notes: EngineNote[], tempo: number, hooks: RenderHooks = {}) {
		let cancelled = false;
		let cancelPhase: (() => void) | null = null;
		const cancel = () => {
			cancelled = true;
			cancelPhase?.();
		};

		const attempt = async (): Promise<RenderOutcome | null> => {
			const required = await this.synth.requiredFiles(notes);
			if (cancelled) return null;
			if (required.files.length) {
				await this.scheduler.ensure(required.files, 'now', hooks.onAnalyze);
			}
			if (cancelled) return null;
			const job = this.synth.render(notes, tempo, hooks.onSynthesize);
			cancelPhase = job.cancel;
			const result = await job.promise;
			cancelPhase = null;
			return result;
		};

		const promise = (async () => {
			try {
				return await attempt();
			} catch (error) {
				if (error instanceof WorkerCrashedError && !cancelled) {
					await this.recovery;
					return attempt();
				}
				throw error;
			}
		})();
		return { promise, cancel };
	}

	dispose() {
		this.scheduler.dispose();
		this.synth.terminate();
	}
}
