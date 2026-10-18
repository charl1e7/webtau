import { describe, expect, it } from 'vitest';
import { forSeeds, type Rng } from '../testing/rng';
import { MAX_PITCH, MIN_NOTE_TICKS, MIN_PITCH, PPQ, type Note } from './types';
import { TempoMap } from './tempo';
import { createNote, createPitchPoint, noteEnd } from './music';
import {
	applyPortamento,
	duplicateNotes,
	joinNotes,
	legato,
	moveNotes,
	notesInRange,
	pasteNotes,
	quantizeNotes,
	scaleLengths,
	setLength,
	setStart,
	songEndTick,
	sortNotes,
	splitNote,
	transposeNotes,
	trimOverlaps
} from './ops';

const randomMap = (r: Rng) => {
	const changes = Array.from({ length: r.int(1, 6) }, () => ({
		tick: r.int(0, 20000),
		bpm: r.float(30, 300)
	}));
	return new TempoMap(changes);
};

describe('TempoMap properties', () => {
	it('ticks → ms → ticks returns to where it started', () => {
		forSeeds(200, (r) => {
			const m = randomMap(r);
			for (let i = 0; i < 20; i++) {
				const t = r.float(0, 40000);
				expect(m.msToTick(m.tickToMs(t))).toBeCloseTo(t, 4);
			}
		});
	});

	it('time never runs backwards and a faster tempo makes a note shorter', () => {
		forSeeds(100, (r) => {
			const m = randomMap(r);
			let prev = -1;
			for (let t = 0; t < 30000; t += r.int(1, 700)) {
				const ms = m.tickToMs(t);
				expect(ms).toBeGreaterThanOrEqual(prev);
				prev = ms;
			}
		});
		const slow = new TempoMap([{ tick: 0, bpm: 60 }]);
		const fast = new TempoMap([{ tick: 0, bpm: 240 }]);
		expect(slow.tickToMs(PPQ)).toBeCloseTo(1000);
		expect(fast.tickToMs(PPQ)).toBeCloseTo(250);
	});

	it('the sum of the parts is the whole across a tempo change', () => {
		const m = new TempoMap([
			{ tick: 0, bpm: 100 },
			{ tick: 960, bpm: 200 }
		]);
		const whole = m.tickToMs(2000);
		const a = m.tickToMs(960) - m.tickToMs(0);
		const b = m.tickToMs(2000) - m.tickToMs(960);
		expect(a + b).toBeCloseTo(whole, 6);
		expect(m.tickToMs(960 + 480) - m.tickToMs(960)).toBeCloseTo(300, 6);
	});

	it('tolerates rubbish: unsorted, duplicates, zero / negative / NaN tempos, nothing at all', () => {
		expect(new TempoMap([]).tickToMs(480)).toBeCloseTo(500);
		expect(new TempoMap([{ tick: 0, bpm: 0 }]).firstBpm).toBe(120);
		expect(new TempoMap([{ tick: 0, bpm: -5 }]).firstBpm).toBe(120);
		expect(new TempoMap([{ tick: 0, bpm: NaN }]).firstBpm).toBe(120);
		const m = new TempoMap([
			{ tick: 960, bpm: 60 },
			{ tick: 0, bpm: 120 },
			{ tick: 960, bpm: 240 }
		]);
		expect(m.changes).toEqual([
			{ tick: 0, bpm: 120 },
			{ tick: 960, bpm: 240 }
		]);
		expect(m.bpmAt(959)).toBe(120);
		expect(m.bpmAt(960)).toBe(240);
	});

	it('negative ticks and times extrapolate the first tempo instead of breaking', () => {
		const m = new TempoMap([{ tick: 0, bpm: 120 }]);
		expect(m.tickToMs(-480)).toBeCloseTo(-500);
		expect(m.msToTick(-500)).toBeCloseTo(-480);
	});
});

// ---- editing operations -----------------------------------------------------------------

let n = 0;
const note = (tick: number, length: number, pitch = 60, extra: Partial<Note> = {}) =>
	createNote({ id: `n${n++}`, tick, length, pitch, ...extra });
const ids = (...list: Note[]) => new Set(list.map((x) => x.id));

describe('moveNotes', () => {
	it('keeps the selection together and inside the song and keyboard', () => {
		forSeeds(200, (r) => {
			const notes = Array.from({ length: r.int(1, 8) }, () =>
				note(r.int(0, 3000), r.int(15, 800), r.int(MIN_PITCH, MAX_PITCH))
			);
			const sel = new Set(notes.filter(() => r.bool(0.6)).map((x) => x.id));
			const dT = r.int(-4000, 4000);
			const dP = r.int(-60, 60);
			const moved = moveNotes(notes, sel, dT, dP);
			const picked = notes.filter((x) => sel.has(x.id));
			for (const orig of notes) {
				const after = moved.find((x) => x.id === orig.id)!;
				if (!sel.has(orig.id)) {
					expect(after).toBe(orig);
					continue;
				}
				expect(after.tick).toBeGreaterThanOrEqual(0);
				expect(after.pitch).toBeGreaterThanOrEqual(MIN_PITCH);
				expect(after.pitch).toBeLessThanOrEqual(MAX_PITCH);
				expect(after.length).toBe(orig.length);
			}
			if (picked.length > 1) {
				const a = moved.find((x) => x.id === picked[0].id)!;
				const b = moved.find((x) => x.id === picked[1].id)!;
				expect(b.tick - a.tick).toBe(picked[1].tick - picked[0].tick);
				expect(b.pitch - a.pitch).toBe(picked[1].pitch - picked[0].pitch);
			}
		});
	});

	it('returns the very same array when nothing moves, and ignores an empty selection', () => {
		const list = [note(0, 100)];
		expect(moveNotes(list, ids(list[0]), 0, 0)).toBe(list);
		expect(moveNotes(list, new Set(), 100, 5).map((x) => x.tick)).toEqual([0]);
	});

	it('transposing is moving in pitch only', () => {
		const a = note(10, 100, 60);
		expect(transposeNotes([a], ids(a), 12)[0]).toMatchObject({ tick: 10, pitch: 72 });
		expect(transposeNotes([a], ids(a), 500)[0].pitch).toBe(MAX_PITCH);
		expect(transposeNotes([a], ids(a), -500)[0].pitch).toBe(MIN_PITCH);
	});
});

describe('resizing', () => {
	it('setLength never goes below the minimum', () => {
		const a = note(0, 480);
		expect(setLength([a], a.id, 1)[0].length).toBe(MIN_NOTE_TICKS);
		expect(setLength([a], a.id, -50)[0].length).toBe(MIN_NOTE_TICKS);
		expect(setLength([a], a.id, 960)[0].length).toBe(960);
	});

	it('setStart keeps the right edge, the minimum length and tick ≥ 0', () => {
		forSeeds(200, (r) => {
			const a = note(r.int(0, 2000), r.int(15, 900));
			const out = setStart([a], a.id, r.int(-500, 5000))[0];
			expect(noteEnd(out)).toBe(noteEnd(a));
			expect(out.tick).toBeGreaterThanOrEqual(0);
			expect(out.length).toBeGreaterThanOrEqual(MIN_NOTE_TICKS);
		});
	});

	it('scaleLengths rounds and keeps the minimum', () => {
		const a = note(0, 100);
		expect(scaleLengths([a], ids(a), 0.01)[0].length).toBe(MIN_NOTE_TICKS);
		expect(scaleLengths([a], ids(a), 1.5)[0].length).toBe(150);
		expect(scaleLengths([a], ids(a), 0)[0].length).toBe(MIN_NOTE_TICKS);
	});
});

describe('quantizeNotes', () => {
	it('puts starts and ends on the grid and never makes a note shorter than one cell', () => {
		forSeeds(200, (r) => {
			const grid = r.pick([15, 30, 60, 120, 240, 480]);
			const a = note(r.int(0, 5000), r.int(15, 2000));
			const q = quantizeNotes([a], ids(a), grid)[0];
			expect(q.tick % grid).toBe(0);
			expect(noteEnd(q) % grid).toBe(0);
			expect(q.length).toBeGreaterThanOrEqual(grid);
			expect(Math.abs(q.tick - a.tick)).toBeLessThanOrEqual(grid / 2);
		});
	});
});

describe('splitNote / joinNotes', () => {
	it('splitting preserves the total span and puts a continuation after the cut', () => {
		forSeeds(200, (r) => {
			const a = note(r.int(0, 1000), r.int(100, 1500), 60, { lyric: 'ka' });
			const at = a.tick + r.int(-50, a.length + 50);
			const out = splitNote([a], a.id, at);
			if (out.length === 1) {
				expect(out[0]).toBe(a);
				return;
			}
			expect(out).toHaveLength(2);
			expect(out[0].tick).toBe(a.tick);
			expect(noteEnd(out[0])).toBe(out[1].tick);
			expect(noteEnd(out[1])).toBe(noteEnd(a));
			expect(out[1].lyric).toBe('+');
			expect(out[0].length).toBeGreaterThanOrEqual(MIN_NOTE_TICKS);
			expect(out[1].length).toBeGreaterThanOrEqual(MIN_NOTE_TICKS);
			expect(out[1].id).not.toBe(out[0].id);
		});
	});

	it('refuses to cut so close to an edge that a sliver would result', () => {
		const a = note(0, 480);
		expect(splitNote([a], a.id, 0)).toHaveLength(1);
		expect(splitNote([a], a.id, MIN_NOTE_TICKS)).toHaveLength(1);
		expect(splitNote([a], a.id, 480 - MIN_NOTE_TICKS)).toHaveLength(1);
		expect(splitNote([a], a.id, MIN_NOTE_TICKS + 1)).toHaveLength(2);
	});

	it('the right part does not inherit the pitch points and vibrato of the left one', () => {
		const a = note(0, 960, 60, {
			pitchPoints: [createPitchPoint(0, 100)],
			vibrato: { length: 50, period: 150, depth: 30, fadeIn: 0, fadeOut: 0, phase: 0 }
		});
		const [left, right] = splitNote([a], a.id, 480);
		expect(left.pitchPoints).toHaveLength(1);
		expect(right.pitchPoints).toEqual([]);
		expect(right.vibrato).toBeNull();
	});

	it('join spans first start to last end and removes the rest', () => {
		const a = note(0, 100);
		const b = note(300, 100);
		const c = note(150, 50);
		const other = note(1000, 10);
		const out = joinNotes([a, b, c, other], ids(a, b, c));
		expect(out.map((x) => x.id)).toEqual([a.id, other.id]);
		expect(out[0].length).toBe(400);
		expect(joinNotes([a, b], ids(a))).toEqual([a, b]);
	});
});

describe('legato / trimOverlaps', () => {
	it('legato stretches a note up to the next one and leaves the last alone', () => {
		const a = note(0, 100);
		const b = note(300, 100);
		const out = legato([a, b], ids(a, b));
		expect(out[0].length).toBe(300);
		expect(out[1].length).toBe(100);
	});

	it('legato does not stretch over a note that starts earlier than its end', () => {
		const a = note(0, 200);
		const b = note(100, 100); // overlaps a
		const c = note(400, 50);
		expect(legato([a, b, c], ids(a))[0].length).toBe(400);
	});

	it('trimOverlaps leaves no overlap between notes that have room', () => {
		forSeeds(200, (r) => {
			const notes = Array.from({ length: r.int(2, 10) }, () =>
				note(r.int(0, 3000), r.int(15, 900), r.int(40, 80))
			);
			const out = sortNotes(trimOverlaps(notes));
			for (let i = 0; i < out.length - 1; i++) {
				// The minimum length wins over trimming, so only check where there is room.
				if (out[i + 1].tick - out[i].tick >= MIN_NOTE_TICKS)
					expect(noteEnd(out[i])).toBeLessThanOrEqual(out[i + 1].tick);
			}
		});
	});

	it('notes starting on the same tick still overlap by at most the minimum length', () => {
		const a = note(0, 480, 60);
		const b = note(0, 480, 64);
		const out = sortNotes(trimOverlaps([a, b]));
		expect(out[0].length).toBe(MIN_NOTE_TICKS);
	});
});

describe('clipboard operations', () => {
	it('paste places the earliest note at the target and keeps the spacing, with new ids', () => {
		const a = note(100, 50);
		const b = note(400, 50);
		const out = pasteNotes([b, a], 1000);
		expect(out.map((x) => x.tick).sort((x, y) => x - y)).toEqual([1000, 1300]);
		expect(out.every((x) => x.id !== a.id && x.id !== b.id)).toBe(true);
		expect(pasteNotes([], 5)).toEqual([]);
		expect(pasteNotes([a], -50)[0].tick).toBe(0);
	});

	it('duplicate puts a copy right after the selection', () => {
		const a = note(0, 100);
		const b = note(200, 100);
		const { notes, added } = duplicateNotes([a, b], ids(a, b));
		expect(added.map((x) => x.tick)).toEqual([300, 500]);
		expect(notes).toHaveLength(4);
		expect(duplicateNotes([a], new Set()).added).toEqual([]);
	});

	it('notesInRange is half-open in time and inclusive in pitch', () => {
		const a = note(0, 100, 60);
		const b = note(100, 100, 61);
		expect(notesInRange([a, b], 100, 200, 0, 127)).toEqual([b]);
		expect(notesInRange([a, b], 0, 100, 61, 60)).toEqual([a]);
		expect(notesInRange([a, b], 99, 101, 0, 127)).toHaveLength(2);
	});

	it('songEndTick of nothing is zero', () => {
		expect(songEndTick([])).toBe(0);
		expect(songEndTick([note(10, 20), note(0, 5)])).toBe(30);
	});
});

describe('applyPortamento', () => {
	const mk = (x: number, y: number, shape: 's' | 'l') => createPitchPoint(x, y, shape);

	it('slides in from the previous touching note, only when the pitch differs', () => {
		const a = note(0, 480, 60);
		const b = note(480, 480, 65);
		const c = note(960, 480, 65);
		const far = note(3000, 480, 50);
		const out = applyPortamento([a, b, c, far], ids(a, b, c, far), 80, mk);
		expect(out[0].pitchPoints).toEqual([]); // first note
		expect(out[1].pitchPoints.map((p) => [p.x, p.y])).toEqual([
			[-80, -500],
			[0, 0]
		]);
		expect(out[2]).toBe(c); // same pitch
		expect(out[3]).toBe(far); // too far away
	});

	it('clamps a huge leap to an octave', () => {
		const a = note(0, 480, 100);
		const b = note(480, 480, 20);
		const out = applyPortamento([a, b], ids(b), 80, mk);
		expect(out[1].pitchPoints[0].y).toBe(1200);
	});
});
