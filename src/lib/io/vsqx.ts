import { PPQ, type Note, type TempoChange, type TimeSignature } from '#lib/core/types';
import { createNote } from '#lib/core/music';
import { sortNotes } from '#lib/core/ops';

export interface VsqxTrack {
	name: string;
	notes: Note[];
}

export interface VsqxImport {
	tempos: TempoChange[];
	timeSignature: TimeSignature;
	tracks: VsqxTrack[];
}

const blocks = (xml: string, tag: string): string[] =>
	[...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);

/** Text of the first `<tag>`, with CDATA unwrapped and XML entities decoded. */
function text(xml: string, tag: string): string | undefined {
	const raw = blocks(xml, tag)[0];
	if (raw === undefined) return undefined;
	const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw);
	const value = cdata ? cdata[1] : raw;
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.trim();
}

const num = (xml: string, tag: string, fallback = 0): number => {
	const v = Number(text(xml, tag));
	return Number.isFinite(v) ? v : fallback;
};

/** Parses VOCALOID3/4 project files (.vsqx): notes, lyrics, tempo and tracks. */
export function parseVsqx(xml: string): VsqxImport {
	if (!/<vsq[34]\b/.test(xml)) throw new Error('This is not a VSQX (VOCALOID 3/4) project.');

	const master = blocks(xml, 'masterTrack')[0] ?? '';
	const resolution = num(master, 'resolution', 480) || 480;
	const scale = PPQ / resolution;
	const sig = blocks(master, 'timeSig')[0];
	const timeSignature: TimeSignature = {
		numerator: sig ? num(sig, 'nume', 4) : 4,
		denominator: sig ? num(sig, 'denomi', 4) : 4
	};
	// Vocaloid projects start with silent "pre-measure" bars that are not part of the song.
	const preMeasure = num(master, 'preMeasure', 0);
	const shift = Math.round(
		preMeasure * ((resolution * 4 * timeSignature.numerator) / timeSignature.denominator)
	);
	const toTick = (t: number) => Math.max(0, Math.round((t - shift) * scale));

	const tempos: TempoChange[] = blocks(master, 'tempo')
		.map((t) => ({ tick: toTick(num(t, 'posTick')), bpm: num(t, 'bpm', 12000) / 100 }))
		.filter((t) => t.bpm > 0);
	if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 });

	const tracks: VsqxTrack[] = [];
	blocks(xml, 'vsTrack').forEach((track, index) => {
		const notes: Note[] = [];
		for (const part of blocks(track, 'musicalPart')) {
			const partStart = num(part, 'posTick');
			for (const n of blocks(part, 'note')) {
				const start = toTick(partStart + num(n, 'posTick'));
				const lyric = text(n, 'lyric') ?? text(n, 'y') ?? 'a';
				notes.push(
					createNote({
						tick: start,
						length: Math.max(1, Math.round(num(n, 'durTick', resolution) * scale)),
						pitch: num(n, 'noteNum', 60),
						lyric: lyric || 'a'
					})
				);
			}
		}
		if (notes.length)
			tracks.push({ name: text(track, 'name') || `Track ${index + 1}`, notes: sortNotes(notes) });
	});

	return { tempos, timeSignature, tracks };
}
