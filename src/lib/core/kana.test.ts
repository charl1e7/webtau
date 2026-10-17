import { describe, expect, it } from 'vitest';
import {
	hasKana,
	isKana,
	kanaToRomaji,
	otherScript,
	romajiToKana,
	syllableKey,
	toHiragana,
	toKatakana
} from './kana';

describe('romaji → kana', () => {
	it.each([
		['a', 'あ'],
		['ka', 'か'],
		['shi', 'し'],
		['si', 'し'],
		['tsu', 'つ'],
		['chi', 'ち'],
		['fu', 'ふ'],
		['kya', 'きゃ'],
		['sha', 'しゃ'],
		['ja', 'じゃ'],
		['n', 'ん'],
		['nn', 'ん'],
		['na', 'な'],
		['nya', 'にゃ'],
		['nna', 'んな'],
		["n'a", 'んあ'],
		['kka', 'っか'],
		['fa', 'ふぁ'],
		['ti', 'ち'],
		['thi', 'てぃ'],
		['-', 'ー'],
		['KA', 'か']
	])('%s → %s', (romaji, kana) => expect(romajiToKana(romaji)).toBe(kana));

	it('rejects text that is not romaji', () => {
		expect(romajiToKana('hello')).toBeNull();
		expect(romajiToKana('')).toBeNull();
		expect(romajiToKana('ka1')).toBeNull();
	});
});

describe('kana → romaji', () => {
	it.each([
		['あ', 'a'],
		['ら', 'ra'],
		['ラ', 'ra'],
		['し', 'shi'],
		['きゃ', 'kya'],
		['しゅ', 'shu'],
		['っか', 'kka'],
		['ちゃ', 'cha'],
		['ん', 'n'],
		['かー', 'kaa'],
		['ふぁ', 'fa'],
		['てぃ', 'thi'],
		['ヴァ', 'va']
	])('%s → %s', (kana, romaji) => expect(kanaToRomaji(kana)).toBe(romaji));

	it('rejects other characters', () => {
		expect(kanaToRomaji('ab')).toBeNull();
		expect(kanaToRomaji('漢')).toBeNull();
	});

	it('round-trips every syllable of the basic table', () => {
		for (const k of [
			...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
		]) {
			expect(romajiToKana(kanaToRomaji(k)!)).toBe(k);
		}
	});
});

describe('scripts and keys', () => {
	it('detects and converts syllabaries', () => {
		expect(isKana('ら')).toBe(true);
		expect(isKana('ra')).toBe(false);
		expect(hasKana('a ら')).toBe(true);
		expect(toKatakana('らー')).toBe('ラー');
		expect(toHiragana('ラー')).toBe('らー');
	});

	it('gives one key to every spelling of a syllable', () => {
		const same = [
			['ら', 'ラ', 'ra', 'RA'],
			['し', 'シ', 'shi', 'si'],
			['ちゃ', 'cha', 'tya'],
			['じ', 'ji', 'zi'],
			['ふ', 'fu', 'hu'],
			['つ', 'tsu', 'tu']
		];
		for (const group of same) {
			const keys = new Set(group.map(syllableKey));
			expect(keys.size, group.join()).toBe(1);
		}
		expect(syllableKey('ka')).not.toBe(syllableKey('ga'));
		expect(syllableKey('shi')).not.toBe(syllableKey('sa'));
	});

	it('leaves other languages alone', () => {
		expect(syllableKey('Hello')).toBe('hello');
		expect(syllableKey('привет')).toBe('привет');
		expect(syllableKey('你')).toBe('你');
	});

	it('names the same syllable in the other script', () => {
		expect(otherScript('ら')).toBe('ra');
		expect(otherScript('ra')).toBe('ら');
		expect(otherScript('hello')).toBeNull();
		expect(otherScript('你')).toBeNull();
	});
});
