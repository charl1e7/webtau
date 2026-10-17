/**
 * The small grammar of a note's lyric field:
 *
 *   ka        a syllable (any script)
 *   R / r     a rest
 *   + +~ +* ...   continue the previous note's sound
 *   ka[kya]   an explicit hint: use the alias in brackets as it is
 *   [kya]     the same without display text
 */

export type ParsedLyric =
	{ kind: 'rest' } | { kind: 'extend' } | { kind: 'text'; text: string; hint?: string };

const EXTEND = /^(\+[~*]?|\.\.\.|…)$/;

export function parseLyric(lyric: string): ParsedLyric {
	const trimmed = lyric.trim();
	if (/^r$/i.test(trimmed)) return { kind: 'rest' };
	if (EXTEND.test(trimmed)) return { kind: 'extend' };

	let hint: string | undefined;
	const text = trimmed
		.replace(/\[([^\]]*)\]/g, (_, h: string) => {
			hint ??= h.trim() || undefined;
			return '';
		})
		.trim();
	return hint !== undefined ? { kind: 'text', text, hint } : { kind: 'text', text };
}

/** True for lyrics that are not a syllable of their own (rest, continuation). */
export function isSpecialLyric(lyric: string): boolean {
	return parseLyric(lyric).kind !== 'text';
}
