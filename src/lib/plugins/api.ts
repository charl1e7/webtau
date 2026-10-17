import type { Note } from '#lib/core/types';
import type { AliasIndex } from '#lib/voicebank/alias-index';

/*
 * The extension API. A plugin is a plain object; every capability is optional.
 * Plugins never touch application state: they get what they need in the
 * arguments and return data, so they are easy to test and to swap.
 */

/** What is known about the note whose lyric is being resolved. */
export interface ResolveContext {
	index: AliasIndex;
	pitch: number;
	/** The previous note of the same track when it directly precedes this one; null at a phrase start. */
	prev: { alias: string; key: string; vowel: string | null } | null;
}

/** A spelling of the lyric that the voicebank might know. */
export interface Candidate {
	alias: string;
	/** 0..1; the best-scoring candidate that exists in the voicebank wins. */
	score: number;
	/** Short explanation shown to the user ("kana → romaji"). */
	why: string;
	/** false: only offered to the user (e.g. a near miss), never applied silently. */
	auto?: boolean;
}

export interface SuggestContext {
	index: AliasIndex;
	pitch: number;
	limit: number;
}

/** An entry for the lyric box. */
export interface Suggestion {
	alias: string;
	/** Secondary text: the same syllable in another script, a language tag… */
	hint?: string;
	/** Lower comes first. */
	rank: number;
}

/** What a command may do with the project. */
export interface PluginHost {
	readonly notes: readonly Note[];
	/** Selected notes, or every note when nothing is selected. */
	readonly targets: readonly Note[];
	readonly index: AliasIndex | null;
	/** How the lyric of `note` resolves against the loaded voicebank. */
	resolve(note: Note): Resolution | null;
	/** Rewrites lyrics as one undoable step. Keys are note ids. */
	setLyrics(changes: ReadonlyMap<string, string>): void;
	toast(message: string, kind?: 'info' | 'success' | 'error'): void;
	openLyricDoctor(): void;
}

export interface PluginCommand {
	id: string;
	label: string;
	icon?: string;
	/** Grey the entry out when it cannot run (no voicebank, no notes…). */
	enabled?(host: PluginHost): boolean;
	run(host: PluginHost): void | Promise<void>;
}

export interface Plugin {
	/** Stable id, e.g. "ja.script-bridge". */
	id: string;
	name: string;
	description: string;
	/** Lower runs first among equals; only matters for ties in score. */
	priority?: number;

	/** Spellings of a lyric that the voicebank might know. */
	candidates?(lyric: string, ctx: ResolveContext): Candidate[];
	/** Entries for the lyric box while the user types. */
	suggest?(query: string, ctx: SuggestContext): Suggestion[];
	/** Commands for the Edit ▸ Lyrics menu. */
	commands?: PluginCommand[];
}

export type Resolution =
	| { status: 'rest'; alias: string }
	| { status: 'exact' | 'mapped'; alias: string; why?: string }
	| { status: 'missing'; alias: string; suggestions: Candidate[] };
