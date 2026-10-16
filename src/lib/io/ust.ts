import {
	PPQ,
	type Note,
	type PitchPoint,
	type PitchShape,
	type TempoChange,
	type Vibrato
} from '#lib/core/types';
import { createNote, createPitchPoint } from '#lib/core/music';
import { trimOverlaps, sortNotes } from '#lib/core/ops';
import { decodeText } from './text';

export interface UstImport {
	name: string;
	voicebank: string;
	tempos: TempoChange[];
	notes: Note[];
	warnings: string[];
}

interface Section {
	name: string;
	values: Map<string, string>;
}

function readSections(text: string): Section[] {
	const sections: Section[] = [];
	let current: Section | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const header = /^\[#(.+)\]$/.exec(line);
		if (header) {
			current = { name: header[1], values: new Map() };
			sections.push(current);
		} else if (current) {
			const eq = line.indexOf('=');
			if (eq > 0) current.values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
		}
	}
	return sections;
}

const num = (v: string | undefined, fallback: number): number => {
	if (v === undefined || v === '') return fallback;
	const n = Number(v.replace(',', '.'));
	return Number.isFinite(n) ? n : fallback;
};

const list = (v: string | undefined): string[] => (v === undefined || v === '' ? [] : v.split(','));

function shapeOf(code: string | undefined): PitchShape {
	const c = (code ?? '').trim();
	return c === 's' || c === 'r' || c === 'j' ? c : 'l';
}

function parsePitch(values: Map<string, string>, tempoBpm: number): PitchPoint[] {
	const pbs = values.get('PBS');
	if (pbs !== undefined && pbs !== '') {
		const [xs, ys] = pbs.split(';');
		const widths = list(values.get('PBW')).map((v) => num(v, 0));
		const ysList = list(values.get('PBY')).map((v) => num(v, 0));
		const shapes = list(values.get('PBM'));
		const points: PitchPoint[] = [];
		let x = num(xs, 0);
		points.push(createPitchPoint(x, num(ys, 0) * 10, shapeOf(shapes[0])));
		for (let i = 0; i < widths.length; i++) {
			x += widths[i];
			points.push(createPitchPoint(x, (ysList[i] ?? 0) * 10, shapeOf(shapes[i + 1])));
		}
		return points;
	}

	// Legacy format: one value (cents) every `PBType` ticks, starting at PBStart.
	const piches = list(values.get('Piches') ?? values.get('Pitches'));
	if (piches.length) {
		const stepTicks = num(values.get('PBType'), 5);
		const stepMs = (stepTicks * 60000) / (tempoBpm * PPQ);
		const start = num(values.get('PBStart'), 0) * stepMs;
		return piches.map((v, i) => createPitchPoint(start + i * stepMs, num(v, 0)));
	}
	return [];
}

function parseVibrato(v: string | undefined): Vibrato | null {
	const p = list(v).map((s) => num(s, 0));
	if (p.length < 5 || p[0] <= 0 || p[2] === 0) return null;
	return {
		length: p[0],
		period: p[1] || 180,
		depth: p[2],
		fadeIn: p[3],
		fadeOut: p[4],
		phase: p[5] ?? 0
	};
}

export function parseUst(input: Uint8Array | string): UstImport {
	const text = typeof input === 'string' ? input : decodeText(input);
	const sections = readSections(text);
	const warnings: string[] = [];

	const setting = sections.find((s) => s.name === 'SETTING')?.values ?? new Map<string, string>();
	let bpm = num(setting.get('Tempo'), 120);
	const tempos: TempoChange[] = [{ tick: 0, bpm }];

	const notes: Note[] = [];
	let tick = 0;
	for (const section of sections) {
		if (!/^\d+$/.test(section.name)) continue;
		const v = section.values;
		const length = Math.max(1, Math.round(num(v.get('Length'), PPQ)));
		if (v.has('Tempo')) {
			const t = num(v.get('Tempo'), bpm);
			if (t > 0 && t !== bpm) {
				bpm = t;
				tempos.push({ tick, bpm });
			}
		}
		const lyric = v.get('Lyric') ?? '';
		const isRest = lyric.toLowerCase() === 'r';
		notes.push(
			createNote({
				tick,
				length,
				pitch: Math.round(num(v.get('NoteNum'), 60)),
				lyric: isRest ? 'R' : lyric,
				velocity: num(v.get('Velocity'), 100),
				volume: num(v.get('Intensity'), 100),
				modulation: num(v.get('Moduration'), 0),
				flags: v.get('Flags') ?? '',
				pitchPoints: isRest ? [] : parsePitch(v, bpm),
				vibrato: isRest ? null : parseVibrato(v.get('VBR'))
			})
		);
		tick += length;
	}

	if (!notes.length) warnings.push('No notes found in the UST file.');
	const voiceDir = (setting.get('VoiceDir') ?? '').replace(/^%VOICE%/i, '').replace(/[\\/]+$/, '');
	const voicebank = voiceDir.split(/[\\/]/).pop() ?? '';

	return {
		name: setting.get('ProjectName') || 'Imported UST',
		voicebank,
		tempos,
		notes,
		warnings
	};
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

function shapeCode(shape: PitchShape): string {
	return shape === 'l' ? '' : shape;
}

/** Serializes to UST 2.0 (UTF-8). Overlaps are cut and gaps filled with rests. */
export function serializeUst(
	notesIn: readonly Note[],
	tempos: readonly TempoChange[],
	meta: { name: string; voicebank: string }
): { text: string; warnings: string[] } {
	const warnings: string[] = [];
	const sorted = sortNotes(notesIn);
	const notes = trimOverlaps(sorted);
	if (notes.some((n, i) => n.length !== sorted[i].length)) {
		warnings.push('Overlapping notes were shortened: UST supports only one voice.');
	}
	const bpm0 = tempos[0]?.bpm ?? 120;
	const tempoAt = new Map(tempos.slice(1).map((t) => [t.tick, t.bpm]));

	const out: string[] = [
		'[#VERSION]',
		'UST Version2.0',
		'Charset=UTF-8',
		'[#SETTING]',
		`Tempo=${bpm0.toFixed(2)}`,
		'Tracks=1',
		`ProjectName=${meta.name}`,
		`VoiceDir=%VOICE%${meta.voicebank}`,
		'OutFile=',
		'CacheDir=',
		'Tool1=wavtool.exe',
		'Tool2=resampler.exe',
		'Mode2=True'
	];

	let index = 0;
	const emit = (lines: string[]) => {
		out.push(`[#${String(index++).padStart(4, '0')}]`, ...lines);
	};

	let cursor = 0;
	let tempoCursor = 0;
	const tempoLines = (from: number, to: number): string[] => {
		// A tempo change belongs to the first emitted note starting at or after it.
		const lines: string[] = [];
		for (; tempoCursor < tempos.length - 1; tempoCursor++) {
			const t = tempos[tempoCursor + 1];
			if (t.tick > to - 1 && t.tick > from) break;
			lines.push(`Tempo=${tempoAt.get(t.tick)!.toFixed(2)}`);
		}
		return lines;
	};

	for (const n of notes) {
		if (n.tick > cursor) {
			emit([
				`Length=${n.tick - cursor}`,
				'Lyric=R',
				'NoteNum=60',
				...tempoLines(cursor, n.tick),
				'PreUtterance='
			]);
		}
		const lines = [
			`Length=${n.length}`,
			`Lyric=${n.lyric || 'a'}`,
			`NoteNum=${n.pitch}`,
			...tempoLines(n.tick, n.tick + n.length),
			'PreUtterance=',
			`Intensity=${fmt(n.volume)}`,
			`Moduration=${fmt(n.modulation)}`,
			`Velocity=${fmt(n.velocity)}`
		];
		if (n.flags) lines.push(`Flags=${n.flags}`);
		if (n.pitchPoints.length) {
			const pts = [...n.pitchPoints].sort((a, b) => a.x - b.x);
			lines.push(`PBS=${fmt(pts[0].x)};${fmt(pts[0].y / 10)}`);
			lines.push(
				`PBW=${pts
					.slice(1)
					.map((p, i) => fmt(p.x - pts[i].x))
					.join(',')}`
			);
			lines.push(
				`PBY=${pts
					.slice(1)
					.map((p) => fmt(p.y / 10))
					.join(',')}`
			);
			lines.push(`PBM=${pts.map((p) => shapeCode(p.shape)).join(',')}`);
		}
		if (n.vibrato) {
			const v = n.vibrato;
			lines.push(
				`VBR=${[v.length, v.period, v.depth, v.fadeIn, v.fadeOut, v.phase, 0, 0].map(fmt).join(',')}`
			);
		}
		emit(lines);
		cursor = n.tick + n.length;
	}
	out.push('[#TRACKEND]');
	return { text: out.join('\r\n') + '\r\n', warnings };
}
