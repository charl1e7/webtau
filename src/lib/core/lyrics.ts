import { kanaToRomaji, romajiToKana } from './kana';
import { isSpecialLyric } from './lyric-syntax';
import type { Note } from './types';
import { sortNotes } from './ops';

const SMALL_KANA = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ']);

/**
 * Splits text into syllables: tokens are separated by whitespace; a token of
 * Japanese kana is split into morae (きゃ stays one syllable, ー and っ attach
 * to the previous one only when standing alone is impossible).
 */
export interface SplitOptions {
	/** Also cut unbroken romaji ("sakura") into syllables ("sa ku ra"). Off by default: English words look like romaji too. */
	romaji?: boolean;
}

export function splitLyrics(text: string, options: SplitOptions = {}): string[] {
	const out: string[] = [];
	for (const raw of text.split(/[\s,，、]+/).filter(Boolean)) {
		let token = raw;
		if (options.romaji && !isSpecialLyric(token) && /^[a-zA-Z'-]{3,}$/.test(token)) {
			const kana = romajiToKana(token);
			if (kana && kana.length > 1) token = kana;
			else {
				out.push(token);
				continue;
			}
			// Back to romaji, one syllable at a time, so that the notes get "sa ku ra", not "さくら".
			const moras = splitLyrics(token);
			const romaji = moras.map((m) => kanaToRomaji(m));
			if (romaji.every((r): r is string => r !== null)) {
				out.push(...romaji);
				continue;
			}
		}
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
	text: string,
	options: SplitOptions = {}
): Note[] {
	const syllables = splitLyrics(text, options);
	const order = sortNotes(notes.filter((n) => ids.has(n.id)));
	const lyricFor = new Map<string, string>();
	order.forEach((n, i) => {
		if (i < syllables.length) lyricFor.set(n.id, syllables[i]);
	});
	return notes.map((n) => (lyricFor.has(n.id) ? { ...n, lyric: lyricFor.get(n.id)! } : n));
}
