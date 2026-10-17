import type { EngineSession } from '#lib/engine/session';
import type { RenderHooks, RenderJob, RenderNote, RenderStream, RendererBackend } from './types';
import type { Voicebank } from '#lib/voicebank/types';

/**
 * The classic UTAU backend: WORLD analysis and resampling in WebAssembly, run
 * in workers (see src/lib/engine). The session is created lazily by `engine`,
 * which keeps this module free of application state.
 */
export function createWorldRenderer(engine: () => Promise<EngineSession>): RendererBackend {
	return {
		id: 'world',
		name: 'UTAU (WORLD resampler)',
		description: 'Classic UTAU voicebanks: oto.ini and WAV samples, synthesized in the browser.',

		supports: (voicebank: Voicebank) => voicebank.kind === 'utau',

		async load(voicebank) {
			await (await engine()).loadVoicebank(voicebank);
		},

		stream(notes: RenderNote[], tempo: number, hooks?: RenderHooks): RenderStream {
			return lazyStream(engine().then((session) => session.stream(notes, tempo, hooks)));
		},

		render(notes: RenderNote[], tempo: number, hooks?: RenderHooks): RenderJob {
			let cancelled = false;
			let cancelInner: () => void = () => {};
			const promise = engine().then((session) => {
				if (cancelled) return null;
				const job = session.render(notes, tempo, hooks);
				cancelInner = job.cancel;
				return job.promise;
			});
			return {
				promise,
				cancel: () => {
					cancelled = true;
					cancelInner();
				}
			};
		}
	};
}

/**
 * The engine session is created lazily, so the stream is too. Until it exists
 * nothing is ready, and everything the caller asked for in the meantime
 * (focus, cancel, change callback) is passed on once it does.
 */
function lazyStream(created: Promise<RenderStream>): RenderStream {
	let inner: RenderStream | null = null;
	let focusMs = 0;
	let cancelled = false;
	const outer: RenderStream = {
		buffer: new Float32Array(0),
		durationMs: 0,
		focus(ms) {
			focusMs = ms;
			inner?.focus(ms);
		},
		readyUntil: (ms) => inner?.readyUntil(ms) ?? ms,
		ready: () => inner?.ready() ?? [],
		get complete() {
			return inner?.complete ?? false;
		},
		get progress() {
			return inner?.progress ?? { done: 0, total: 0 };
		},
		get waiting() {
			return inner?.waiting ?? 'Starting the engine';
		},
		onChange: null,
		promise: created.then((s) => {
			inner = s;
			Object.defineProperty(outer, 'buffer', { value: s.buffer });
			Object.defineProperty(outer, 'durationMs', { value: s.durationMs });
			s.focus(focusMs);
			if (cancelled) s.cancel();
			s.onChange = () => outer.onChange?.();
			outer.onChange?.();
			return s.promise;
		}),
		cancel() {
			cancelled = true;
			inner?.cancel();
		}
	};
	return outer;
}
