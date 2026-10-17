import type { EngineSession } from '#lib/engine/session';
import type { RenderHooks, RenderJob, RenderNote, RendererBackend } from './types';
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
