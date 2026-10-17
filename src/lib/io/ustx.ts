import { parse, stringify } from 'yaml';
import { TRACK_COLORS, createNote, createPitchPoint, createTrack } from '#lib/core/music';
import { sortNotes, trimOverlaps } from '#lib/core/ops';
import { getFlag, setFlag } from '#lib/core/flags';
import { simplify } from '#lib/core/pitch-curve';
import {
	PPQ,
	type CurvePoint,
	type Note,
	type PitchShape,
	type PitchStroke,
	type TempoChange,
	type TimeSignature,
	type Track,
	type Vibrato
} from '#lib/core/types';
import { decodeText } from './text';

/*
 * USTX is the project format of OpenUtau: YAML with snake_case keys. Notes live
 * in voice parts (positions relative to the part), pitch points are in ms /
 * 0.1 semitone relative to the note, and the "pitd" curve adds a pitch
 * deviation in cents on a 5 tick grid. Per-phoneme expressions carry velocity,
 * volume, modulation and the flag-like values (gender, breath, ...).
 */

export interface UstxImport {
	name: string;
	voicebank: string;
	tempos: TempoChange[];
	timeSignature: TimeSignature;
	tracks: Track[];
	notes: Note[];
	warnings: string[];
}

// OpenUtau's track colour names with their accent colours (ThemeManager.TrackColors).
const OPENUTAU_COLORS: [string, string][] = [
	['Pink', '#F06292'],
	['Red', '#EF5350'],
	['Orange', '#FF8A65'],
	['Yellow', '#FBC02D'],
	['Light Green', '#CDDC39'],
	['Green', '#66BB6A'],
	['Light Blue', '#4FC3F7'],
	['Blue', '#4EA6EA'],
	['Purple', '#BA68C8'],
	['Pink2', '#E91E63'],
	['Red2', '#D32F2F'],
	['Orange2', '#FF5722'],
	['Yellow2', '#FF8F00'],
	['Light Green2', '#AFB42B'],
	['Green2', '#2E7D32'],
	['Light Blue2', '#1976D2'],
	['Blue2', '#3949AB'],
	['Purple2', '#7B1FA2']
];

const PITD_INTERVAL = 5;
const PITD_RANGE = 1200;
const USTX_VERSION = '0.6';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback: number): number => {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	return Number.isFinite(n) ? n : fallback;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- shapes, volume, colours --------------------------------------------------------------

/** OpenUtau shapes: io = sine in/out, l = linear, i = sine in, o = sine out, sp = spline. */
function shapeFromUstx(code: unknown): PitchShape {
	switch (code) {
		case 'l':
			return 'l';
		case 'i':
			return 'j'; // slow start, quick end
		case 'o':
			return 'r'; // quick start, slow end
		default:
			return 's'; // io, sp and anything unknown: smooth
	}
}

function shapeToUstx(shape: PitchShape): string {
	return shape === 'l' ? 'l' : shape === 'j' ? 'i' : shape === 'r' ? 'o' : 'io';
}

/** Track volume in OpenUtau is dB with a steeper fall-off below -16 dB; ours is a percentage. */
function dbToPercent(db: number): number {
	if (db <= -24) return 0;
	const effective = db < -16 ? db * 2 + 16 : db;
	return Math.round(clamp(100 * 10 ** (effective / 20), 0, 150));
}

function percentToDb(percent: number): number {
	if (percent <= 0) return -24;
	const effective = 20 * Math.log10(percent / 100);
	const db = effective < -16 ? (effective - 16) / 2 : effective;
	return Math.round(clamp(db, -24, 12) * 100) / 100;
}

function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorName(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	let best = OPENUTAU_COLORS[0][0];
	let bestDist = Infinity;
	for (const [name, value] of OPENUTAU_COLORS) {
		const [r2, g2, b2] = hexToRgb(value);
		const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = name;
		}
	}
	return best;
}

// ---- expressions ----------------------------------------------------------------------------

/** UTAU-style flag that each flag-like OpenUtau expression stands for. */
const EXPRESSION_FLAGS: Record<string, string> = { gen: 'g', bre: 'B', lpf: 'H', norm: 'P' };
const FLAG_EXPRESSIONS: Record<string, string> = { g: 'gen', B: 'bre', H: 'lpf', P: 'norm' };

// ---- pitd curve --------------------------------------------------------------------------

function sampleCurve(xs: number[], ys: number[], x: number): number {
	if (!xs.length) return 0;
	let lo = 0;
	let hi = xs.length - 1;
	if (x < xs[0] || x > xs[hi]) return 0;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (xs[mid] <= x) lo = mid;
		else hi = mid;
	}
	const span = xs[hi] - xs[lo];
	if (span <= 0) return ys[hi];
	return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span;
}

/** Strokes of the track pitch curve that reproduce a part's "pitd" curve over its notes. */
function pitdToStrokes(
	curve: { xs: number[]; ys: number[] },
	notes: { tick: number; length: number; pitch: number }[],
	base: number
): PitchStroke[] {
	const strokes: PitchStroke[] = [];
	for (const n of notes) {
		const from = n.tick - base;
		// The curve is one value per tick: the tick where the next note starts belongs to that note.
		const to = from + n.length - 1;
		const inside = curve.xs
			.map((x, i) => ({ x, y: curve.ys[i] }))
			.filter((p) => p.x > from && p.x < to);
		const edges = [from, ...inside.map((p) => p.x), to];
		const values = edges.map((x) => sampleCurve(curve.xs, curve.ys, x));
		if (values.every((v) => Math.abs(v) < 0.5)) continue;
		strokes.push(
			edges.map((x, i): CurvePoint => ({ tick: x + base, pitch: n.pitch + values[i] / 100 }))
		);
	}
	return strokes;
}

// ---- import ----------------------------------------------------------------------------------

export function parseUstx(input: Uint8Array | string): UstxImport {
	const text = typeof input === 'string' ? input : decodeText(input);
	let raw: unknown;
	try {
		raw = parse(text);
	} catch (error) {
		throw new Error(
			`The USTX file is not valid YAML (${error instanceof Error ? error.message.split('\n')[0] : error}).`,
			{ cause: error }
		);
	}
	if (!isObj(raw) || !(Array.isArray(raw.voice_parts) || Array.isArray(raw.tracks))) {
		throw new Error('This is not an OpenUtau project (USTX) file.');
	}
	const warnings: string[] = [];

	// Tempo and time signature (very old files keep them at the top level).
	const tempoList = arr(raw.tempos).filter(isObj);
	let tempos: TempoChange[] = tempoList
		.map((t) => ({ tick: Math.max(0, Math.round(num(t.position, 0))), bpm: num(t.bpm, 120) }))
		.filter((t) => t.bpm > 0)
		.sort((a, b) => a.tick - b.tick);
	if (!tempos.length) tempos = [{ tick: 0, bpm: num(raw.bpm, 120) }];
	tempos = tempos.filter((t, i) => i === 0 || t.tick !== tempos[i - 1].tick);
	if (tempos[0].tick !== 0) tempos.unshift({ tick: 0, bpm: tempos[0].bpm });

	const signatures = arr(raw.time_signatures).filter(isObj);
	const first = signatures[0];
	const timeSignature: TimeSignature = {
		numerator: Math.max(1, Math.round(num(first?.beat_per_bar ?? raw.beat_per_bar, 4))),
		denominator: Math.max(1, Math.round(num(first?.beat_unit ?? raw.beat_unit, 4)))
	};
	if (signatures.length > 1) warnings.push('Only the first time signature was kept.');

	// Tracks.
	const rawTracks = arr(raw.tracks).filter(isObj);
	const tracks: Track[] = (rawTracks.length ? rawTracks : [{}]).map((t, i) => {
		const color = OPENUTAU_COLORS.find(([name]) => name === t.track_color)?.[1];
		return createTrack(i, {
			name: typeof t.track_name === 'string' && t.track_name ? t.track_name : `Track ${i + 1}`,
			...(color ? { color } : {}),
			mute: t.mute === true,
			solo: t.solo === true,
			volume: dbToPercent(num(t.volume, 0))
		});
	});
	// OpenUtau gives every track "Blue" unless the user changed it; tracks that came in with the same
	// colour would be indistinguishable on the roll, so repeats get the next free colour of ours.
	const used = new Set<string>();
	for (const track of tracks) {
		if (used.has(track.color)) {
			track.color =
				TRACK_COLORS.find((c) => !used.has(c)) ?? TRACK_COLORS[used.size % TRACK_COLORS.length];
		}
		used.add(track.color);
	}

	// Voice parts → notes (positions are relative to their part).
	const notes: Note[] = [];
	const strokes = new Map<string, PitchStroke[]>();
	const ignoredExpressions = new Set<string>();
	const ignoredCurves = new Set<string>();
	let unsupported = false;
	let tuned = false;
	let extensions = 0;

	for (const part of arr(raw.voice_parts).filter(isObj)) {
		const track = tracks[clamp(Math.round(num(part.track_no, 0)), 0, tracks.length - 1)];
		const base = Math.max(0, Math.round(num(part.position, 0)));
		const partNotes: Note[] = [];

		const rawNotes = arr(part.notes)
			.filter(isObj)
			.sort((a, b) => num(a.position, 0) - num(b.position, 0));
		let prev: { end: number; tone: number } | null = null;
		let prevLyric = 'a';

		for (const n of rawNotes) {
			const tick = base + Math.max(0, Math.round(num(n.position, 0)));
			const length = Math.max(1, Math.round(num(n.duration, PPQ)));
			const tone = Math.round(num(n.tone, 60));
			const tuning = num(n.tuning, 0);
			if (tuning) tuned = true;

			// Lyric: "[hint]" overrides phonemes, "+" / "+~" continue the previous note.
			let lyric = typeof n.lyric === 'string' ? n.lyric : 'a';
			const hint = /\[(.*?)\]/.exec(lyric)?.[1]?.trim();
			lyric = lyric.replace(/\[.*?\]/g, '').trim() || hint || 'a';
			if (/^[+-]/.test(lyric) && lyric.length <= 2) {
				lyric = prevLyric;
				extensions++;
			}
			prevLyric = lyric;

			// Pitch points: x in ms, y in 0.1 semitone; the first one follows the previous note
			// when "snap_first" is on and the notes touch.
			const pitch = isObj(n.pitch) ? n.pitch : {};
			const data = arr(pitch.data)
				.filter(isObj)
				.map((p) => ({ x: num(p.x, 0), y: num(p.y, 0), shape: shapeFromUstx(p.shape) }))
				.sort((a, b) => a.x - b.x);
			if (data.length && pitch.snap_first !== false) {
				data[0].y = prev && prev.end === tick ? (prev.tone - (tone + tuning / 100)) * 10 : 0;
			}
			prev = { end: tick + length, tone: tone + tuning / 100 };

			// Vibrato: length 0 means none.
			const v = isObj(n.vibrato) ? n.vibrato : null;
			const vibrato: Vibrato | null =
				v && num(v.length, 0) > 0
					? {
							length: clamp(num(v.length, 0), 0, 100),
							period: clamp(num(v.period, 175), 5, 500),
							depth: clamp(num(v.depth, 25), 5, 200),
							fadeIn: clamp(num(v.in, 10), 0, 100),
							fadeOut: clamp(num(v.out, 10), 0, 100),
							phase: clamp(num(v.shift, 0), 0, 100)
						}
					: null;
			if (v && (num(v.drift, 0) || num(v.vol_link, 0))) unsupported = true;

			// Expressions of the first phoneme.
			let velocity = 100;
			let volume = 100;
			let modulation = 0;
			let flags = '';
			for (const e of arr(n.phoneme_expressions).filter(isObj)) {
				if (e.index !== undefined && e.index !== null && num(e.index, 0) !== 0) continue;
				const abbr = String(e.abbr ?? '').toLowerCase();
				const value = num(e.value, 0);
				if (abbr === 'vel') velocity = clamp(value, 0, 200);
				else if (abbr === 'vol') volume = clamp(value, 0, 200);
				else if (abbr === 'mod') modulation = clamp(value, 0, 100);
				else if (EXPRESSION_FLAGS[abbr]) {
					if (value !== 0) flags = setFlag(flags, EXPRESSION_FLAGS[abbr], value);
				} else ignoredExpressions.add(abbr);
			}

			partNotes.push(
				createNote({
					track: track.id,
					tick,
					length,
					pitch: tone,
					lyric,
					velocity,
					volume,
					modulation,
					flags,
					pitchPoints: data.map((p) => createPitchPoint(p.x, Math.round(p.y * 10), p.shape)),
					vibrato
				})
			);
		}

		// The pitch deviation curve becomes the track's drawn pitch curve.
		for (const c of arr(part.curves).filter(isObj)) {
			const abbr = String(c.abbr ?? '').toLowerCase();
			if (abbr !== 'pitd') {
				if (arr(c.xs).length) ignoredCurves.add(abbr);
				continue;
			}
			const xs = arr(c.xs).map((x) => num(x, 0));
			const ys = arr(c.ys).map((y) => num(y, 0));
			if (xs.length < 2 || xs.length !== ys.length) continue;
			const found = pitdToStrokes({ xs, ys }, partNotes, base);
			if (found.length) strokes.set(track.id, [...(strokes.get(track.id) ?? []), ...found]);
		}
		notes.push(...partNotes);
	}

	for (const [id, list] of strokes) {
		const track = tracks.find((t) => t.id === id)!;
		track.pitchCurve = list.sort((a, b) => a[0].tick - b[0].tick);
	}

	if (arr(raw.wave_parts).length) warnings.push('Audio (wave) parts were skipped.');
	if (extensions)
		warnings.push(`${extensions} “+” continuation note(s) repeat the previous lyric.`);
	if (ignoredExpressions.size)
		warnings.push(
			`Expressions without a WebTAU equivalent were skipped: ${[...ignoredExpressions].join(', ')}.`
		);
	if (ignoredCurves.size)
		warnings.push(
			`Curves without a WebTAU equivalent were skipped: ${[...ignoredCurves].join(', ')}.`
		);
	if (unsupported) warnings.push('Vibrato drift / volume link are not supported and were skipped.');
	if (tuned) warnings.push('Per-note tuning offsets are not supported and were skipped.');
	if (!notes.length) warnings.push('No notes found in the USTX file.');

	const singer = rawTracks.map((t) => (typeof t.singer === 'string' ? t.singer : '')).find(Boolean);

	return {
		name: typeof raw.name === 'string' && raw.name ? raw.name : 'Imported USTX',
		voicebank: (singer ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '',
		tempos,
		timeSignature,
		tracks,
		notes: sortNotes(notes),
		warnings
	};
}

// ---- export ----------------------------------------------------------------------------------

export interface UstxExportInput {
	name: string;
	voicebank: string;
	notes: readonly Note[];
	tracks: readonly Track[];
	tempos: readonly TempoChange[];
	timeSignature: TimeSignature;
}

/** Deviation curve (cents, 5 tick grid) that reproduces a track's drawn pitch over its notes. */
function trackToPitd(track: Track, notes: readonly Note[]): { xs: number[]; ys: number[] } | null {
	if (!track.pitchCurve.some((s) => s.length >= 2)) return null;
	const xs: number[] = [];
	const ys: number[] = [];
	const guards = new Set<number>();
	let lastX = -Infinity;

	for (const note of sortNotes(notes)) {
		const end = note.tick + note.length;
		for (const stroke of track.pitchCurve) {
			if (stroke.length < 2) continue;
			const a = Math.max(note.tick, stroke[0].tick);
			// Up to the last tick of the note; the next note's deviation starts on its own first tick.
			const b = Math.min(end - 1, stroke[stroke.length - 1].tick);
			if (b - a < 1) continue;

			const run: CurvePoint[] = [];
			const at = (tick: number) => {
				let i = 1;
				while (i < stroke.length - 1 && stroke[i].tick < tick) i++;
				const p = stroke[i - 1];
				const q = stroke[i];
				const t = q.tick === p.tick ? 1 : clamp((tick - p.tick) / (q.tick - p.tick), 0, 1);
				return p.pitch + (q.pitch - p.pitch) * t;
			};
			const start = Math.ceil(a / PITD_INTERVAL) * PITD_INTERVAL;
			for (let x = start; x <= b; x += PITD_INTERVAL) {
				run.push({
					tick: x,
					pitch: clamp(Math.round((at(x) - note.pitch) * 100), -PITD_RANGE, PITD_RANGE)
				});
			}
			if (run.length < 1) continue;
			const thin = simplify(run, 1.5);

			const x0 = thin[0].tick;
			const x1 = thin[thin.length - 1].tick;
			// Zero guards keep the curve from sloping across the gaps (OpenUtau interpolates between points).
			if (xs.length && lastX >= x0 - PITD_INTERVAL && guards.has(lastX)) {
				xs.pop();
				ys.pop();
				guards.delete(lastX);
			}
			if (!xs.length || x0 - PITD_INTERVAL > xs[xs.length - 1]) {
				xs.push(x0 - PITD_INTERVAL);
				ys.push(0);
				guards.add(x0 - PITD_INTERVAL);
			}
			for (const p of thin) {
				if (p.tick <= xs[xs.length - 1]) continue;
				xs.push(p.tick);
				ys.push(p.pitch);
			}
			xs.push(x1 + PITD_INTERVAL);
			ys.push(0);
			guards.add(x1 + PITD_INTERVAL);
			lastX = x1 + PITD_INTERVAL;
		}
	}
	return xs.length ? { xs, ys } : null;
}

/** Serializes to an OpenUtau project (USTX 0.6, readable by every OpenUtau since 0.6). */
export function serializeUstx(input: UstxExportInput): { text: string; warnings: string[] } {
	const warnings: string[] = [];
	const droppedFlags = new Set<string>();
	const measure = (PPQ * 4 * input.timeSignature.numerator) / input.timeSignature.denominator;
	let overlapped = false;

	const voiceParts = input.tracks.map((track, index) => {
		const own = input.notes.filter((n) => n.track === track.id);
		const trimmed = trimOverlaps(own);
		if (trimmed.some((n, i) => n.length !== own[i].length)) overlapped = true;
		const sorted = sortNotes(trimmed);
		const end = sorted.reduce((m, n) => Math.max(m, n.tick + n.length), 0);

		const ustxNotes = sorted.map((n) => {
			const points = [...n.pitchPoints].sort((a, b) => a.x - b.x);
			const data = points.length
				? points.map((p) => ({
						x: Math.round(p.x * 100) / 100,
						y: p.y / 10,
						shape: shapeToUstx(p.shape)
					}))
				: [
						{ x: -25, y: 0, shape: 'io' },
						{ x: 25, y: 0, shape: 'io' }
					];
			if (data.length === 1) data.push({ ...data[0], x: data[0].x + 1 });

			const v = n.vibrato;
			const expressions: { index: number; abbr: string; value: number }[] = [];
			const express = (abbr: string, value: number) =>
				expressions.push({ index: 0, abbr, value: Math.round(value * 100) / 100 });
			if (n.velocity !== 100) express('vel', clamp(n.velocity, 0, 200));
			if (n.volume !== 100) express('vol', clamp(n.volume, 0, 200));
			if (n.modulation !== 0) express('mod', clamp(n.modulation, 0, 100));
			for (const [flag, abbr] of Object.entries(FLAG_EXPRESSIONS)) {
				const value = getFlag(n.flags, flag);
				if (value !== undefined && value !== 0) express(abbr, value);
			}
			for (const m of n.flags.matchAll(/[A-Za-z]+/g)) {
				if (!FLAG_EXPRESSIONS[m[0]]) droppedFlags.add(m[0]);
			}

			return {
				position: n.tick,
				duration: n.length,
				tone: n.pitch,
				lyric: n.lyric || 'a',
				pitch: { data, snap_first: false },
				vibrato: {
					length: v ? v.length : 0,
					period: v ? v.period : 175,
					depth: v ? Math.max(5, v.depth) : 25,
					in: v ? v.fadeIn : 10,
					out: v ? v.fadeOut : 10,
					shift: v ? v.phase : 0,
					drift: 0,
					vol_link: 0
				},
				phoneme_expressions: expressions,
				phoneme_overrides: []
			};
		});

		const pitd = trackToPitd(track, sorted);
		return {
			duration: Math.max(measure, Math.ceil(end / measure) * measure),
			name: track.name,
			comment: '',
			track_no: index,
			position: 0,
			notes: ustxNotes,
			curves: pitd ? [{ abbr: 'pitd', xs: pitd.xs, ys: pitd.ys }] : []
		};
	});

	const project = {
		name: input.name,
		comment: '',
		output_dir: 'Vocal',
		cache_dir: 'UCache',
		ustx_version: USTX_VERSION,
		tempos: input.tempos.map((t) => ({ position: t.tick, bpm: t.bpm })),
		time_signatures: [
			{
				bar_position: 0,
				beat_per_bar: input.timeSignature.numerator,
				beat_unit: input.timeSignature.denominator
			}
		],
		key: 0,
		tracks: input.tracks.map((t) => ({
			singer: input.voicebank,
			phonemizer: 'OpenUtau.Core.DefaultPhonemizer',
			track_name: t.name,
			track_color: colorName(t.color),
			mute: t.mute,
			solo: t.solo,
			volume: percentToDb(t.volume),
			pan: 0,
			track_expressions: [],
			voice_color_names: ['']
		})),
		voice_parts: voiceParts,
		wave_parts: []
	};

	if (overlapped)
		warnings.push('Overlapping notes were shortened: OpenUtau tracks hold one voice.');
	if (droppedFlags.size)
		warnings.push(
			`Flags without an OpenUtau expression were dropped: ${[...droppedFlags].join(', ')}.`
		);

	return { text: stringify(project, { indent: 2, lineWidth: 0 }), warnings };
}
