import { DEFAULT_TRACK_ID, PPQ, type Note, type ProjectData, type Track } from '#lib/core/types';
import { createTrack } from '#lib/core/music';
import { uid } from '#lib/core/ids';

const FORMAT = 'webtau-project';
const VERSION = 1;

export function serializeProject(data: ProjectData): string {
	return JSON.stringify({ format: FORMAT, version: VERSION, ppq: PPQ, ...data }, null, '\t');
}

function normalizeNote(raw: Partial<Note>): Note {
	return {
		id: uid(),
		track: raw.track ?? DEFAULT_TRACK_ID,
		tick: Math.max(0, Math.round(raw.tick ?? 0)),
		length: Math.max(1, Math.round(raw.length ?? PPQ / 2)),
		pitch: Math.round(raw.pitch ?? 60),
		lyric: raw.lyric ?? 'a',
		velocity: raw.velocity ?? 100,
		volume: raw.volume ?? 100,
		modulation: raw.modulation ?? 0,
		flags: raw.flags ?? '',
		pitchPoints: (raw.pitchPoints ?? []).map((p) => ({
			id: uid(),
			x: p.x ?? 0,
			y: p.y ?? 0,
			shape: p.shape ?? 'l'
		})),
		vibrato: raw.vibrato ? { ...raw.vibrato } : null
	};
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
		.filter((stroke) => stroke.length >= 2);
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
		tempos: raw.tempos?.length ? raw.tempos : [{ tick: 0, bpm: 120 }],
		timeSignature: raw.timeSignature ?? { numerator: 4, denominator: 4 },
		voicebank: raw.voicebank ?? ''
	};
}
