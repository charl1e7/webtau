import { describe, expect, it } from 'vitest';
import { parseUst, serializeUst } from './ust';
import { parseMidi, serializeMidi } from './midi';
import { parseVsqx } from './vsqx';
import { parseProject, serializeProject } from './project-file';
import { createNote, createPitchPoint, createTrack } from '#lib/core/music';

const SAMPLE_UST = `[#VERSION]
UST Version1.2
[#SETTING]
Tempo=140.00
ProjectName=Test
VoiceDir=%VOICE%Teto
[#0000]
Length=480
Lyric=R
NoteNum=60
[#0001]
Length=240
Lyric=ka
NoteNum=64
Intensity=90
Moduration=5
Velocity=120
Flags=g-5
PBS=-40;0
PBW=40,60
PBY=2,0
PBM=,s,
VBR=65,180,35,20,20,0,0,0
[#0002]
Length=480
Lyric=ki
NoteNum=62
Tempo=100.00
[#TRACKEND]
`;

describe('UST', () => {
	it('parses notes, tempo, pitch and vibrato', () => {
		const ust = parseUst(SAMPLE_UST);
		expect(ust.name).toBe('Test');
		expect(ust.voicebank).toBe('Teto');
		expect(ust.tempos).toEqual([
			{ tick: 0, bpm: 140 },
			{ tick: 720, bpm: 100 }
		]);
		expect(ust.notes.map((n) => [n.tick, n.length, n.pitch, n.lyric])).toEqual([
			[0, 480, 60, 'R'],
			[480, 240, 64, 'ka'],
			[720, 480, 62, 'ki']
		]);
		const ka = ust.notes[1];
		expect([ka.volume, ka.modulation, ka.velocity, ka.flags]).toEqual([90, 5, 120, 'g-5']);
		expect(ka.pitchPoints.map((p) => [p.x, p.y, p.shape])).toEqual([
			[-40, 0, 'l'],
			[0, 20, 's'],
			[60, 0, 'l']
		]);
		expect(ka.vibrato?.depth).toBe(35);
	});

	it('round-trips through serialize', () => {
		const ust = parseUst(SAMPLE_UST);
		const { text } = serializeUst(ust.notes, ust.tempos, {
			name: ust.name,
			voicebank: ust.voicebank
		});
		const again = parseUst(text);
		expect(again.tempos).toEqual(ust.tempos);
		expect(again.notes.map((n) => [n.tick, n.length, n.pitch, n.lyric, n.volume])).toEqual(
			ust.notes.map((n) => [n.tick, n.length, n.pitch, n.lyric, n.volume])
		);
		expect(again.notes[1].pitchPoints.map((p) => [p.x, p.y, p.shape])).toEqual(
			ust.notes[1].pitchPoints.map((p) => [p.x, p.y, p.shape])
		);
	});

	it('fills gaps with rests and warns about overlaps', () => {
		const a = createNote({ tick: 480, length: 600, pitch: 60 });
		const b = createNote({ tick: 960, length: 480, pitch: 62 });
		const { text, warnings } = serializeUst([a, b], [{ tick: 0, bpm: 120 }], {
			name: 'x',
			voicebank: ''
		});
		const back = parseUst(text);
		expect(back.notes.map((n) => [n.tick, n.length, n.lyric])).toEqual([
			[0, 480, 'R'],
			[480, 480, 'a'],
			[960, 480, 'a']
		]);
		expect(warnings).toHaveLength(1);
	});

	it('reads Shift-JIS encoded lyrics', () => {
		// "あ" in Shift-JIS is 0x82 0xA0
		const head = new TextEncoder().encode(
			'[#SETTING]\nTempo=120\n[#0000]\nLength=480\nNoteNum=60\nLyric='
		);
		const tail = new TextEncoder().encode('\n[#TRACKEND]\n');
		const bytes = new Uint8Array([...head, 0x82, 0xa0, ...tail]);
		expect(parseUst(bytes).notes[0].lyric).toBe('あ');
	});
});

describe('MIDI', () => {
	it('round-trips notes, lyrics and tempo', () => {
		const notes = [
			createNote({ tick: 0, length: 480, pitch: 60, lyric: 'do' }),
			createNote({ tick: 480, length: 240, pitch: 67, lyric: 're' })
		];
		const bytes = serializeMidi([{ name: 'Lead', notes }], [{ tick: 0, bpm: 90 }], 'Song');
		const midi = parseMidi(bytes);
		expect(midi.tempos[0].bpm).toBe(90);
		const lead = midi.tracks.find((t) => t.noteCount > 0)!;
		expect(lead.name).toBe('Lead');
		expect(lead.notes.map((n) => [n.tick, n.length, n.pitch, n.lyric])).toEqual([
			[0, 480, 60, 'do'],
			[480, 240, 67, 're']
		]);
	});

	it('rejects garbage', () => {
		expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
	});
});

describe('project file', () => {
	it('round-trips', () => {
		const n = createNote({
			tick: 10,
			length: 100,
			pitch: 61,
			pitchPoints: [createPitchPoint(0, 50, 's')]
		});
		const text = serializeProject({
			name: 'p',
			notes: [n],
			tracks: [createTrack(0), createTrack(1, { name: 'Harmony', mute: true })],
			tempos: [{ tick: 0, bpm: 100 }],
			timeSignature: { numerator: 3, denominator: 4 },
			voicebank: 'vb'
		});
		const back = parseProject(text);
		expect(back.notes[0]).toMatchObject({ tick: 10, length: 100, pitch: 61 });
		expect(back.notes[0].pitchPoints[0]).toMatchObject({ x: 0, y: 50, shape: 's' });
		expect(back.timeSignature.numerator).toBe(3);
		expect(back.tracks.map((t) => [t.name, t.mute])).toEqual([
			['Track 1', false],
			['Harmony', true]
		]);
		expect(() => parseProject('{"format":"nope"}')).toThrow();
	});
});

const VSQX = `<?xml version="1.0" encoding="UTF-8"?>
<vsq4 xmlns="http://www.yamaha.co.jp/vocaloid/schema/vsq4/">
<masterTrack><resolution>480</resolution><preMeasure>4</preMeasure>
<timeSig><posMes>0</posMes><nume>3</nume><denomi>4</denomi></timeSig>
<tempo><posTick>0</posTick><bpm>9000</bpm></tempo>
<tempo><posTick>7200</posTick><bpm>12000</bpm></tempo></masterTrack>
<vsTrack><vsTrackNo>0</vsTrackNo><trackName><![CDATA[x]]></trackName><name><![CDATA[Lead]]></name>
<musicalPart><posTick>5760</posTick><playTime>1920</playTime>
<note><posTick>0</posTick><durTick>480</durTick><noteNum>64</noteNum><velocity>64</velocity><lyric><![CDATA[ら]]></lyric></note>
<note><posTick>480</posTick><durTick>240</durTick><noteNum>66</noteNum><y><![CDATA[la &amp; la]]></y></note>
</musicalPart></vsTrack>
<vsTrack><vsTrackNo>1</vsTrackNo><name><![CDATA[Empty]]></name></vsTrack>
</vsq4>`;

describe('VSQX', () => {
	it('parses notes, lyrics, tempo and removes the pre-measure', () => {
		const v = parseVsqx(VSQX);
		expect(v.timeSignature).toEqual({ numerator: 3, denominator: 4 });
		expect(v.tempos).toEqual([
			{ tick: 0, bpm: 90 },
			{ tick: 1440, bpm: 120 }
		]);
		expect(v.tracks).toHaveLength(1);
		expect(v.tracks[0].name).toBe('Lead');
		expect(v.tracks[0].notes.map((n) => [n.tick, n.length, n.pitch, n.lyric])).toEqual([
			[0, 480, 64, 'ら'],
			[480, 240, 66, 'la & la']
		]);
	});

	it('rejects other XML', () => {
		expect(() => parseVsqx('<xml/>')).toThrow();
	});
});
