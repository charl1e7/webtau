import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createNote, createPitchPoint, createTrack } from '#lib/core/music';
import { curveAt } from '#lib/core/pitch-curve';
import { parseUstx, serializeUstx } from './ustx';

// A small project in the layout OpenUtau writes (snake_case keys, voice parts, pitd curve).
const SAMPLE = `
name: Sample
comment: ''
output_dir: Vocal
cache_dir: UCache
ustx_version: "0.6"
tempos:
- position: 0
  bpm: 140
- position: 960
  bpm: 90
time_signatures:
- bar_position: 0
  beat_per_bar: 3
  beat_unit: 4
key: 0
tracks:
- singer: Teto
  phonemizer: OpenUtau.Core.DefaultPhonemizer
  track_name: Lead
  track_color: Green
  mute: false
  solo: false
  volume: -6
  pan: 0
- singer: Teto
  track_name: Harmony
  track_color: Purple
  mute: true
  solo: false
  volume: 0
voice_parts:
- duration: 3840
  name: Part
  comment: ''
  track_no: 0
  position: 480
  notes:
  - position: 0
    duration: 480
    tone: 60
    lyric: ka
    pitch:
      data:
      - {x: -25, y: 0, shape: io}
      - {x: 25, y: 0, shape: io}
      snap_first: true
    vibrato: {length: 0, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}
    phoneme_expressions:
    - {index: 0, abbr: vel, value: 120}
    - {index: 0, abbr: gen, value: -5}
    - {index: 0, abbr: bre, value: 30}
    - {index: 1, abbr: vol, value: 10}
    - {index: 0, abbr: dyn, value: 50}
    phoneme_overrides: []
  - position: 480
    duration: 480
    tone: 64
    lyric: "+"
    pitch:
      data:
      - {x: -25, y: 0, shape: io}
      - {x: 40, y: 3, shape: o}
      - {x: 200, y: -2.5, shape: i}
      - {x: 300, y: 0, shape: l}
      snap_first: true
    vibrato: {length: 50, period: 200, depth: 40, in: 20, out: 30, shift: 25, drift: 0, vol_link: 0}
    phoneme_expressions:
    - {index: 0, abbr: vol, value: 80}
    - {index: 0, abbr: mod, value: 15}
  curves:
  - abbr: pitd
    xs: [440, 445, 480, 720, 960, 965]
    ys: [0, 100, 100, 0, 0, 0]
  - abbr: dyn
    xs: [0, 5]
    ys: [10, 10]
- duration: 1920
  name: Other
  track_no: 1
  position: 0
  notes:
  - position: 0
    duration: 960
    tone: 55
    lyric: "[ha] a"
wave_parts:
- name: Audio
  track_no: 1
  position: 0
`;

describe('parseUstx', () => {
	const u = parseUstx(SAMPLE);

	it('reads project settings', () => {
		expect(u.name).toBe('Sample');
		expect(u.voicebank).toBe('Teto');
		expect(u.tempos).toEqual([
			{ tick: 0, bpm: 140 },
			{ tick: 960, bpm: 90 }
		]);
		expect(u.timeSignature).toEqual({ numerator: 3, denominator: 4 });
	});

	it('reads tracks: names, colours, mute and the dB volume curve', () => {
		expect(u.tracks.map((t) => [t.name, t.mute])).toEqual([
			['Lead', false],
			['Harmony', true]
		]);
		expect(u.tracks[0].color).toBe('#66BB6A');
		expect(u.tracks[0].volume).toBe(50); // -6 dB
		expect(u.tracks[1].volume).toBe(100);
	});

	it('places notes at part position + note position, on their track', () => {
		const lead = u.notes.filter((n) => n.track === u.tracks[0].id);
		expect(lead.map((n) => [n.tick, n.length, n.pitch])).toEqual([
			[480, 480, 60],
			[960, 480, 64]
		]);
		expect(u.notes.find((n) => n.track === u.tracks[1].id)?.tick).toBe(0);
	});

	it('maps expressions of the first phoneme, flags included, and ignores the rest', () => {
		const [ka, extended] = u.notes.filter((n) => n.track === u.tracks[0].id);
		expect(ka).toMatchObject({ velocity: 120, volume: 100, flags: 'g-5B30' });
		expect(extended).toMatchObject({ volume: 80, modulation: 15 });
		expect(u.warnings.join(' ')).toMatch(/dyn/);
	});

	it('turns pitch points into ours: ms, cents and shapes (i/o swapped to our naming)', () => {
		const note = u.notes.find((n) => n.pitch === 64)!;
		expect(note.pitchPoints.map((p) => [p.x, p.y, p.shape])).toEqual([
			[-25, -400, 's'], // snap_first: starts at the previous note (60 vs 64)
			[40, 30, 'r'],
			[200, -25, 'j'],
			[300, 0, 'l']
		]);
	});

	it('snap_first starts the first point at the previous note when the notes touch', () => {
		const second = u.notes.find((n) => n.pitch === 64)!;
		expect(second.pitchPoints[0].y).toBe(-400 * 10 * 0.1 * 1); // (60 - 64) * 10 = -40 → -400 cents
	});

	it('reads vibrato (length 0 means none)', () => {
		const [ka, second] = u.notes.filter((n) => n.track === u.tracks[0].id);
		expect(ka.vibrato).toBeNull();
		expect(second.vibrato).toEqual({
			length: 50,
			period: 200,
			depth: 40,
			fadeIn: 20,
			fadeOut: 30,
			phase: 25
		});
	});

	it('gives “+” continuations the previous lyric and drops phonetic hints', () => {
		expect(u.notes.find((n) => n.pitch === 64)?.lyric).toBe('ka');
		expect(u.notes.find((n) => n.pitch === 55)?.lyric).toBe('a');
		expect(u.warnings.join(' ')).toMatch(/continuation/);
	});

	it('turns the pitd curve into the track pitch curve over its notes', () => {
		const curve = u.tracks[0].pitchCurve;
		expect(curve.length).toBeGreaterThan(0);
		// Part starts at tick 480: pitd +100 cents at part tick 445 (= 925) over the first note (60).
		expect(curveAt(curve, 925)).toBeCloseTo(61, 3);
		// Over the second note (64): +100 at its start (960), falling back to 0 at part tick 720 (= 1200).
		expect(curveAt(curve, 960)).toBeCloseTo(65, 3);
		expect(curveAt(curve, 1000)).toBeCloseTo(64 + (1 - 40 / 240), 3);
		expect(curveAt(curve, 1300)).toBeCloseTo(64, 3);
		// Where pitd is zero the curve sits on the note itself.
		expect(curveAt(curve, 600)).toBeCloseTo(60, 3);
	});

	it('warns about audio parts', () => {
		expect(u.warnings.join(' ')).toMatch(/Audio/);
	});

	it('rejects files that are not USTX', () => {
		expect(() => parseUstx('hello: [')).toThrow(/YAML/);
		expect(() => parseUstx('just: text')).toThrow(/USTX/);
	});

	it('reads the old layout with the tempo at the top level', () => {
		const old = parseUstx(
			'bpm: 150\nbeat_per_bar: 4\nbeat_unit: 4\ntracks:\n- track_name: T\nvoice_parts:\n- track_no: 0\n  position: 0\n  notes:\n  - {position: 0, duration: 480, tone: 60, lyric: a}\n'
		);
		expect(old.tempos).toEqual([{ tick: 0, bpm: 150 }]);
		expect(old.notes).toHaveLength(1);
	});
});

describe('serializeUstx', () => {
	const t1 = createTrack(0, { name: 'Lead', color: '#3b9dff', volume: 50 });
	const t2 = createTrack(1, { name: 'Two', mute: true });
	const notes = [
		createNote({
			track: t1.id,
			tick: 0,
			length: 480,
			pitch: 60,
			lyric: 'ka',
			velocity: 120,
			volume: 90,
			modulation: 10,
			flags: 'g-5B30fe10',
			pitchPoints: [createPitchPoint(-30, 100, 's'), createPitchPoint(40, -50, 'r')],
			vibrato: { length: 40, period: 180, depth: 30, fadeIn: 10, fadeOut: 15, phase: 5 }
		}),
		createNote({ track: t1.id, tick: 480, length: 480, pitch: 64, lyric: 'sa' }),
		createNote({ track: t2.id, tick: 0, length: 960, pitch: 55, lyric: 'a' })
	];
	t1.pitchCurve = [
		[
			{ tick: 100, pitch: 60.2 },
			{ tick: 400, pitch: 60.8 },
			{ tick: 560, pitch: 64.5 },
			{ tick: 800, pitch: 63.5 }
		]
	];
	const input = {
		name: 'Round',
		voicebank: 'Teto',
		notes,
		tracks: [t1, t2],
		tempos: [
			{ tick: 0, bpm: 120 },
			{ tick: 960, bpm: 100 }
		],
		timeSignature: { numerator: 6, denominator: 8 }
	};
	const out = serializeUstx(input);

	it('writes valid YAML in the OpenUtau layout with a quoted version', () => {
		const doc = parse(out.text) as Record<string, unknown>;
		expect(doc.ustx_version).toBe('0.6');
		expect(out.text).toMatch(/ustx_version: "0\.6"/);
		expect(Object.keys(doc)).toEqual(
			expect.arrayContaining(['tempos', 'time_signatures', 'tracks', 'voice_parts'])
		);
		expect((doc.voice_parts as unknown[]).length).toBe(2);
	});

	it('round-trips settings, tracks, notes, points, vibrato and expressions', () => {
		const back = parseUstx(out.text);
		expect(back.tempos).toEqual(input.tempos);
		expect(back.timeSignature).toEqual(input.timeSignature);
		expect(back.tracks.map((t) => [t.name, t.mute, t.volume])).toEqual([
			['Lead', false, 50],
			['Two', true, 100]
		]);
		const [ka, sa] = back.notes.filter((n) => n.track === back.tracks[0].id);
		expect([ka.tick, ka.length, ka.pitch, ka.lyric]).toEqual([0, 480, 60, 'ka']);
		expect(ka).toMatchObject({ velocity: 120, volume: 90, modulation: 10 });
		expect(ka.flags).toContain('g-5');
		expect(ka.flags).toContain('B30');
		expect(ka.flags).not.toContain('fe');
		expect(ka.pitchPoints.map((p) => [p.x, p.y, p.shape])).toEqual([
			[-30, 100, 's'],
			[40, -50, 'r']
		]);
		expect(ka.vibrato).toEqual({
			length: 40,
			period: 180,
			depth: 30,
			fadeIn: 10,
			fadeOut: 15,
			phase: 5
		});
		expect(sa.pitchPoints[0].y).toBe(0); // flat notes stay flat (snap_first is off)
		expect(back.notes.filter((n) => n.track === back.tracks[1].id)).toHaveLength(1);
	});

	it('writes the drawn track pitch as a pitd curve that comes back as the same curve', () => {
		const doc = parse(out.text) as {
			voice_parts: { curves: { abbr: string; xs: number[]; ys: number[] }[] }[];
		};
		const curve = doc.voice_parts[0].curves.find((c) => c.abbr === 'pitd')!;
		expect(curve.xs.length).toBe(curve.ys.length);
		expect(curve.xs).toEqual([...curve.xs].sort((a, b) => a - b));
		expect(curve.xs.every((x) => x % 5 === 0)).toBe(true);
		expect(Math.max(...curve.ys.map(Math.abs))).toBeLessThanOrEqual(1200);

		const back = parseUstx(out.text).tracks[0].pitchCurve;
		for (const tick of [150, 300, 500, 520, 700, 900]) {
			const was = t1.pitchCurve[0];
			const at = (tick: number) => {
				for (let i = 1; i < was.length; i++) {
					if (tick <= was[i].tick) {
						const p = was[i - 1];
						const q = was[i];
						return p.pitch + ((q.pitch - p.pitch) * (tick - p.tick)) / (q.tick - p.tick);
					}
				}
				return null;
			};
			const expected = at(tick);
			const inNote = tick < 960; // both notes of track 1 cover ticks 0..960
			if (expected !== null && inNote && tick <= 800) {
				expect(curveAt(back, tick)).toBeCloseTo(expected, 1);
			}
		}
	});

	it('warns about dropped flags and shortened overlaps', () => {
		expect(out.warnings.join(' ')).toMatch(/fe/);
		const overlapping = serializeUstx({
			...input,
			notes: [
				createNote({ track: t1.id, tick: 0, length: 960, pitch: 60 }),
				createNote({ track: t1.id, tick: 480, length: 480, pitch: 62 })
			]
		});
		expect(overlapping.warnings.join(' ')).toMatch(/Overlapping/);
	});

	it('gives every note at least two pitch points so that OpenUtau can sample it', () => {
		const doc = parse(out.text) as {
			voice_parts: { notes: { pitch: { data: unknown[] } }[] }[];
		};
		for (const part of doc.voice_parts) {
			for (const n of part.notes) expect(n.pitch.data.length).toBeGreaterThanOrEqual(2);
		}
	});
});
