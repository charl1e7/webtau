import type { Note } from './types';
import { sortNotes } from './ops';

const SMALL_KANA = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ']);

/**
 * Splits text into syllables: tokens are separated by whitespace; a token of
 * Japanese kana is split into morae (きゃ stays one syllable, ー and っ attach
 * to the previous one only when standing alone is impossible).
 */
export function splitLyrics(text: string): string[] {
	const out: string[] = [];
	for (const token of text.split(/[\s,，、]+/).filter(Boolean)) {
		if (/^[぀-ヿー]+$/.test(token) && token.length > 1) {
			let cur = '';
			for (const ch of token) {
				if (SMALL_KANA.has(ch) && cur) cur += ch;
				else {
					if (cur) out.push(cur);
					cur = ch;
				}
			}
			if (cur) out.push(cur);
		} else {
			out.push(token);
		}
	}
	return out;
}

/** Assigns syllables to the given notes in time order. Extra notes keep their lyric. */
export function applyLyrics(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	text: string
): Note[] {
	const syllables = splitLyrics(text);
	const order = sortNotes(notes.filter((n) => ids.has(n.id)));
	const lyricFor = new Map<string, string>();
	order.forEach((n, i) => {
		if (i < syllables.length) lyricFor.set(n.id, syllables[i]);
	});
	return notes.map((n) => (lyricFor.has(n.id) ? { ...n, lyric: lyricFor.get(n.id)! } : n));
}
