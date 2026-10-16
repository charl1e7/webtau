import { browser } from '$app/env';
import type { EngineSession } from '#lib/engine/session';
import type { AnalysisStats } from '#lib/engine/analysis';
import { settings } from './settings.svelte';

let session: Promise<EngineSession> | null = null;
let statsListener: ((s: AnalysisStats) => void) | null = null;

/** Lazily creates the audio backend (workers + wasm); only available in the browser. */
export function getEngine(): Promise<EngineSession> {
	if (!browser) return Promise.reject(new Error('The audio engine only runs in the browser.'));
	session ??= import('#lib/engine/session').then(async ({ EngineSession }) => {
		const engine = await EngineSession.create({
			workers: settings.workerCount,
			mode: settings.data.analysisQuality === 'fast' ? 1 : 0
		});
		engine.onStats = statsListener;
		return engine;
	});
	session.catch(() => (session = null));
	return session;
}

export function onEngineStats(listener: (s: AnalysisStats) => void) {
	statsListener = listener;
}

/** Starts creating the engine early so that the first Play is instant. */
export function preloadEngine() {
	if (browser) void getEngine().catch(() => {});
}
