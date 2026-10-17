import { loadFromEntry, loadFromFileList } from '#lib/voicebank/loader';
import { AliasIndex } from '#lib/voicebank/alias-index';
import type { Voicebank } from '#lib/voicebank/types';
import type { AnalysisStats } from '#lib/engine/analysis';
import { getEngine, onEngineStats } from './engine';
import { project } from './project.svelte';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';

const EMPTY_STATS: AnalysisStats = { total: 0, ready: 0, fromCache: 0, failed: 0, running: 0 };

class VoicebankState {
	current = $state.raw<Voicebank | null>(null);
	loading = $state(false);
	stats = $state<AnalysisStats>(EMPTY_STATS);
	/** Changes whenever a different voicebank is loaded: invalidates rendered audio. */
	revision = $state(0);
	warmingUp = $state(false);
	/** Called after a voicebank was loaded (other modules react without this one knowing them). */
	readonly loadedListeners: (() => void)[] = [];

	constructor() {
		onEngineStats((s) => (this.stats = s));
	}

	aliases = $derived(this.current?.aliases ?? []);
	/** What the loaded voicebank can sing, for matching lyrics (null while none is loaded). */
	index = $derived.by(() => {
		const vb = this.current;
		if (!vb || !vb.aliases.length) return null;
		return new AliasIndex(vb.aliases, vb.prefixMap ? new TextDecoder().decode(vb.prefixMap) : null);
	});

	async load(source: File[] | FileSystemEntry) {
		if (this.loading) return;
		this.loading = true;
		try {
			const engine = await getEngine();
			const status = (m: string) => ui.setStatus(m);
			const vb = Array.isArray(source)
				? await loadFromFileList(source, status)
				: await loadFromEntry(source, status);

			status('Parsing voicebank…');
			if (this.current?.image) URL.revokeObjectURL(this.current.image);
			await engine.loadVoicebank(vb);
			this.current = vb;
			this.revision++;
			project.voicebankName = vb.name;
			ui.toast(
				`Voicebank “${vb.name}” loaded: ${vb.aliases.length} aliases` +
					(vb.generatedOto ? ' (oto.ini generated)' : ''),
				'success'
			);
			for (const listener of this.loadedListeners) listener();

			if (settings.data.backgroundAnalysis) {
				this.warmingUp = true;
				engine.warmUp(() => {
					this.warmingUp = false;
					ui.setStatus(`All samples of “${vb.name}” are analyzed.`);
				});
			}
		} catch (error) {
			ui.error(error instanceof Error ? error.message : 'Failed to load the voicebank.');
		} finally {
			this.loading = false;
		}
	}

	async analyzeAll() {
		const engine = await getEngine();
		this.warmingUp = true;
		engine.warmUp(() => (this.warmingUp = false));
	}

	async stopAnalysis() {
		(await getEngine()).stopWarmUp();
		this.warmingUp = false;
	}
}

export const voicebank = new VoicebankState();
