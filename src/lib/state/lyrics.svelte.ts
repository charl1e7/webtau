import { isSpecialLyric } from '#lib/core/lyric-syntax';
import type { Note } from '#lib/core/types';
import type { Candidate, Resolution } from '#lib/plugins/api';
import { resolveLyric } from '#lib/plugins/registry';
import { plugins } from './plugins.svelte';
import { project } from './project.svelte';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';
import { voicebank } from './voicebank.svelte';

/** One lyric that the voicebank does not have, with every note that uses it. */
export interface MissingLyric {
	lyric: string;
	noteIds: string[];
	suggestions: Candidate[];
}

class LyricState {
	/** How each note's lyric resolves against the loaded voicebank (empty without one). */
	resolutions = $derived.by(() => {
		void plugins.version;
		const index = voicebank.index;
		if (!index) return new Map<string, Resolution>();
		return plugins.resolver.resolveAll(project.notes, index);
	});

	/** Notes that cannot be sung: their lyric is not in the voicebank and nothing maps to it. */
	missing = $derived.by(() => {
		const out = new Set<string>();
		for (const [id, r] of this.resolutions) if (r.status === 'missing') out.add(id);
		return out as ReadonlySet<string>;
	});

	/** The alias to hand to the engine for a note: what its lyric resolves to, else the lyric itself. */
	alias = (note: Note): string => {
		const r = this.resolutions.get(note.id);
		return r && r.status !== 'rest' && r.status !== 'missing' && r.alias ? r.alias : note.lyric;
	};

	resolutionOf = (id: string): Resolution | undefined => this.resolutions.get(id);

	/** Missing lyrics grouped by spelling, most used first. */
	groups = $derived.by(() => {
		const index = voicebank.index;
		const byLyric = new Map<string, MissingLyric>();
		if (!index) return [] as MissingLyric[];
		for (const n of project.notes) {
			const r = this.resolutions.get(n.id);
			if (r?.status !== 'missing' || isSpecialLyric(n.lyric)) continue;
			let g = byLyric.get(n.lyric);
			if (!g) {
				g = { lyric: n.lyric, noteIds: [], suggestions: [] };
				byLyric.set(n.lyric, g);
				g.suggestions = r.suggestions;
			}
			g.noteIds.push(n.id);
		}
		return [...byLyric.values()].sort((a, b) => b.noteIds.length - a.noteIds.length);
	});

	/** Suggestions for one lyric as it would be sung on a given note (for the lyric box). */
	suggestFor(query: string, pitch: number, limit = 60) {
		const index = voicebank.index;
		if (!index) return [];
		return plugins.registry.suggest(query, { index, pitch, limit });
	}

	/** Resolution of an arbitrary text on a pitch (no neighbouring note). */
	preview(text: string, pitch: number): Resolution | null {
		const index = voicebank.index;
		return index ? resolveLyric(text, { index, pitch, prev: null }, plugins.registry) : null;
	}

	/** Opens the doctor when an import left lyrics the voicebank cannot sing. */
	offerFix() {
		if (!settings.data.lyricDoctor || !voicebank.index) return;
		const count = this.groups.length;
		if (count) {
			ui.toast(`${count} lyric(s) are not in the voicebank: choose replacements.`, 'info');
			ui.openDialog('lyric-doctor');
		}
	}

	/** After a voicebank is loaded: point at the lyrics it cannot sing, without interrupting. */
	notifyAfterVoicebank() {
		const n = this.groups.reduce((sum, g) => sum + g.noteIds.length, 0);
		if (n) ui.toast(`${n} note(s) use lyrics this voicebank does not have (Edit ▸ Lyrics ▸ Fix).`);
	}
}

export const lyrics = new LyricState();
voicebank.loadedListeners.push(() => lyrics.notifyAfterVoicebank());
