import { describe, expect, it } from 'vitest';
import { isSpecialLyric, parseLyric } from './lyric-syntax';

describe('parseLyric', () => {
	it('recognizes rests and continuations', () => {
		expect(parseLyric('R')).toEqual({ kind: 'rest' });
		expect(parseLyric(' r ')).toEqual({ kind: 'rest' });
		for (const e of ['+', '+~', '+*', '...', '…'])
			expect(parseLyric(e)).toEqual({ kind: 'extend' });
	});

	it('reads plain syllables', () => {
		expect(parseLyric(' ka ')).toEqual({ kind: 'text', text: 'ka' });
		expect(parseLyric('ら')).toEqual({ kind: 'text', text: 'ら' });
		expect(parseLyric('ra')).toEqual({ kind: 'text', text: 'ra' });
	});

	it('splits a hint from the display text', () => {
		expect(parseLyric('ら[ra]')).toEqual({ kind: 'text', text: 'ら', hint: 'ra' });
		expect(parseLyric('[kya]')).toEqual({ kind: 'text', text: '', hint: 'kya' });
		expect(parseLyric('a [ b ] c')).toEqual({ kind: 'text', text: 'a  c', hint: 'b' });
		expect(parseLyric('ka[]')).toEqual({ kind: 'text', text: 'ka' });
	});

	it('tells special lyrics from syllables', () => {
		expect(isSpecialLyric('R')).toBe(true);
		expect(isSpecialLyric('+')).toBe(true);
		expect(isSpecialLyric('ka')).toBe(false);
	});
});
