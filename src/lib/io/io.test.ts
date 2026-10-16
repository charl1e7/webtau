import { describe, expect, it } from 'vitest';
import { parseUst, serializeUst } from './ust';
import { parseMidi, serializeMidi } from './midi';
import { parseProject, serializeProject } from './project-file';
import { createNote, createPitchPoint } from '#lib/core/music';

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
		const { text } = serializeUst(ust.notes, ust.tempos, { name: ust.name, voicebank: ust.voicebank });
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
		const { text, warnings } = serializeUst([a, b], [{ tick: 0, bpm: 120 }], { name: 'x', voicebank: '' });
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
		const head = new TextEncoder().encode('[#SETTING]\nTempo=120\n[#0000]\nLength=480\nNoteNum=60\nLyric=');
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
		const bytes = serializeMidi(notes, [{ tick: 0, bpm: 90 }], 'Song');
		const midi = parseMidi(bytes);
		expect(midi.tempos[0].bpm).toBe(90);
		expect(midi.tracks[0].name).toBe('Song');
		expect(midi.tracks[0].notes.map((n) => [n.tick, n.length, n.pitch, n.lyric])).toEqual([
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
		const n = createNote({ tick: 10, length: 100, pitch: 61, pitchPoints: [createPitchPoint(0, 50, 's')] });
		const text = serializeProject({
			name: 'p',
			notes: [n],
			tempos: [{ tick: 0, bpm: 100 }],
			timeSignature: { numerator: 3, denominator: 4 },
			voicebank: 'vb'
		});
		const back = parseProject(text);
		expect(back.notes[0]).toMatchObject({ tick: 10, length: 100, pitch: 61 });
		expect(back.notes[0].pitchPoints[0]).toMatchObject({ x: 0, y: 50, shape: 's' });
		expect(back.timeSignature.numerator).toBe(3);
		expect(() => parseProject('{"format":"nope"}')).toThrow();
	});
});
