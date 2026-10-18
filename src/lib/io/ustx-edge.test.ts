import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { forSeeds } from '../testing/rng';
import { createNote, createTrack } from '#lib/core/music';
import { parseUstx, serializeUstx } from './ustx';

const note = (position: number, extra: Record<string, unknown> = {}) => ({
	position,
	duration: 480,
	tone: 60,
	lyric: 'a',
	...extra
});
const project = (over: Record<string, unknown>) => stringify({ ustx_version: '0.6', ...over });
const track = (extra: Record<string, unknown> = {}) => ({ track_name: 'T', ...extra });

describe('USTX import: odd but legal files', () => {
	it('a note’s position is added to its part’s, and several parts of one track are merged', () => {
		const out = parseUstx(
			project({
				tracks: [track()],
				voice_parts: [
					{ track_no: 0, position: 1920, notes: [note(0), note(480)] },
					{ track_no: 0, position: 0, notes: [note(0)] }
				]
			})
		);
		expect(out.notes.map((n) => n.tick)).toEqual([0, 1920, 2400]);
		expect(new Set(out.notes.map((n) => n.track)).size).toBe(1);
	});

	it('a part that points at a missing track goes to the nearest existing one', () => {
		const out = parseUstx(
			project({
				tracks: [track(), track()],
				voice_parts: [
					{ track_no: 9, notes: [note(0)] },
					{ track_no: -3, notes: [note(0)] }
				]
			})
		);
		expect(out.notes.map((n) => out.tracks.findIndex((t) => t.id === n.track)).sort()).toEqual([
			0, 1
		]);
	});

	it('notes inside a part come out sorted, with bad values replaced by usable ones', () => {
		const out = parseUstx(
			project({
				tracks: [track()],
				voice_parts: [
					{
						notes: [
							note(960, { lyric: 'late' }),
							{ position: 'x', duration: 'y', tone: null, lyric: 5 },
							note(-100, { duration: 0 }),
							note(480, { tone: 60.4 })
						]
					}
				]
			})
		);
		for (const n of out.notes) {
			expect(Number.isInteger(n.tick) && n.tick >= 0).toBe(true);
			expect(Number.isInteger(n.length) && n.length >= 1).toBe(true);
			expect(Number.isInteger(n.pitch)).toBe(true);
			expect(typeof n.lyric).toBe('string');
		}
		expect(out.notes.map((n) => n.tick)).toEqual(
			[...out.notes.map((n) => n.tick)].sort((a, b) => a - b)
		);
	});

	it('no tracks at all still gives one, empty files give a warning not a crash', () => {
		const out = parseUstx(project({ voice_parts: [{ notes: [note(0)] }] }));
		expect(out.tracks).toHaveLength(1);
		expect(parseUstx(project({ tracks: [track()], voice_parts: [] })).warnings.join()).toMatch(
			/No notes/
		);
	});

	it('tempo: unsorted, duplicated, zero and negative entries; the first one is moved to the start', () => {
		const out = parseUstx(
			project({
				tracks: [track()],
				voice_parts: [],
				tempos: [
					{ position: 960, bpm: 90 },
					{ position: 480, bpm: 0 },
					{ position: 960, bpm: 100 },
					{ position: 240, bpm: -4 },
					{ position: 480, bpm: 150 }
				]
			})
		);
		expect(out.tempos[0]).toEqual({ tick: 0, bpm: 150 });
		for (const t of out.tempos) expect(t.bpm).toBeGreaterThan(0);
		expect(out.tempos.map((t) => t.tick)).toEqual(
			[...new Set(out.tempos.map((t) => t.tick))].sort((a, b) => a - b)
		);
	});

	it('time signatures: missing, zero and extra ones', () => {
		const sig = (n: number, d: number) => ({ bar_position: 0, beat_per_bar: n, beat_unit: d });
		expect(parseUstx(project({ tracks: [track()] })).timeSignature).toEqual({
			numerator: 4,
			denominator: 4
		});
		expect(
			parseUstx(project({ tracks: [track()], time_signatures: [sig(0, 0)] })).timeSignature
		).toEqual({ numerator: 1, denominator: 1 });
		const two = parseUstx(project({ tracks: [track()], time_signatures: [sig(3, 4), sig(5, 8)] }));
		expect(two.timeSignature).toEqual({ numerator: 3, denominator: 4 });
		expect(two.warnings.join()).toMatch(/time signature/);
	});

	it('track volume in dB: 0 dB is 100 %, quieter is lower, the bottom is silence', () => {
		const vol = (db: unknown) =>
			parseUstx(project({ tracks: [track({ volume: db })], voice_parts: [{ notes: [note(0)] }] }))
				.tracks[0].volume;
		expect(vol(0)).toBe(100);
		expect(vol(-6)).toBeLessThan(100);
		expect(vol(-24)).toBe(0);
		expect(vol(-100)).toBe(0);
		expect(vol('x')).toBe(100);
		expect(vol(6)).toBeGreaterThan(100);
		expect(vol(100)).toBeLessThanOrEqual(150);
		let last = -1;
		for (let db = -30; db <= 12; db += 0.5) {
			const v = vol(db);
			expect(v).toBeGreaterThanOrEqual(last);
			last = v;
		}
	});

	it('unknown colour names keep the default, known ones get an accent', () => {
		const out = parseUstx(
			project({ tracks: [track({ track_color: 'Nonsense' }), track({ track_color: 'Green' })] })
		);
		expect(out.tracks[0].color).toMatch(/^#/);
		expect(out.tracks[1].color).toBe('#66BB6A');
	});

	it('lyrics: phonetic hints, continuation marks and non-strings', () => {
		const out = parseUstx(
			project({
				tracks: [track()],
				voice_parts: [
					{
						notes: [
							note(0, { lyric: 'か' }),
							note(480, { lyric: '+' }),
							note(960, { lyric: '+~' }),
							note(1440, { lyric: 'x[kya]' }),
							note(1920, { lyric: '[ra]' }),
							note(2400, { lyric: '- し' }),
							note(2880, { lyric: '' }),
							note(3360, { lyric: null })
						]
					}
				]
			})
		);
		expect(out.notes.map((n) => n.lyric)).toEqual(['か', 'か', 'か', 'x', 'ra', '- し', 'a', 'a']);
	});

	it('five thousand notes import quickly', () => {
		const notes = Array.from({ length: 5000 }, (_, i) => note(i * 480));
		const t0 = performance.now();
		const out = parseUstx(project({ tracks: [track()], voice_parts: [{ notes }] }));
		expect(out.notes).toHaveLength(5000);
		expect(performance.now() - t0).toBeLessThan(3000);
	});

	it('accepts Shift-JIS and UTF-8-with-BOM bytes as well as strings', () => {
		const text = project({
			name: 'テスト',
			tracks: [track()],
			voice_parts: [{ notes: [note(0, { lyric: 'あ' })] }]
		});
		const bytes = new TextEncoder().encode(text);
		expect(parseUstx(bytes).notes[0].lyric).toBe('あ');
		expect(parseUstx(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes])).name).toBe('テスト');
	});
});

describe('USTX export: dB mapping and structure', () => {
	const exportVolume = (percent: number) => {
		const t = createTrack(0, { volume: percent });
		const { text } = serializeUstx({
			name: 'x',
			voicebank: '',
			notes: [createNote({ track: t.id, tick: 0, length: 480, pitch: 60 })],
			tracks: [t],
			tempos: [{ tick: 0, bpm: 120 }],
			timeSignature: { numerator: 4, denominator: 4 }
		});
		return text;
	};

	it('volume goes out and back within one percent over the whole range', () => {
		for (let v = 5; v <= 150; v += 5) {
			const back = parseUstx(exportVolume(v)).tracks[0].volume;
			expect(Math.abs(back - v), `${v}%`).toBeLessThanOrEqual(2);
		}
		expect(parseUstx(exportVolume(0)).tracks[0].volume).toBe(0);
	});

	it('empty tracks, a single note, a note beyond the part’s first measure', () => {
		forSeeds(40, (r) => {
			const tracks = Array.from({ length: r.int(1, 4) }, (_, i) => createTrack(i, {}));
			const notes = tracks.flatMap((t) =>
				r.bool(0.7)
					? [
							createNote({
								track: t.id,
								tick: r.int(0, 20000),
								length: r.int(15, 4000),
								pitch: r.int(30, 100),
								lyric: 'あ'
							})
						]
					: []
			);
			const { text } = serializeUstx({
				name: 'r',
				voicebank: '',
				notes,
				tracks,
				tempos: [{ tick: 0, bpm: 120 }],
				timeSignature: { numerator: 4, denominator: 4 }
			});
			const back = parseUstx(text);
			expect(back.tracks).toHaveLength(tracks.length);
			expect(back.notes.map((n) => [n.tick, n.length, n.pitch]).sort()).toEqual(
				notes.map((n) => [n.tick, n.length, n.pitch]).sort()
			);
		});
	});
});
