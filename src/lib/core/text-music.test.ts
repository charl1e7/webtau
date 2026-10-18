import { describe, expect, it } from 'vitest';
import { forSeeds } from '../testing/rng';
import { createNote, clamp, gridTicks, isBlackKey, midiToHz, noteName, shade, snap } from './music';
import {
	kanaToRomaji,
	otherScript,
	romajiToKana,
	syllableKey,
	toHiragana,
	toKatakana
} from './kana';
import { applyLyrics, splitLyrics } from './lyrics';
import { isSpecialLyric, parseLyric } from './lyric-syntax';
import { PPQ } from './types';

const HIRAGANA = [
	...'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわをんゔ'
];

describe('kana: every character, both scripts', () => {
	it('katakana and hiragana give the same key', () => {
		for (const h of HIRAGANA) {
			expect(syllableKey(toKatakana(h)), h).toBe(syllableKey(h));
			expect(toHiragana(toKatakana(h))).toBe(h);
		}
	});

	it('never throws and never returns an empty key for a non-empty syllable', () => {
		for (const h of HIRAGANA) {
			expect(() => kanaToRomaji(h)).not.toThrow();
			expect(syllableKey(h).length).toBeGreaterThan(0);
		}
	});

	it('syllableKey is idempotent', () => {
		const samples = [
			...HIRAGANA,
			'shi',
			'si',
			'chi',
			'tsu',
			'ja',
			'KYA',
			'ra',
			"n'",
			'hello',
			'a-',
			'',
			'  ',
			'ー'
		];
		for (const s of samples) expect(syllableKey(syllableKey(s)), s).toBe(syllableKey(s));
	});

	it('every full-size syllable survives kana → romaji → kana', () => {
		const syllables = HIRAGANA.filter((c) => !'ぁぃぅぇぉっゃゅょゎ'.includes(c));
		for (const h of syllables) {
			const r = kanaToRomaji(h);
			expect(r, h).not.toBeNull();
			const back = romajiToKana(r!);
			// ぢ/づ share spellings with じ/ず; the key (what matching uses) must still agree.
			expect(syllableKey(back!), `${h} → ${r} → ${back}`).toBe(syllableKey(h));
		}
	});

	it('digraphs and sokuon', () => {
		for (const [k, r] of [
			['きゃ', 'kya'],
			['しゅ', 'shu'],
			['ちょ', 'cho'],
			['じゃ', 'ja'],
			['にゃ', 'nya'],
			['みょ', 'myo'],
			['りゅ', 'ryu'],
			['っぱ', 'ppa'],
			['っし', 'sshi'],
			['っち', 'tchi']
		])
			expect(kanaToRomaji(k), k).toBe(r);
		expect(kanaToRomaji('っ')).toBe('t');
	});

	it('long vowel mark repeats the previous vowel, or stays a dash when there is none', () => {
		expect(kanaToRomaji('らー')).toBe('raa');
		expect(kanaToRomaji('ー')).toBe('-');
		expect(kanaToRomaji('んー')).toBe('n-');
	});

	it('romajiToKana survives arbitrary strings', () => {
		forSeeds(300, (r) => {
			const alphabet = "abcdefghijklmnopqrstuvwxyz'-ー ";
			const s = Array.from(
				{ length: r.int(0, 12) },
				() => alphabet[r.int(0, alphabet.length - 1)]
			).join('');
			const out = romajiToKana(s);
			expect(out === null || typeof out === 'string').toBe(true);
		});
	});

	it('the letter n in all positions', () => {
		expect(romajiToKana('kanna')).toBe('かんな');
		expect(romajiToKana('kana')).toBe('かな');
		expect(romajiToKana('konnichiwa')).toBe('こんにちわ');
		expect(romajiToKana('onna')).toBe('おんな');
		expect(romajiToKana('shinya')).toBe('しにゃ');
		expect(romajiToKana("shin'ya")).toBe('しんや');
		expect(romajiToKana('kan')).toBe('かん');
		expect(romajiToKana('nn')).toBe('ん');
		expect(romajiToKana('nnn')).toBe('んん');
	});

	it('otherScript is symmetric for plain syllables', () => {
		for (const h of 'あかさたなはまやらわ') {
			const r = otherScript(h)!;
			expect(otherScript(r)).toBe(h);
		}
	});
});

describe('lyric grammar', () => {
	it('rest, continuation and hints', () => {
		for (const r of ['R', 'r', ' R ']) expect(parseLyric(r)).toEqual({ kind: 'rest' });
		for (const e of ['+', '+~', '+*', '...', '…'])
			expect(parseLyric(e)).toEqual({ kind: 'extend' });
		expect(parseLyric('ka[kya]')).toEqual({ kind: 'text', text: 'ka', hint: 'kya' });
		expect(parseLyric('[kya]')).toEqual({ kind: 'text', text: '', hint: 'kya' });
		expect(parseLyric('ka[]')).toEqual({ kind: 'text', text: 'ka' });
		expect(parseLyric('  ka  ')).toEqual({ kind: 'text', text: 'ka' });
	});

	it('only the first hint counts and text around hints is kept', () => {
		expect(parseLyric('a[x]b[y]')).toMatchObject({ text: 'ab', hint: 'x' });
	});

	it('words that merely look like a rest are not one', () => {
		for (const w of ['ra', 'rr', 'R!', '+1', '++']) expect(isSpecialLyric(w), w).toBe(false);
	});
});

describe('splitLyrics / applyLyrics', () => {
	it('separators: spaces, newlines, commas, Japanese commas', () => {
		expect(splitLyrics('a  b\nc,d，e、f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
		expect(splitLyrics('')).toEqual([]);
		expect(splitLyrics('  \n ')).toEqual([]);
	});

	it('kana is cut into morae, small kana stay with the previous one', () => {
		expect(splitLyrics('さくら')).toEqual(['さ', 'く', 'ら']);
		expect(splitLyrics('きょうと')).toEqual(['きょ', 'う', 'と']);
		expect(splitLyrics('ファイト')).toEqual(['ファ', 'イ', 'ト']);
		expect(splitLyrics('らー')).toEqual(['ら', 'ー']);
		expect(splitLyrics('ら')).toEqual(['ら']);
	});

	it('romaji is cut only when asked to', () => {
		expect(splitLyrics('sakura')).toEqual(['sakura']);
		expect(splitLyrics('sakura', { romaji: true })).toEqual(['sa', 'ku', 'ra']);
		expect(splitLyrics('hello world', { romaji: true })).toEqual(['hello', 'world']);
		expect(splitLyrics('ka +  R', { romaji: true })).toEqual(['ka', '+', 'R']);
		expect(splitLyrics('kyoto', { romaji: true })).toEqual(['kyo', 'to']);
	});

	it('applyLyrics follows time order, not array order, and leaves the rest alone', () => {
		const a = createNote({ id: 'a', tick: 960, pitch: 60, lyric: 'x' });
		const b = createNote({ id: 'b', tick: 0, pitch: 60, lyric: 'x' });
		const c = createNote({ id: 'c', tick: 480, pitch: 60, lyric: 'x' });
		const d = createNote({ id: 'd', tick: 1440, pitch: 60, lyric: 'keep' });
		const out = applyLyrics([a, b, c, d], new Set(['a', 'b', 'c']), 'one two');
		expect(Object.fromEntries(out.map((n) => [n.id, n.lyric]))).toEqual({
			a: 'x', // no syllable left for it
			b: 'one',
			c: 'two',
			d: 'keep'
		});
	});

	it('same-tick notes are ordered by pitch, deterministically', () => {
		const lo = createNote({ id: 'lo', tick: 0, pitch: 50 });
		const hi = createNote({ id: 'hi', tick: 0, pitch: 70 });
		const out = applyLyrics([hi, lo], new Set(['hi', 'lo']), 'a b');
		expect(out.find((n) => n.id === 'lo')!.lyric).toBe('a');
		expect(out.find((n) => n.id === 'hi')!.lyric).toBe('b');
	});
});

describe('music helpers', () => {
	it('note names and black keys, including below zero', () => {
		expect(noteName(60)).toBe('C4');
		expect(noteName(69)).toBe('A4');
		expect(noteName(61)).toBe('C#4');
		expect(noteName(0)).toBe('C-1');
		expect(noteName(-1)).toBe('B-2');
		expect(isBlackKey(61)).toBe(true);
		expect(isBlackKey(60)).toBe(false);
		expect(isBlackKey(-11)).toBe(true);
		expect(midiToHz(69)).toBeCloseTo(440);
		expect(midiToHz(57)).toBeCloseTo(220);
	});

	it('snap / clamp / grid', () => {
		expect(snap(7, 4)).toBe(8);
		expect(snap(5, 4)).toBe(4);
		expect(snap(-5, 4)).toBe(-4);
		expect(clamp(5, 0, 3)).toBe(3);
		expect(clamp(-5, 0, 3)).toBe(0);
		expect(gridTicks(1)).toBe(PPQ * 4);
		expect(gridTicks(4)).toBe(PPQ);
		expect(gridTicks(16)).toBe(PPQ / 4);
	});

	it('shade mixes towards white or black and tolerates bad input', () => {
		expect(shade('#000000', 1)).toBe('#ffffff');
		expect(shade('#ffffff', -1)).toBe('#000000');
		expect(shade('#808080', 0)).toBe('#808080');
		expect(shade('ff0000', 0.5)).toBe('#ff8080');
		expect(shade('red', 0.5)).toBe('red');
	});

	it('every new note has its own id', () => {
		const ids = new Set(Array.from({ length: 2000 }, () => createNote({ tick: 0, pitch: 60 }).id));
		expect(ids.size).toBe(2000);
	});
});
