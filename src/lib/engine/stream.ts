import type { EngineNote, PlanEntry, RenderReport } from './bridge';
import type { AnalysisScheduler } from './analysis';
import type { SynthClient } from './synth-client';
import { complement, endOfRunAt, subtract, union, type Interval } from '#lib/render/intervals';
import type { RenderHooks, RenderOutcome, RenderStream } from '#lib/render/types';

const SAMPLE_RATE = 44100;
/** Notes rendered between two looks at the playhead: small enough to follow it quickly. */
const BATCH = 4;
/** A rendered note may sound a little outside the span that was planned for it (frame rounding). */
const PAD_MS = 10;
/** Longest piece of finished audio fetched at once. */
const READ_MS = 4000;

/**
 * Renders a project a few notes at a time, starting around the playhead and
 * moving with it, and hands the finished audio over as soon as it is final.
 * A stretch of time is final when no note that has not been rendered yet can
 * still sound in it.
 */
export class EngineStream implements RenderStream {
	readonly buffer: Float32Array;
	readonly durationMs: number;
	progress = { done: 0, total: 0 };
	waiting: string | null = null;
	complete = false;
	onChange: (() => void) | null = null;
	readonly promise: Promise<RenderOutcome | null>;
	/** Resolves when the engine session of this stream is closed and a new one may start. */
	readonly finished: Promise<void>;

	private focusMs = 0;
	private cancelled = false;
	private delivered: Interval[] = [];
	private closeFinished!: () => void;

	constructor(
		private readonly synth: SynthClient,
		private readonly scheduler: AnalysisScheduler,
		private readonly notes: EngineNote[],
		private readonly tempo: number,
		private readonly hooks: RenderHooks = {},
		/** Called with the engine's report when the session ended, to let the session finish its books. */
		private readonly after: Promise<void> = Promise.resolve()
	) {
		const end = notes.reduce((m, n) => Math.max(m, n.start_time + n.duration), 0) + 2000;
		const samples = Math.ceil((end / 1000) * SAMPLE_RATE);
		this.buffer = new Float32Array(samples);
		this.durationMs = (samples / SAMPLE_RATE) * 1000;
		this.finished = new Promise<void>((r) => (this.closeFinished = r));
		this.promise = this.after.then(() => this.run()).finally(() => this.closeFinished());
	}

	focus(ms: number) {
		this.focusMs = Math.max(0, ms);
	}

	cancel() {
		this.cancelled = true;
	}

	ready(): Interval[] {
		return this.delivered;
	}

	readyUntil(ms: number): number {
		return endOfRunAt(this.delivered, ms);
	}

	private notify() {
		this.onChange?.();
	}

	private async run(): Promise<RenderOutcome | null> {
		if (this.cancelled) return null;
		const { plan } = await this.synth.streamBegin(this.notes, this.tempo);
		let complete = false;
		let report: RenderReport | null = null;
		try {
			report = await this.renderAll(plan);
			complete = !this.cancelled;
		} finally {
			const ended = await this.synth.streamEnd(complete).catch(() => null);
			report = ended?.report ?? report;
		}
		if (!complete || !report) return null;
		this.complete = true;
		this.delivered = [{ start: 0, end: this.durationMs }];
		this.notify();
		return { pcm: this.buffer, report };
	}

	private async renderAll(plan: PlanEntry[]): Promise<RenderReport | null> {
		const spans = plan.map((p) => ({ start: p.span_start - PAD_MS, end: p.span_end + PAD_MS }));
		// Time that no note can reach is final from the start (silence).
		this.delivered = complement(spans, 0, this.durationMs);
		this.progress = { done: 0, total: plan.length };
		this.notify();

		let todo = plan.map((p, i) => ({ p, span: spans[i] }));
		while (todo.length && !this.cancelled) {
			// The first note that is still to sound at the playhead, then onwards, then the earlier ones.
			const first = Math.max(
				0,
				todo.findIndex((t) => t.span.end > this.focusMs)
			);
			const batch = [...todo.slice(first), ...todo.slice(0, first)].slice(0, BATCH);

			const files = [...new Set(batch.map((t) => t.p.file).filter(Boolean))];
			if (files.length) {
				this.waiting = `Analyzing ${files.length} sample${files.length > 1 ? 's' : ''}`;
				this.notify();
				await this.scheduler.ensure(files, 'now', this.hooks.onAnalyze);
				this.waiting = null;
				if (this.cancelled) break;
			}
			await this.synth.streamRender(batch.map((t) => t.p.index));
			this.progress.done += batch.length;
			this.hooks.onSynthesize?.(this.progress.done, this.progress.total);

			const rendered = new Set(batch);
			todo = todo.filter((t) => !rendered.has(t));
			await this.deliver(todo.map((t) => t.span));
		}
		return null;
	}

	/** Fetches the audio that became final (no unrendered note can reach it any more). */
	private async deliver(unrendered: Interval[]) {
		const final = complement(union(unrendered), 0, this.durationMs);
		for (const piece of subtract(final, this.delivered)) {
			for (let t = piece.start; t < piece.end && !this.cancelled; t += READ_MS) {
				const end = Math.min(piece.end, t + READ_MS);
				const from = Math.max(0, Math.floor((t / 1000) * SAMPLE_RATE));
				const to = Math.min(this.buffer.length, Math.ceil((end / 1000) * SAMPLE_RATE));
				if (to <= from) continue;
				const { pcm } = await this.synth.streamRead(from, to - from);
				this.buffer.set(pcm.subarray(0, to - from), from);
			}
		}
		if (!this.cancelled) {
			this.delivered = union([...this.delivered, ...subtract(final, this.delivered)]);
			this.notify();
		}
	}
}
