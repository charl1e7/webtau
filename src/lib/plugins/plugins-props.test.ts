import { describe, expect, it, vi } from 'vitest';
import { forSeeds } from '../testing/rng';
import { createNote } from '#lib/core/music';
import type { Note } from '#lib/core/types';
import {
	AliasIndex,
	editDistance,
	lastVowel,
	parsePitchName,
	parsePrefixMap
} from '#lib/voicebank/alias-index';
import { BUILTIN_PLUGINS } from './builtin';
import { NoteResolver } from './resolve-notes';
import { PluginRegistry, continuity, resolveLyric } from './registry';
import type { Plugin, PluginHost, Resolution } from './api';

const registry = () => {
	const r = new PluginRegistry();
	BUILTIN_PLUGINS.forEach((p) => r.register(p));
	return r;
};

/** The textbook edit distance, for comparison. */
function levenshtein(a: string, b: string): number {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++)
			d[i][j] = Math.min(
				d[i - 1][j] + 1,
				d[i][j - 1] + 1,
				d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
	return d[a.length][b.length];
}

describe('alias index helpers', () => {
	it('editDistance agrees with the textbook one up to its limit', () => {
		forSeeds(400, (r) => {
			const word = () => Array.from({ length: r.int(0, 6) }, () => r.pick([...'abkrs'])).join('');
			const a = word();
			const b = word();
			const limit = r.int(0, 4);
			const real = levenshtein(a, b);
			const got = editDistance(a, b, limit);
			if (real <= limit) expect(got, `${a}/${b}`).toBe(real);
			else expect(got, `${a}/${b}`).toBeGreaterThan(limit);
		});
	});

	it('pitch names in every spelling', () => {
		expect(parsePitchName('C-1')).toBe(0);
		expect(parsePitchName('c4')).toBe(60);
		expect(parsePitchName('B4')).toBe(71);
		expect(parsePitchName('bb4')).toBe(70);
		expect(parsePitchName('F#2')).toBe(42);
		expect(parsePitchName(' 60 ')).toBe(60);
		expect(parsePitchName('H4')).toBeNull();
		expect(parsePitchName('')).toBeNull();
		expect(parsePitchName('C')).toBeNull();
	});

	it('prefix.map: tab separates prefix and suffix, junk lines are ignored, last line wins', () => {
		const m = parsePrefixMap('C4=pre\tsuf\r\nC4=\t_x\n=nothing\nnope\nZ9=a\n');
		expect(m.size).toBe(1);
		expect(m.get(60)).toEqual({ prefix: '', suffix: '_x' });
		expect(parsePrefixMap('').size).toBe(0);
	});

	it('the last vowel of a key', () => {
		expect(lastVowel('ra')).toBe('a');
		expect(lastVowel('si')).toBe('i');
		expect(lastVowel('n')).toBe('n');
		expect(lastVowel('kyu')).toBe('u');
		expect(lastVowel('')).toBeNull();
		expect(lastVowel('r')).toBeNull();
		expect(lastVowel('-')).toBeNull();
	});

	it('affixAt picks the nearest line at or below the pitch, none below the first', () => {
		const idx = new AliasIndex(['a'], 'C4=\t_C4\nC5=\t_C5\nC3=\t_C3');
		expect(idx.affixAt(47)).toBeNull();
		expect(idx.affixAt(48)).toEqual({ prefix: '', suffix: '_C3' });
		expect(idx.affixAt(59)).toEqual({ prefix: '', suffix: '_C3' });
		expect(idx.affixAt(60)).toEqual({ prefix: '', suffix: '_C4' });
		expect(idx.affixAt(200)).toEqual({ prefix: '', suffix: '_C5' });
	});

	it('VCV detection needs a fifth of the aliases, and handles odd aliases without throwing', () => {
		const plain = Array.from({ length: 8 }, (_, i) => `x${i}`);
		expect(new AliasIndex([...plain, 'a ka', 'a ki']).style).toBe('vcv'); // 2 of 10
		expect(new AliasIndex([...plain, 'a ka']).style).toBe('plain'); // 1 of 9
		for (const odd of [
			'',
			' ',
			'  ',
			'\t',
			'a  b',
			'- ',
			' -',
			'あ　か',
			'1 2',
			'ab cd ef',
			'-'.repeat(300)
		])
			expect(() => new AliasIndex([odd, 'a ka', 'o ra']), JSON.stringify(odd)).not.toThrow();
		expect(new AliasIndex([]).style).toBe('plain');
		expect(new AliasIndex([]).find('a')).toBeNull();
	});

	it('nearest never returns the exact key and sorts by distance then length', () => {
		const idx = new AliasIndex(['ka', 'ke', 'kyo', 'kyou', 'sa', 'ki']);
		const hits = idx.nearest('kyo', 1).map((h) => h.entry.alias);
		expect(hits).not.toContain('kyo');
		expect(hits).toContain('kyou');
		expect(idx.nearest('ku', 1).map((h) => h.entry.alias)).toEqual(['ka', 'ke', 'ki']);
		const sorted = idx.nearest('kyo', 2);
		for (let i = 1; i < sorted.length; i++)
			expect(sorted[i].distance).toBeGreaterThanOrEqual(sorted[i - 1].distance);
	});

	it('aliases that differ only by case collapse in lookup but stay listed', () => {
		const idx = new AliasIndex(['Ka', 'ka']);
		expect(idx.aliases).toEqual(['Ka', 'ka']);
		expect(idx.has('KA')).toBe(true);
		expect(['Ka', 'ka']).toContain(idx.find('kA'));
	});
});

// ---- resolving ------------------------------------------------------------------------------

const KANA_ROW = [
	...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
];
const ROMAJI_ROW = [
	'a',
	'i',
	'u',
	'e',
	'o',
	'ka',
	'ki',
	'ku',
	'ke',
	'ko',
	'sa',
	'shi',
	'su',
	'se',
	'so',
	'ta',
	'chi',
	'tsu',
	'te',
	'to',
	'na',
	'ni',
	'nu',
	'ne',
	'no',
	'ha',
	'hi',
	'fu',
	'he',
	'ho',
	'ma',
	'mi',
	'mu',
	'me',
	'mo',
	'ya',
	'yu',
	'yo',
	'ra',
	'ri',
	'ru',
	're',
	'ro',
	'wa',
	'wo',
	'n'
];
const VCV_ALIASES = [
	...KANA_ROW.map((k) => `- ${k}`),
	...['a', 'i', 'u', 'e', 'o', 'n'].flatMap((v) => KANA_ROW.map((k) => `${v} ${k}`))
];

function resolveWith(
	index: AliasIndex,
	lyric: string,
	pitch = 60,
	prev: Parameters<typeof resolveLyric>[1]['prev'] = null
) {
	return resolveLyric(lyric, { index, pitch, prev }, registry());
}

describe('resolving lyrics, in bulk', () => {
	it('every kana syllable finds its romaji alias and the other way round', () => {
		const romaji = new AliasIndex(ROMAJI_ROW);
		const kana = new AliasIndex(KANA_ROW);
		for (let i = 0; i < KANA_ROW.length; i++) {
			expect(resolveWith(romaji, KANA_ROW[i]), KANA_ROW[i]).toMatchObject({ alias: ROMAJI_ROW[i] });
			expect(resolveWith(kana, ROMAJI_ROW[i]), ROMAJI_ROW[i]).toMatchObject({ alias: KANA_ROW[i] });
		}
	});

	it('katakana lyrics reach hiragana aliases', () => {
		const kana = new AliasIndex(KANA_ROW);
		for (const k of 'アイウカキサシタナハマヤラワ')
			expect(resolveWith(kana, k).status).not.toBe('missing');
	});

	it('whatever is resolved to exists in the voicebank, for any lyric and any bank', () => {
		const banks = [
			new AliasIndex(ROMAJI_ROW),
			new AliasIndex(KANA_ROW),
			new AliasIndex(VCV_ALIASES),
			new AliasIndex(['ka_C4', 'ka_C5'], 'C4=\t_C4\nC5=\t_C5')
		];
		const lyrics = [
			...KANA_ROW,
			...ROMAJI_ROW,
			'R',
			'+',
			'+~',
			'...',
			'ka[x]',
			'[ka]',
			'',
			' ',
			'hello',
			'a ra',
			'- ra',
			'あ ら',
			'[]',
			'ka[',
			'漢字',
			'ー',
			'っ',
			'nn'
		];
		forSeeds(200, (r) => {
			const index = r.pick(banks);
			const lyric = r.pick(lyrics);
			const pitch = r.int(40, 90);
			const prevAlias = r.pick(VCV_ALIASES);
			const res = resolveWith(
				index,
				lyric,
				pitch,
				r.bool()
					? { alias: prevAlias, key: 'a', vowel: r.pick(['a', 'i', 'u', 'e', 'o', 'n', null]) }
					: null
			);
			// A continuation repeats the previous alias, which is the caller's to have checked.
			if (
				(res.status === 'exact' || res.status === 'mapped') &&
				!/^(\+[~*]?|\.\.\.|…)$/.test(lyric.trim())
			) {
				expect(
					index.has(res.alias, pitch) || res.alias === 'R',
					`${JSON.stringify(lyric)} → ${res.alias}`
				).toBe(true);
			}
			if (res.status === 'missing')
				for (const s of res.suggestions) expect(index.has(s.alias, pitch)).toBe(true);
		});
	});

	it('in a VCV bank, after any vowel the alias starts with that vowel when it exists', () => {
		const idx = new AliasIndex(VCV_ALIASES);
		for (const v of ['a', 'i', 'u', 'e', 'o']) {
			const res = resolveWith(idx, 'か', 60, { alias: `- ${v}`, key: v, vowel: v });
			const lead = (VCV_ALIASES.find((a) => a === (res as Resolution).alias) ?? '').split(' ')[0];
			expect(lead, v).toBe(v);
		}
	});

	it('a lyric typed with an explicit lead keeps that lead', () => {
		const idx = new AliasIndex(VCV_ALIASES);
		expect(resolveWith(idx, 'i か', 60, { alias: '- あ', key: 'a', vowel: 'a' })).toMatchObject({
			alias: 'i か'
		});
		expect(resolveWith(idx, 'u か')).toMatchObject({ alias: 'u か' });
	});

	it('after a note that ends in n, the lead is n', () => {
		const idx = new AliasIndex(VCV_ALIASES);
		expect(
			resolveWith(idx, 'か', 60, continuity({ status: 'exact', alias: '- ん' }))
		).toMatchObject({ alias: 'n か' });
	});

	it('continuity: rests, missing and empty give nothing; leads are stripped from the key', () => {
		expect(continuity({ status: 'rest', alias: 'R' })).toBeNull();
		expect(continuity({ status: 'missing', alias: 'x', suggestions: [] })).toBeNull();
		expect(continuity({ status: 'exact', alias: '' })).toBeNull();
		expect(continuity({ status: 'exact', alias: 'a ら' })).toEqual({
			alias: 'a ら',
			key: 'ra',
			vowel: 'a'
		});
		expect(continuity({ status: 'exact', alias: '- し' })).toEqual({
			alias: '- し',
			key: 'si',
			vowel: 'i'
		});
		expect(continuity({ status: 'exact', alias: 'u r' })).toMatchObject({ vowel: null });
	});
});

describe('NoteResolver, in bulk', () => {
	const mk = (tick: number, lyric: string, track = 't', pitch = 60, length = 480): Note =>
		createNote({ tick, length, pitch, lyric, track });
	const idx = new AliasIndex(VCV_ALIASES);

	it('adjacency threshold: a gap of 60 ticks still connects, 61 starts a phrase', () => {
		const resolver = new NoteResolver(registry());
		const a = mk(0, 'あ');
		const near = mk(480 + 60, 'か');
		const far = mk(480 + 61, 'か', 'u');
		const out = resolver.resolveAll([a, near], idx);
		expect(out.get(near.id)).toMatchObject({ alias: 'a か' });
		const out2 = resolver.resolveAll([mk(0, 'あ', 'u'), far], idx);
		expect(out2.get(far.id)).toMatchObject({ alias: '- か' });
	});

	it('a rest breaks the chain, and “+” carries the previous sound across several notes', () => {
		const resolver = new NoteResolver(registry());
		const notes = [
			mk(0, 'あ'),
			mk(480, '+'),
			mk(960, '+~'),
			mk(1440, 'か'),
			mk(1920, 'R'),
			mk(2400, 'か')
		];
		const out = resolver.resolveAll(notes, idx);
		expect(out.get(notes[1].id)).toMatchObject({ alias: '- あ' });
		expect(out.get(notes[2].id)).toMatchObject({ alias: '- あ' });
		expect(out.get(notes[3].id)).toMatchObject({ alias: 'a か' });
		expect(out.get(notes[4].id)?.status).toBe('rest');
		expect(out.get(notes[5].id)).toMatchObject({ alias: '- か' });
	});

	it('does not depend on the order the notes come in, and does not reorder its input', () => {
		forSeeds(60, (r) => {
			const notes = Array.from({ length: r.int(1, 12) }, (_, i) =>
				mk(i * 480, r.pick(['あ', 'か', 'ra', '+', 'R', 'し']), r.pick(['a', 'b']))
			);
			const shuffled = [...notes].sort(() => r.next() - 0.5);
			const copy = shuffled.map((n) => n.id);
			const one = new NoteResolver(registry()).resolveAll(notes, idx);
			const two = new NoteResolver(registry()).resolveAll(shuffled, idx);
			for (const n of notes) expect(two.get(n.id), n.lyric).toEqual(one.get(n.id));
			expect(shuffled.map((n) => n.id)).toEqual(copy);
		});
	});

	it('the cache never serves a result for another voicebank', () => {
		const resolver = new NoteResolver(registry());
		const n = mk(0, 'か');
		const a = resolver.resolveAll([n], new AliasIndex(['か']));
		const b = resolver.resolveAll([n], new AliasIndex(['ka']));
		expect(a.get(n.id)).toMatchObject({ alias: 'か' });
		expect(b.get(n.id)).toMatchObject({ alias: 'ka' });
	});

	it('pitch decides the alias through prefix.map', () => {
		const resolver = new NoteResolver(registry());
		const bank = new AliasIndex(['ka_C4', 'ka_C5'], 'C4=\t_C4\nC5=\t_C5');
		const lo = mk(0, 'か', 't', 60);
		const hi = mk(480, 'か', 't', 72);
		const out = resolver.resolveAll([lo, hi], bank);
		expect(out.get(lo.id)).toMatchObject({ status: 'mapped' });
		expect(bank.find(out.get(lo.id)!.alias, 60)).toBe('ka_C4');
		expect(bank.find(out.get(hi.id)!.alias, 72)).toBe('ka_C5');
	});

	it('handles thousands of notes quickly', () => {
		const resolver = new NoteResolver(registry());
		const notes = Array.from({ length: 5000 }, (_, i) =>
			mk(i * 480, KANA_ROW[i % KANA_ROW.length])
		);
		const t0 = performance.now();
		const out = resolver.resolveAll(notes, idx);
		expect(out.size).toBe(5000);
		expect(performance.now() - t0).toBeLessThan(1500);
	});
});

// ---- the registry itself ----------------------------------------------------------------------

describe('PluginRegistry', () => {
	const make = (id: string, extra: Partial<Plugin> = {}): Plugin => ({
		id,
		name: id,
		description: '',
		...extra
	});

	it('orders plugins by priority, then name, and bumps its version on every change', () => {
		const r = new PluginRegistry();
		const v0 = r.version;
		r.register(make('b', { priority: 1 }))
			.register(make('a', { priority: 1 }))
			.register(make('z', { priority: -5 }));
		expect(r.all().map((p) => p.id)).toEqual(['z', 'a', 'b']);
		expect(r.version).toBeGreaterThan(v0);
		const v1 = r.version;
		r.unregister('nope');
		expect(r.version).toBe(v1);
		r.unregister('a');
		expect(r.version).toBeGreaterThan(v1);
		r.setDisabled(['z']);
		expect(r.active().map((p) => p.id)).toEqual(['b']);
	});

	it('candidates: best score first, ties by plugin order, a failing plugin does not stop the others', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = new PluginRegistry()
			.register(
				make('first', {
					priority: 0,
					candidates: () => [
						{ alias: 'x', score: 0.5, why: '' },
						{ alias: 'y', score: 0.9, why: '' }
					]
				})
			)
			.register(
				make('boom', {
					priority: 1,
					candidates: () => {
						throw new Error('no');
					}
				})
			)
			.register(
				make('second', { priority: 2, candidates: () => [{ alias: 'z', score: 0.5, why: '' }] })
			);
		const out = r.candidates('q', { index: new AliasIndex([]), pitch: 60, prev: null });
		expect(out.map((c) => c.alias)).toEqual(['y', 'x', 'z']);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('suggest merges duplicates (best rank, first hint), sorts and limits', () => {
		const r = new PluginRegistry()
			.register(
				make('a', {
					suggest: () => [
						{ alias: 'ka', rank: 2 },
						{ alias: 'kb', rank: 1, hint: 'B' }
					]
				})
			)
			.register(
				make('b', {
					priority: 1,
					suggest: () => [
						{ alias: 'ka', rank: 0, hint: 'か' },
						{ alias: 'kb', rank: 5, hint: 'other' },
						{ alias: 'kcc', rank: 1 }
					]
				})
			);
		const out = r.suggest('k', { index: new AliasIndex([]), pitch: 60, limit: 3 });
		expect(out.map((s) => [s.alias, s.rank, s.hint])).toEqual([
			['ka', 0, 'か'],
			['kb', 1, 'B'],
			['kcc', 1, undefined]
		]);
		expect(r.suggest('k', { index: new AliasIndex([]), pitch: 60, limit: 1 })).toHaveLength(1);
	});

	it('commands of switched-off plugins disappear', () => {
		const r = registry();
		const all = r.commands().map((c) => c.id);
		expect(all).toContain('lyrics.hiragana');
		r.setDisabled(['core.lyric-tools']);
		expect(r.commands()).toEqual([]);
	});
});

// ---- the commands -----------------------------------------------------------------------------

describe('lyric commands', () => {
	const host = (
		notes: Note[],
		resolve: PluginHost['resolve'] = () => null,
		index: AliasIndex | null = null
	) => {
		const calls = {
			changes: [] as ReadonlyMap<string, string>[],
			toasts: [] as string[],
			doctor: 0
		};
		const h: PluginHost = {
			notes,
			targets: notes,
			index,
			resolve,
			setLyrics: (c) => calls.changes.push(c),
			toast: (m) => calls.toasts.push(m),
			openLyricDoctor: () => calls.doctor++
		};
		return { h, calls };
	};
	const run = (id: string, h: PluginHost) =>
		registry()
			.commands()
			.find((c) => c.id === id)!
			.run(h);
	const n = (lyric: string) => createNote({ tick: 0, pitch: 60, lyric });

	it('hiragana / katakana / romaji convert what they can and leave the rest alone', () => {
		const notes = [n('ka'), n('ラ'), n('hello'), n('R'), n('+'), n('shi'), n('')];
		const { h, calls } = host(notes);
		run('lyrics.hiragana', h);
		const got = Object.fromEntries(
			[...calls.changes[0]].map(([id, v]) => [notes.findIndex((x) => x.id === id), v])
		);
		expect(got).toEqual({ 0: 'か', 1: 'ら', 5: 'し' });
		const k = host(notes);
		run('lyrics.katakana', k.h);
		// 'ラ' is katakana already: left alone.
		expect([...k.calls.changes[0].values()].sort()).toEqual(['カ', 'シ'].sort());
		const r = host([n('か'), n('ra'), n('キャ')]);
		run('lyrics.romaji', r.h);
		expect([...r.calls.changes[0].values()]).toEqual(['ka', 'kya']);
	});

	it('nothing to convert says so instead of creating an empty undo step', () => {
		const { h, calls } = host([n('hello'), n('R')]);
		run('lyrics.hiragana', h);
		expect(calls.changes).toEqual([]);
		expect(calls.toasts[0]).toMatch(/Nothing/);
	});

	it('rewrite only touches lyrics that were mapped to something else', () => {
		const notes = [n('か'), n('ka'), n('R'), n('xyz')];
		const res: Resolution[] = [
			{ status: 'mapped', alias: 'ka' },
			{ status: 'exact', alias: 'ka' },
			{ status: 'rest', alias: 'R' },
			{ status: 'missing', alias: 'xyz', suggestions: [] }
		];
		const { h, calls } = host(notes, (note) => res[notes.indexOf(note)] ?? null);
		run('lyrics.rewrite', h);
		expect([...calls.changes[0]]).toEqual([[notes[0].id, 'ka']]);
	});

	it('fix opens the doctor, and the commands that need a voicebank are disabled without one', () => {
		const { h, calls } = host([n('a')]);
		run('lyrics.fix', h);
		expect(calls.doctor).toBe(1);
		const cmds = registry().commands();
		expect(cmds.find((c) => c.id === 'lyrics.fix')!.enabled!(h)).toBe(false);
		expect(
			cmds.find((c) => c.id === 'lyrics.rewrite')!.enabled!({ ...h, index: new AliasIndex(['a']) })
		).toBe(true);
	});
});
