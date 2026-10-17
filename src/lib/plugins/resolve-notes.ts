import type { Note } from '#lib/core/types';
import type { AliasIndex } from '#lib/voicebank/alias-index';
import type { PluginRegistry } from './registry';
import { continuity, resolveLyric } from './registry';
import type { ResolveContext, Resolution } from './api';

/** A previous note counts as "directly before" when it ends at most this far ahead of the next. */
const ADJACENT_GAP_TICKS = 60;

/**
 * Resolves the lyrics of a whole project in one pass, so that every note sees
 * the sound of the one before it (VCV banks need that). Results are memoized
 * per distinct (lyric, pitch, previous sound), which makes re-resolving a
 * large project after a small edit cheap.
 */
export class NoteResolver {
	private cache = new Map<string, Resolution>();
	private cachedFor: { index: AliasIndex | null; version: number } = { index: null, version: -1 };

	constructor(private readonly registry: PluginRegistry) {}

	resolveAll(notes: readonly Note[], index: AliasIndex): Map<string, Resolution> {
		if (this.cachedFor.index !== index || this.cachedFor.version !== this.registry.version) {
			this.cache = new Map();
			this.cachedFor = { index, version: this.registry.version };
		}
		const byTrack = new Map<string, Note[]>();
		for (const n of notes) {
			const list = byTrack.get(n.track);
			if (list) list.push(n);
			else byTrack.set(n.track, [n]);
		}
		const out = new Map<string, Resolution>();
		for (const list of byTrack.values()) {
			list.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
			let prev: { end: number; context: ResolveContext['prev'] } | null = null;
			for (const n of list) {
				const adjacent = prev && n.tick - prev.end <= ADJACENT_GAP_TICKS ? prev.context : null;
				const affix = index.affixAt(n.pitch);
				const key = `${n.lyric}\u0000${affix?.prefix ?? ''}\u0001${affix?.suffix ?? ''}\u0000${adjacent?.alias ?? ''}\u0000${adjacent?.vowel ?? ''}`;
				let r = this.cache.get(key);
				if (!r) {
					r = resolveLyric(n.lyric, { index, pitch: n.pitch, prev: adjacent }, this.registry);
					this.cache.set(key, r);
				}
				out.set(n.id, r);
				prev = { end: n.tick + n.length, context: continuity(r) };
			}
		}
		return out;
	}
}
