import { MAX_PITCH, MIN_NOTE_TICKS, MIN_PITCH, type Note } from './types';
import { clamp, cloneNote, noteEnd, snap } from './music';

/**
 * Pure editing operations. Each returns a new array; notes that do not change
 * keep their identity so that snapshots in the undo history share memory.
 */

export function mapSelected(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	fn: (n: Note) => Note
): Note[] {
	return notes.map((n) => (ids.has(n.id) ? fn(n) : n));
}

export function sortNotes(notes: readonly Note[]): Note[] {
	return [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

export function moveNotes(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	dTick: number,
	dPitch: number
): Note[] {
	if (!dTick && !dPitch) return notes as Note[];
	// Never move a selection past the start of the song or off the keyboard.
	let minTick = Infinity;
	let minP = Infinity;
	let maxP = -Infinity;
	for (const n of notes) {
		if (!ids.has(n.id)) continue;
		minTick = Math.min(minTick, n.tick);
		minP = Math.min(minP, n.pitch);
		maxP = Math.max(maxP, n.pitch);
	}
	const dt = Math.max(dTick, -minTick);
	const dp = clamp(dPitch, MIN_PITCH - minP, MAX_PITCH - maxP);
	return mapSelected(notes, ids, (n) => ({ ...n, tick: n.tick + dt, pitch: n.pitch + dp }));
}

export function transposeNotes(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	semitones: number
) {
	return moveNotes(notes, ids, 0, semitones);
}

export function setLength(notes: readonly Note[], id: string, length: number): Note[] {
	return notes.map((n) => (n.id === id ? { ...n, length: Math.max(MIN_NOTE_TICKS, length) } : n));
}

/** Moves the left edge of a note, keeping its right edge fixed. */
export function setStart(notes: readonly Note[], id: string, tick: number): Note[] {
	return notes.map((n) => {
		if (n.id !== id) return n;
		const end = noteEnd(n);
		const start = clamp(tick, 0, end - MIN_NOTE_TICKS);
		return { ...n, tick: start, length: end - start };
	});
}

export function quantizeNotes(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	grid: number
): Note[] {
	return mapSelected(notes, ids, (n) => {
		const tick = Math.max(0, snap(n.tick, grid));
		const end = Math.max(tick + grid, snap(noteEnd(n), grid));
		return { ...n, tick, length: end - tick };
	});
}

export function splitNote(notes: readonly Note[], id: string, at: number): Note[] {
	const out: Note[] = [];
	for (const n of notes) {
		if (n.id === id && at > n.tick + MIN_NOTE_TICKS && at < noteEnd(n) - MIN_NOTE_TICKS) {
			const cut = at - n.tick;
			out.push({ ...n, length: cut });
			out.push(
				cloneNote(n, {
					tick: at,
					length: n.length - cut,
					pitchPoints: [],
					vibrato: null,
					lyric: '+'
				})
			);
		} else {
			out.push(n);
		}
	}
	return out;
}

/** Merges the selection into one note spanning from the first start to the last end. */
export function joinNotes(notes: readonly Note[], ids: ReadonlySet<string>): Note[] {
	const sel = notes.filter((n) => ids.has(n.id)).sort((a, b) => a.tick - b.tick);
	if (sel.length < 2) return notes as Note[];
	const first = sel[0];
	const end = Math.max(...sel.map(noteEnd));
	return notes
		.filter((n) => !ids.has(n.id) || n.id === first.id)
		.map((n) => (n.id === first.id ? { ...n, length: end - n.tick } : n));
}

/** Stretches every selected note up to the start of the next note. */
export function legato(notes: readonly Note[], ids: ReadonlySet<string>): Note[] {
	const sorted = sortNotes(notes);
	return notes.map((n) => {
		if (!ids.has(n.id)) return n;
		const next = sorted.find((o) => o.tick >= noteEnd(n) && o.id !== n.id);
		return next ? { ...n, length: next.tick - n.tick } : n;
	});
}

/** Cuts notes so that none overlaps its successor (UST is monophonic). */
export function trimOverlaps(notes: readonly Note[]): Note[] {
	const sorted = sortNotes(notes);
	const cut = new Map<string, number>();
	for (let i = 0; i < sorted.length - 1; i++) {
		const n = sorted[i];
		const next = sorted[i + 1];
		if (noteEnd(n) > next.tick) cut.set(n.id, Math.max(MIN_NOTE_TICKS, next.tick - n.tick));
	}
	return notes.map((n) => (cut.has(n.id) ? { ...n, length: cut.get(n.id)! } : n));
}

export function scaleLengths(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	factor: number
): Note[] {
	return mapSelected(notes, ids, (n) => ({
		...n,
		length: Math.max(MIN_NOTE_TICKS, Math.round(n.length * factor))
	}));
}

/** Copies the notes, placing the earliest one at `atTick`. */
export function pasteNotes(clipboard: readonly Note[], atTick: number): Note[] {
	if (!clipboard.length) return [];
	const base = Math.min(...clipboard.map((n) => n.tick));
	return clipboard.map((n) => cloneNote(n, { tick: Math.max(0, n.tick - base + atTick) }));
}

export function duplicateNotes(
	notes: readonly Note[],
	ids: ReadonlySet<string>
): { notes: Note[]; added: Note[] } {
	const sel = notes.filter((n) => ids.has(n.id));
	if (!sel.length) return { notes: notes as Note[], added: [] };
	const start = Math.min(...sel.map((n) => n.tick));
	const end = Math.max(...sel.map(noteEnd));
	const added = sel.map((n) => cloneNote(n, { tick: n.tick + (end - start) }));
	return { notes: [...notes, ...added], added };
}

export function notesInRange(
	notes: readonly Note[],
	tick0: number,
	tick1: number,
	pitch0: number,
	pitch1: number
): Note[] {
	const loP = Math.min(pitch0, pitch1);
	const hiP = Math.max(pitch0, pitch1);
	return notes.filter(
		(n) => n.tick < tick1 && noteEnd(n) > tick0 && n.pitch >= loP && n.pitch <= hiP
	);
}

export function songEndTick(notes: readonly Note[]): number {
	return notes.reduce((m, n) => Math.max(m, noteEnd(n)), 0);
}

/** Gives each selected note a pitch slide from the previous (touching) note. */
export function applyPortamento(
	notes: readonly Note[],
	ids: ReadonlySet<string>,
	slideMs: number,
	mk: (x: number, y: number, shape: 's' | 'l') => Note['pitchPoints'][number],
	maxGapTicks = 60
): Note[] {
	const sorted = sortNotes(notes);
	return notes.map((n) => {
		if (!ids.has(n.id)) return n;
		const idx = sorted.indexOf(n);
		const prev = idx > 0 ? sorted[idx - 1] : undefined;
		if (!prev || n.tick - noteEnd(prev) > maxGapTicks || prev.pitch === n.pitch) return n;
		const from = clamp((prev.pitch - n.pitch) * 100, -1200, 1200);
		return { ...n, pitchPoints: [mk(-slideMs, from, 's'), mk(0, 0, 'l')] };
	});
}
