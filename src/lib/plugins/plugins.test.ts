import { describe, expect, it } from 'vitest';
import { createNote } from '#lib/core/music';
import { AliasIndex, parsePitchName, parsePrefixMap } from '#lib/voicebank/alias-index';
import { BUILTIN_PLUGINS } from './builtin';
import { NoteResolver } from './resolve-notes';
import { PluginRegistry, resolveLyric } from './registry';
import type { Plugin } from './api';

const registry = () => {
	const r = new PluginRegistry();
	BUILTIN_PLUGINS.forEach((p) => r.register(p));
	return r;
};
const ctx = (
	index: AliasIndex,
	pitch = 60,
	prev: { alias: string; key: string; vowel: string | null } | null = null
) => ({
	index,
	pitch,
	prev
});

const ROMAJI = new AliasIndex([
	'a',
	'i',
	'u',
	'e',
	'o',
	'ka',
	'ki',
	'sa',
	'shi',
	'ta',
	'mi',
	'n',
	'kya'
]);
const KANA = new AliasIndex([
	'あ',
	'い',
	'う',
	'か',
	'き',
	'さ',
	'し',
	'た',
	'み',
	'ん',
	'きゃ',
	'ラ'
]);
const VCV = new AliasIndex(['- あ', '- か', '- ら', 'あ か', 'あ ら', 'あ あ', 'あ', 'か']);

describe('AliasIndex', () => {
	it('reads prefix.map pitch names and lines', () => {
		expect(parsePitchName('C4')).toBe(60);
		expect(parsePitchName('A#3')).toBe(58);
		expect(parsePitchName('Db4')).toBe(61);
		expect(parsePitchName('62')).toBe(62);
		const m = parsePrefixMap('C4=\t_C4\nC5=up \t\nbad\nD5=_D5');
		expect(m.get(60)).toEqual({ prefix: '', suffix: '_C4' });
		expect(m.get(72)).toEqual({ prefix: 'up ', suffix: '' });
		expect(m.get(74)).toEqual({ prefix: '', suffix: '_D5' });
	});

	it('finds aliases case-insensitively, with the pitch affix the way the engine applies it', () => {
		const idx = new AliasIndex(['ka', 'ka_C5', 'KI'], 'C5=\t_C5');
		expect(idx.find('ki')).toBe('KI');
		expect(idx.find('ka', 60)).toBe('ka');
		expect(idx.find('ka', 72)).toBe('ka_C5');
		expect(idx.find('zzz')).toBeNull();
	});

	it('detects VCV banks and splits leads from syllables', () => {
		expect(VCV.style).toBe('vcv');
		expect(ROMAJI.style).toBe('plain');
		const e = VCV.entries.find((x) => x.alias === 'あ ら')!;
		expect(e).toMatchObject({ lead: 'a', core: 'ら', key: 'ra' });
		expect(VCV.entries.find((x) => x.alias === '- か')!.lead).toBe('-');
	});

	it('strips prefix.map affixes into the base alias', () => {
		const idx = new AliasIndex(['ka_C4', 'ka_C5'], 'C4=\t_C4\nC5=\t_C5');
		expect(idx.entries.map((e) => e.base)).toEqual(['ka', 'ka']);
	});
});

describe('resolveLyric', () => {
	const r = registry();

	it('keeps lyrics the voicebank has', () => {
		expect(resolveLyric('ka', ctx(ROMAJI), r)).toMatchObject({ status: 'exact', alias: 'ka' });
		expect(resolveLyric('KA', ctx(ROMAJI), r)).toMatchObject({ status: 'exact' });
	});

	it('bridges kana and romaji both ways', () => {
		expect(resolveLyric('か', ctx(ROMAJI), r)).toMatchObject({ status: 'mapped', alias: 'ka' });
		expect(resolveLyric('ra', ctx(KANA), r)).toMatchObject({ status: 'mapped', alias: 'ラ' });
		expect(resolveLyric('ka', ctx(KANA), r)).toMatchObject({ status: 'mapped', alias: 'か' });
		expect(resolveLyric('キャ', ctx(ROMAJI), r)).toMatchObject({ status: 'mapped', alias: 'kya' });
		expect(resolveLyric('si', ctx(ROMAJI), r)).toMatchObject({ status: 'mapped', alias: 'shi' });
		expect(resolveLyric('し', ctx(ROMAJI), r)).toMatchObject({ alias: 'shi' });
	});

	it('understands rests, continuations and hints', () => {
		expect(resolveLyric('R', ctx(ROMAJI), r).status).toBe('rest');
		expect(resolveLyric('+', ctx(ROMAJI), r).status).toBe('missing');
		expect(
			resolveLyric('+', ctx(ROMAJI, 60, { alias: 'ka', key: 'ka', vowel: 'a' }), r)
		).toMatchObject({ status: 'mapped', alias: 'ka' });
		expect(resolveLyric('xyz[mi]', ctx(ROMAJI), r)).toMatchObject({ status: 'exact', alias: 'mi' });
		expect(resolveLyric('[ka]', ctx(KANA), r)).toMatchObject({ status: 'mapped', alias: 'か' });
	});

	it('picks the VCV alias that starts with the previous vowel, or "-" at a phrase start', () => {
		expect(resolveLyric('ra', ctx(VCV), r)).toMatchObject({ alias: '- ら' });
		expect(
			resolveLyric('ra', ctx(VCV, 60, { alias: '- あ', key: 'a', vowel: 'a' }), r)
		).toMatchObject({ alias: 'あ ら' });
		// A bare syllable exists in this bank, but the VCV alias is preferred after a vowel.
		expect(
			resolveLyric('か', ctx(VCV, 60, { alias: '- あ', key: 'a', vowel: 'a' }), r)
		).toMatchObject({ alias: 'あ か' });
		expect(resolveLyric('- ら', ctx(VCV), r)).toMatchObject({ status: 'exact', alias: '- ら' });
	});

	it('never applies near misses, but offers them', () => {
		const miss = resolveLyric('kyo', ctx(ROMAJI), r);
		expect(miss.status).toBe('missing');
		expect(miss.status === 'missing' && miss.suggestions.map((s) => s.alias)).toContain('kya');
	});

	it('does not break when plugins are switched off', () => {
		const off = registry();
		off.setDisabled(['ja.script-bridge']);
		expect(resolveLyric('ka', ctx(ROMAJI), off).status).toBe('exact');
		expect(resolveLyric('か', ctx(ROMAJI), off).status).toBe('missing');
	});

	it('survives a plugin that throws', () => {
		const bad: Plugin = {
			id: 'x.bad',
			name: 'Bad',
			description: '',
			candidates: () => {
				throw new Error('boom');
			}
		};
		const reg = registry().register(bad);
		expect(resolveLyric('か', ctx(ROMAJI), reg)).toMatchObject({ alias: 'ka' });
	});

	it('applies the pitch affix of prefix.map when resolving', () => {
		const idx = new AliasIndex(['ka_C5', 'ka_C4', 'ki_C4'], 'C4=\t_C4\nC5=\t_C5');
		expect(resolveLyric('か', ctx(idx, 72), r)).toMatchObject({ status: 'mapped', alias: 'ka' });
		expect(idx.find('ka', 72)).toBe('ka_C5');
	});
});

describe('suggestions', () => {
	const r = registry();
	const suggest = (q: string, index = KANA) => r.suggest(q, { index, pitch: 60, limit: 20 });

	it('finds kana for romaji and the other way round', () => {
		expect(suggest('ra').map((s) => s.alias)).toContain('ラ');
		expect(suggest('か', ROMAJI).map((s) => s.alias)).toContain('ka');
		expect(suggest('k', KANA).map((s) => s.alias)).toEqual(
			expect.arrayContaining(['か', 'き', 'きゃ'])
		);
	});

	it('shows the reading of an alias', () => {
		expect(suggest('ra').find((s) => s.alias === 'ラ')?.hint).toBe('ra');
		expect(suggest('ka', ROMAJI).find((s) => s.alias === 'ka')?.hint).toBe('か');
	});

	it('ranks exact spelling first and lists everything for an empty query', () => {
		expect(suggest('ka', ROMAJI)[0].alias).toBe('ka');
		expect(suggest('', ROMAJI).length).toBeGreaterThan(5);
	});
});

describe('NoteResolver', () => {
	const r = registry();
	const resolver = new NoteResolver(r);
	const note = (tick: number, lyric: string, pitch = 60, track = 't') =>
		createNote({ tick, length: 480, pitch, lyric, track });

	it('gives each note the sound of the one before it', () => {
		const notes = [note(0, 'あ'), note(480, 'ra'), note(960, 'か'), note(5000, 'ra')];
		const out = resolver.resolveAll(notes, VCV);
		expect(out.get(notes[0].id)).toMatchObject({ alias: '- あ' });
		expect(out.get(notes[1].id)).toMatchObject({ alias: 'あ ら' });
		expect(out.get(notes[2].id)).toMatchObject({ alias: 'あ か' }); // after ら the vowel is a
		expect(out.get(notes[3].id)).toMatchObject({ alias: '- ら' }); // far away: a new phrase
	});

	it('keeps tracks apart and follows plugin changes', () => {
		const a = note(0, 'あ', 60, 'one');
		const b = note(480, 'ra', 60, 'two');
		expect(resolver.resolveAll([a, b], VCV).get(b.id)).toMatchObject({ alias: '- ら' });
		r.setDisabled(['ja.script-bridge']);
		expect(resolver.resolveAll([a, b], VCV).get(b.id)?.status).toBe('missing');
		r.setDisabled([]);
	});
});
