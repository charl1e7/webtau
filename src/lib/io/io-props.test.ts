import { describe, expect, it } from 'vitest';
import { forSeeds, type Rng } from '../testing/rng';
import { createNote, createPitchPoint, createTrack } from '#lib/core/music';
import { PPQ, type Note, type PitchShape, type TempoChange } from '#lib/core/types';
import { parseUst, serializeUst } from './ust';
import { parseMidi, serializeMidi } from './midi';
import { parseProject, serializeProject } from './project-file';
import { parseUstx, serializeUstx } from './ustx';
import { parseVsqx } from './vsqx';
import { decodeText, encodeText } from './text';
import { encodeWav } from './wav';

const LYRICS = ['a', 'ka', 'しゃ', 'ら', 'u r', '- し', 'o -', 'ちゅ', 'ra', 'R', '+', 'あ[a]'];
const SHAPES: PitchShape[] = ['l', 's', 'r', 'j'];

/** A monophonic line with gaps, as UST can hold it. */
function randomLine(r: Rng, trackId?: string): Note[] {
	const out: Note[] = [];
	let tick = r.pick([0, 0, 120, 480]);
	for (let i = 0; i < r.int(1, 14); i++) {
		const length = r.int(30, 1500);
		out.push(
			createNote({
				...(trackId ? { track: trackId } : {}),
				tick,
				length,
				pitch: r.int(36, 90),
				lyric: r.pick(LYRICS),
				velocity: r.pick([100, 100, 60, 150]),
				volume: r.pick([100, 100, 70]),
				modulation: r.pick([0, 0, 20]),
				flags: r.pick(['', '', 'g-5', 'B30Y10']),
				pitchPoints: r.bool(0.4)
					? Array.from({ length: r.int(1, 4) }, (_, k) =>
							createPitchPoint(-30 + k * r.int(20, 120), r.int(-30, 30) * 10, r.pick(SHAPES))
						)
					: [],
				vibrato: r.bool(0.3)
					? {
							length: r.int(10, 100),
							period: r.int(100, 300),
							depth: r.int(5, 80),
							fadeIn: 10,
							fadeOut: 10,
							phase: 0
						}
					: null
			})
		);
		tick += length + r.pick([0, 0, 0, 60, 480]);
	}
	return out;
}

const key = (n: Note) => [n.tick, n.length, n.pitch, n.lyric, n.flags];

describe('UST: random lines survive a round trip', () => {
	it('notes, lyrics, flags, pitch points and vibrato come back', () => {
		forSeeds(120, (r) => {
			const notes = randomLine(r);
			const { text } = serializeUst(notes, [{ tick: 0, bpm: 133 }], { name: 'P', voicebank: 'V' });
			const back = parseUst(text);
			expect(back.tempos[0].bpm).toBeCloseTo(133, 1);
			// Gaps come back as rests; compare the notes that are not rests we invented.
			const real = back.notes.filter(
				(n) => !(n.lyric === 'R' && !notes.some((o) => o.tick === n.tick && o.lyric === 'R'))
			);
			expect(real.map(key)).toEqual(notes.map(key));
			notes.forEach((o, i) => {
				if (o.lyric === 'R') return;
				const b = real[i];
				expect(b.velocity).toBe(o.velocity);
				expect(b.volume).toBe(o.volume);
				expect(b.pitchPoints.map((p) => [p.x, p.y, p.shape])).toEqual(
					[...o.pitchPoints].sort((p, q) => p.x - q.x).map((p) => [p.x, p.y, p.shape])
				);
				expect(b.vibrato).toEqual(o.vibrato);
			});
		});
	});

	it('tempo changes at note starts are kept', () => {
		const notes = [0, 480, 960, 1440].map((tick) => createNote({ tick, length: 480, pitch: 60 }));
		const tempos: TempoChange[] = [
			{ tick: 0, bpm: 120 },
			{ tick: 960, bpm: 90 }
		];
		const back = parseUst(serializeUst(notes, tempos, { name: 'T', voicebank: '' }).text);
		expect(back.tempos).toEqual([
			{ tick: 0, bpm: 120 },
			{ tick: 960, bpm: 90 }
		]);
	});

	it('overlapping notes are trimmed with a warning, never lost', () => {
		const a = createNote({ tick: 0, length: 960, pitch: 60 });
		const b = createNote({ tick: 480, length: 480, pitch: 62 });
		const { text, warnings } = serializeUst([a, b], [{ tick: 0, bpm: 120 }], {
			name: '',
			voicebank: ''
		});
		expect(warnings.length).toBe(1);
		const back = parseUst(text).notes;
		expect(back.map((n) => [n.tick, n.length])).toEqual([
			[0, 480],
			[480, 480]
		]);
	});

	it('no notes at all gives a warning instead of a crash', () => {
		expect(parseUst('[#SETTING]\nTempo=120').warnings.length).toBe(1);
		expect(parseUst('').notes).toEqual([]);
		expect(() =>
			serializeUst([], [{ tick: 0, bpm: 120 }], { name: '', voicebank: '' })
		).not.toThrow();
	});

	it('survives junk: random lines, comma decimals, missing values, CRLF and a BOM', () => {
		forSeeds(200, (r) => {
			const lines: string[] = r.bool() ? ['﻿[#VERSION]'] : [];
			for (let i = 0; i < r.int(1, 20); i++) {
				lines.push(
					r.pick([
						'[#0000]',
						'[#0001]',
						'[#SETTING]',
						'[#TRACKEND]',
						'Length=480',
						'Length=abc',
						'Length=',
						'Length=1,5',
						'Lyric=あ',
						'Lyric=',
						'NoteNum=60',
						'NoteNum=x',
						'Tempo=0',
						'Tempo=-5',
						'Tempo=140,5',
						'PBS=-30;0',
						'PBS=;',
						'PBW=10,20',
						'PBY=1,x',
						'PBM=,s,r',
						'VBR=1,2',
						'VBR=65,180,35,20,20,0,0,0',
						'Flags=',
						'===',
						'garbage',
						''
					])
				);
			}
			const out = parseUst(lines.join(r.pick(['\n', '\r\n'])));
			for (const n of out.notes) {
				expect(
					Number.isFinite(n.tick) && Number.isFinite(n.length) && Number.isFinite(n.pitch)
				).toBe(true);
				expect(n.length).toBeGreaterThanOrEqual(1);
				for (const p of n.pitchPoints)
					expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
			}
			for (const t of out.tempos) expect(t.bpm).toBeGreaterThan(0);
		});
	});
});

describe('MIDI', () => {
	it('random notes and lyrics round-trip, in several tracks', () => {
		forSeeds(80, (r) => {
			const a = randomLine(r).map((n) => ({ ...n, lyric: r.pick(['a', 'ka', 'ら']) }));
			const b = randomLine(r).map((n) => ({ ...n, lyric: 'x' }));
			const tempos = [{ tick: 0, bpm: r.int(60, 200) }];
			const file = parseMidi(
				serializeMidi(
					[
						{ name: 'A', notes: a },
						{ name: 'B', notes: b }
					],
					tempos,
					'Song'
				)
			);
			const named = file.tracks.filter((t) => t.noteCount > 0);
			expect(named.map((t) => t.name)).toEqual(['A', 'B']);
			expect(named[0].notes.map(key)).toEqual(
				a.map((n) => [n.tick, n.length, n.pitch, n.lyric, ''])
			);
			expect(file.tempos[0].bpm).toBeCloseTo(tempos[0].bpm, 1);
		});
	});

	it('a note that is never switched off ends with its track instead of vanishing', () => {
		// MThd, one track: lyric-less note-on at 0, end of track at 480.
		const bytes = Uint8Array.from([
			0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0,
			12, 0, 0x90, 60, 100, 0x83, 0x60, 0xff, 0x2f, 0
		]);
		const file = parseMidi(bytes);
		expect(file.tracks[0].notes).toHaveLength(1);
		expect(file.tracks[0].notes[0].length).toBeGreaterThan(0);
	});

	it('the same key struck twice before it is released keeps both notes', () => {
		const ev = (delta: number, ...b: number[]) => [delta, ...b];
		const body = [
			...ev(0, 0x90, 60, 100),
			...ev(60, 0x90, 60, 100),
			...ev(60, 0x80, 60, 0),
			...ev(60, 0x80, 60, 0),
			...ev(0, 0xff, 0x2f, 0)
		];
		const bytes = Uint8Array.from([
			0x4d,
			0x54,
			0x68,
			0x64,
			0,
			0,
			0,
			6,
			0,
			0,
			0,
			1,
			0x01,
			0xe0,
			0x4d,
			0x54,
			0x72,
			0x6b,
			0,
			0,
			0,
			body.length,
			...body
		]);
		expect(parseMidi(bytes).tracks[0].notes.length).toBe(2);
	});

	it('a zero tempo does not poison the file', () => {
		const body = [0, 0xff, 0x51, 3, 0, 0, 0, 0, 0xff, 0x2f, 0];
		const bytes = Uint8Array.from([
			0x4d,
			0x54,
			0x68,
			0x64,
			0,
			0,
			0,
			6,
			0,
			0,
			0,
			1,
			0x01,
			0xe0,
			0x4d,
			0x54,
			0x72,
			0x6b,
			0,
			0,
			0,
			body.length,
			...body
		]);
		for (const t of parseMidi(bytes).tempos) expect(Number.isFinite(t.bpm) && t.bpm > 0).toBe(true);
	});

	it('truncated and random files either parse or throw a real Error, quickly', () => {
		const good = serializeMidi(
			[{ name: 'A', notes: [createNote({ tick: 0, length: 480, pitch: 60 })] }],
			[{ tick: 0, bpm: 120 }],
			'S'
		);
		forSeeds(300, (r) => {
			const cut = good.slice(0, r.int(0, good.length));
			try {
				parseMidi(cut);
			} catch (e) {
				expect(e).toBeInstanceOf(Error);
			}
			const noise = Uint8Array.from({ length: r.int(0, 80) }, () => r.int(0, 255));
			try {
				parseMidi(noise);
			} catch (e) {
				expect(e).toBeInstanceOf(Error);
			}
		});
	});

	it('other time divisions are scaled to our resolution', () => {
		const body = [0, 0x90, 60, 100, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
		const bytes = Uint8Array.from([
			0x4d,
			0x54,
			0x68,
			0x64,
			0,
			0,
			0,
			6,
			0,
			0,
			0,
			1,
			0,
			96,
			0x4d,
			0x54,
			0x72,
			0x6b,
			0,
			0,
			0,
			body.length,
			...body
		]);
		expect(parseMidi(bytes).tracks[0].notes[0].length).toBe(PPQ); // 96 ticks of a 96-division file
	});
});

describe('project file', () => {
	it('random projects round-trip exactly (ids aside)', () => {
		forSeeds(80, (r) => {
			const t1 = createTrack(0, {
				volume: r.int(0, 150),
				mute: r.bool(),
				solo: r.bool(),
				name: 'あ"\'\\'
			});
			const t2 = createTrack(1, { color: '#123456' });
			t1.pitchCurve = [
				[
					{ tick: 0, pitch: 60.5 },
					{ tick: 100, pitch: 61.25 }
				]
			];
			const notes = [...randomLine(r, t1.id), ...randomLine(r, t2.id)];
			const data = {
				name: 'x',
				notes,
				tracks: [t1, t2],
				tempos: [{ tick: 0, bpm: 99.5 }],
				timeSignature: { numerator: 7, denominator: 8 },
				voicebank: 'V'
			};
			const back = parseProject(serializeProject(data));
			expect(back.tracks).toEqual(data.tracks);
			expect(back.tempos).toEqual(data.tempos);
			expect(back.timeSignature).toEqual(data.timeSignature);
			expect(
				back.notes.map((n) => [
					n.track,
					...key(n),
					n.velocity,
					n.volume,
					n.modulation,
					n.pitchPoints.map((p) => [p.x, p.y, p.shape]),
					n.vibrato
				])
			).toEqual(
				notes.map((n) => [
					n.track,
					...key(n),
					n.velocity,
					n.volume,
					n.modulation,
					n.pitchPoints.map((p) => [p.x, p.y, p.shape]),
					n.vibrato
				])
			);
		});
	});

	it('rejects what is not a project, and tolerates a project missing most fields', () => {
		expect(() => parseProject('{}')).toThrow(/not a WebTAU/);
		expect(() => parseProject('nonsense')).toThrow();
		const p = parseProject('{"format":"webtau-project"}');
		expect(p.notes).toEqual([]);
		expect(p.tracks).toHaveLength(1);
		expect(p.tempos).toEqual([{ tick: 0, bpm: 120 }]);
	});

	it('notes with missing or wrong-typed fields come out as usable numbers', () => {
		const text = JSON.stringify({
			format: 'webtau-project',
			notes: [
				{},
				{ tick: 'abc', length: null, pitch: 'x', velocity: 'loud' },
				{ tick: -50, length: 0, pitch: 60.6 },
				{ tick: 10, length: 20, pitch: 60, pitchPoints: [{}, { x: 'a', y: null }], vibrato: 0 }
			]
		});
		for (const n of parseProject(text).notes) {
			for (const v of [n.tick, n.length, n.pitch, n.velocity, n.volume, n.modulation])
				expect(Number.isFinite(v), JSON.stringify(n)).toBe(true);
			expect(n.tick).toBeGreaterThanOrEqual(0);
			expect(n.length).toBeGreaterThanOrEqual(1);
			for (const p of n.pitchPoints)
				expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
		}
	});

	it('a bad tempo list does not break time conversion', () => {
		const p = parseProject(
			JSON.stringify({
				format: 'webtau-project',
				tempos: [
					{ tick: 0, bpm: 0 },
					{ tick: 'x', bpm: 'fast' }
				]
			})
		);
		expect(p.tempos.length).toBeGreaterThan(0);
	});
});

describe('USTX: random projects', () => {
	it('notes, tracks and tempos survive an export and import', () => {
		forSeeds(40, (r) => {
			const t1 = createTrack(0, { name: 'One', volume: 100 });
			const t2 = createTrack(1, { name: 'Two', volume: 100 });
			const notes = [...randomLine(r, t1.id), ...randomLine(r, t2.id)].filter(
				(n) => n.lyric !== 'R' && n.lyric !== '+'
			);
			if (!notes.length) return;
			const { text } = serializeUstx({
				name: 'U',
				voicebank: '',
				notes,
				tracks: [t1, t2],
				tempos: [{ tick: 0, bpm: r.int(60, 200) }],
				timeSignature: { numerator: 4, denominator: 4 }
			});
			const back = parseUstx(text);
			const mine = (id: string) =>
				notes.filter((n) => n.track === id).sort((a, b) => a.tick - b.tick);
			const theirs = (i: number) =>
				back.notes.filter((n) => n.track === back.tracks[i]?.id).sort((a, b) => a.tick - b.tick);
			for (const [i, t] of [t1, t2].entries()) {
				expect(
					theirs(i).map((n) => [n.tick, n.length, n.pitch]),
					`track ${i}`
				).toEqual(mine(t.id).map((n) => [n.tick, n.length, n.pitch]));
			}
			expect(back.tracks.map((t) => t.name)).toEqual(['One', 'Two']);
		});
	});

	it('survives invalid YAML and files of the wrong shape with a clear error', () => {
		for (const bad of [
			'',
			'\t\t:::',
			'[1,2',
			'just: text',
			'ustx_version: 0.6\ntracks: 5\nvoice_parts: x',
			'null',
			'42'
		]) {
			try {
				const out = parseUstx(bad);
				expect(Array.isArray(out.notes)).toBe(true);
			} catch (e) {
				expect(e).toBeInstanceOf(Error);
			}
		}
	});
});

describe('VSQX and text', () => {
	const vsqx = (notes: string, extra = '') =>
		`<?xml version="1.0"?><vsq4 xmlns="x"><masterTrack><resolution>480</resolution><preMeasure>0</preMeasure><timeSig><posMes>0</posMes><nume>4</nume><denomi>4</denomi></timeSig><tempo><posTick>0</posTick><bpm>12000</bpm></tempo></masterTrack><vsTrack><name>T</name><musicalPart><posTick>0</posTick>${notes}</musicalPart></vsTrack>${extra}</vsq4>`;
	const note = (tick: number, dur: number, n: number, lyric: string) =>
		`<note><posTick>${tick}</posTick><durTick>${dur}</durTick><noteNum>${n}</noteNum><lyric><![CDATA[${lyric}]]></lyric></note>`;

	it('reads notes and CDATA lyrics and scales the resolution', () => {
		const out = parseVsqx(vsqx(note(0, 480, 60, 'ら') + note(480, 240, 62, 'a b')));
		expect(out.tempos[0].bpm).toBe(120);
		expect(out.tracks[0].notes.map((n) => [n.tick, n.length, n.pitch, n.lyric])).toEqual([
			[0, 480, 60, 'ら'],
			[480, 240, 62, 'a b']
		]);
	});

	it('empty tracks and absent tags do not crash', () => {
		expect(() => parseVsqx(vsqx(''))).not.toThrow();
		expect(() => parseVsqx('<vsq4><masterTrack></masterTrack></vsq4>')).not.toThrow();
		expect(() => parseVsqx('<vsq3></vsq3>')).not.toThrow();
	});

	it('UTF-8, BOM, Shift-JIS and CRLF text decode to the same thing', () => {
		const text = '[#SETTING]\r\nProjectName=テスト\r\n';
		expect(decodeText(encodeText(text))).toBe(text);
		expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...encodeText(text)]))).toBe(text);
		expect(decodeText(Uint8Array.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]))).toBe('テスト');
		expect(decodeText(new Uint8Array(0))).toBe('');
	});

	it('WAV: header fields, length, clipping and silence', () => {
		const wav = encodeWav(Float32Array.of(0, 2, -2, 0.5), 44100);
		const v = new DataView(wav.buffer);
		expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
		expect(v.getUint32(4, true)).toBe(36 + 8);
		expect(v.getUint32(24, true)).toBe(44100);
		expect(v.getUint32(40, true)).toBe(8);
		expect(wav.length).toBe(44 + 8);
		expect(v.getInt16(46, true)).toBe(32767);
		expect(v.getInt16(48, true)).toBe(-32768);
		expect(Math.abs(v.getInt16(44, true))).toBeLessThanOrEqual(1);
		expect(encodeWav(new Float32Array(0), 48000).length).toBe(44);
	});
});
