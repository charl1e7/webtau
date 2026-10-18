import {
	DEFAULT_TRACK_ID,
	PPQ,
	type Note,
	type ProjectData,
	type TempoChange,
	type Track
} from '#lib/core/types';
import { createTrack } from '#lib/core/music';
import { uid } from '#lib/core/ids';

const FORMAT = 'webtau-project';
const VERSION = 1;

export function serializeProject(data: ProjectData): string {
	return JSON.stringify({ format: FORMAT, version: VERSION, ppq: PPQ, ...data }, null, '\t');
}

/** `value` when it is a finite number (or a numeric string), else the fallback. */
function finite(value: unknown, fallback: number): number {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function normalizeNote(raw: Partial<Note>): Note {
	return {
		id: uid(),
		track: raw.track ?? DEFAULT_TRACK_ID,
		tick: Math.max(0, Math.round(finite(raw.tick, 0))),
		length: Math.max(1, Math.round(finite(raw.length, PPQ / 2))),
		pitch: Math.round(finite(raw.pitch, 60)),
		lyric: typeof raw.lyric === 'string' ? raw.lyric : 'a',
		velocity: finite(raw.velocity, 100),
		volume: finite(raw.volume, 100),
		modulation: finite(raw.modulation, 0),
		flags: typeof raw.flags === 'string' ? raw.flags : '',
		pitchPoints: (Array.isArray(raw.pitchPoints) ? raw.pitchPoints : []).map((p) => ({
			id: uid(),
			x: finite(p?.x, 0),
			y: finite(p?.y, 0),
			shape: p?.shape ?? 'l'
		})),
		vibrato: raw.vibrato && typeof raw.vibrato === 'object' ? { ...raw.vibrato } : null
	};
}

function normalizeTempos(raw: unknown): TempoChange[] {
	const list = (Array.isArray(raw) ? raw : [])
		.map((t: { tick?: unknown; bpm?: unknown }) => ({
			tick: Math.max(0, Math.round(finite(t?.tick, 0))),
			bpm: finite(t?.bpm, 0)
		}))
		.filter((t) => t.bpm > 0)
		.sort((a, b) => a.tick - b.tick);
	return list.length ? list : [{ tick: 0, bpm: 120 }];
}

function normalizeCurve(raw: unknown): Track['pitchCurve'] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((stroke) =>
			Array.isArray(stroke)
				? stroke
						.filter((p) => Number.isFinite(p?.tick) && Number.isFinite(p?.pitch))
						.map((p) => ({ tick: p.tick as number, pitch: p.pitch as number }))
				: []
		)
		.filter((stroke) => stroke.length >= 1);
}

export function parseProject(text: string): ProjectData {
	const raw = JSON.parse(text);
	if (raw?.format !== FORMAT) throw new Error('This is not a WebTAU project file.');
	const tracks: Track[] = raw.tracks?.length
		? raw.tracks.map((t: Partial<Track>, i: number) =>
				createTrack(i, {
					...t,
					id: t.id ?? createTrack(i).id,
					pitchCurve: normalizeCurve(t.pitchCurve)
				})
			)
		: [createTrack(0)];
	return {
		name: raw.name ?? 'Untitled',
		tracks,
		notes: (raw.notes ?? []).map(normalizeNote),
		tempos: normalizeTempos(raw.tempos),
		timeSignature: raw.timeSignature ?? { numerator: 4, denominator: 4 },
		voicebank: raw.voicebank ?? ''
	};
}
