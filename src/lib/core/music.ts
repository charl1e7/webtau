import {
	DEFAULT_TRACK_ID,
	PPQ,
	type Note,
	type PitchPoint,
	type Track,
	type Vibrato
} from './types';
import { uid } from './ids';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

export function noteName(midi: number): string {
	return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
	return BLACK.has(((midi % 12) + 12) % 12);
}

export function midiToHz(midi: number): number {
	return 440 * 2 ** ((midi - 69) / 12);
}

export const DEFAULT_VIBRATO: Vibrato = {
	length: 65,
	period: 180,
	depth: 35,
	fadeIn: 20,
	fadeOut: 20,
	phase: 0
};

export function createNote(init: Partial<Note> & Pick<Note, 'tick' | 'pitch'>): Note {
	return {
		id: uid(),
		track: DEFAULT_TRACK_ID,
		length: PPQ / 2,
		lyric: 'a',
		velocity: 100,
		volume: 100,
		modulation: 0,
		flags: '',
		pitchPoints: [],
		vibrato: null,
		...init
	};
}

export function createPitchPoint(
	x: number,
	y: number,
	shape: PitchPoint['shape'] = 'l'
): PitchPoint {
	return { id: uid(), x, y, shape };
}

export function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

/** Rounds `value` to the nearest multiple of `step`. */
export function snap(value: number, step: number): number {
	return Math.round(value / step) * step;
}

export function noteEnd(note: Note): number {
	return note.tick + note.length;
}

/** Ticks of one grid cell for a "1/N" note grid. */
export function gridTicks(division: number): number {
	return (PPQ * 4) / division;
}

/** Deep-enough clone of a note with a fresh id and fresh pitch point ids. */
export function cloneNote(note: Note, overrides: Partial<Note> = {}): Note {
	return {
		...note,
		id: uid(),
		pitchPoints: note.pitchPoints.map((p) => ({ ...p, id: uid() })),
		vibrato: note.vibrato ? { ...note.vibrato } : null,
		...overrides
	};
}

/** Colours offered for tracks; the first one is the classic pink. */
export const TRACK_COLORS = [
	'#ee2a79',
	'#3b9dff',
	'#2ecf8f',
	'#ffa628',
	'#a56bff',
	'#f0d43a',
	'#ff6a4d',
	'#27c7d9'
];

export function createTrack(index: number, init: Partial<Track> = {}): Track {
	return {
		id: index === 0 ? DEFAULT_TRACK_ID : uid(),
		name: `Track ${index + 1}`,
		color: TRACK_COLORS[index % TRACK_COLORS.length],
		mute: false,
		solo: false,
		volume: 100,
		...init
	};
}

/** Mixes `hex` (#rrggbb) towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;
	const n = parseInt(m[1], 16);
	const target = amount >= 0 ? 255 : 0;
	const t = Math.abs(amount);
	const mix = (c: number) => Math.round(c + (target - c) * t);
	const r = mix((n >> 16) & 255);
	const g = mix((n >> 8) & 255);
	const b = mix(n & 255);
	return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
