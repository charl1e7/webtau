import { describe, expect, it } from 'vitest';
import { TempoMap } from './tempo';
import { compilePitch } from './pitch';
import { createNote, createPitchPoint } from './music';
import { applyLyrics, splitLyrics } from './lyrics';
import { joinNotes, moveNotes, quantizeNotes, splitNote, trimOverlaps } from './ops';
import { History } from './history';

describe('TempoMap', () => {
	it('converts ticks and ms at constant tempo', () => {
		const m = new TempoMap([{ tick: 0, bpm: 120 }]);
		expect(m.tickToMs(480)).toBeCloseTo(500);
		expect(m.msToTick(1000)).toBeCloseTo(960);
	});

	it('handles tempo changes both ways', () => {
		const m = new TempoMap([
			{ tick: 0, bpm: 120 },
			{ tick: 480, bpm: 60 }
		]);
		expect(m.tickToMs(480)).toBeCloseTo(500);
		expect(m.tickToMs(960)).toBeCloseTo(1500);
		expect(m.msToTick(1500)).toBeCloseTo(960);
		expect(m.bpmAt(600)).toBe(60);
	});

	it('always starts at tick 0', () => {
		const m = new TempoMap([{ tick: 480, bpm: 90 }]);
		expect(m.changes[0]).toEqual({ tick: 0, bpm: 90 });
	});
});

describe('compilePitch', () => {
	it('is empty without pitch data', () => {
		expect(compilePitch({ pitchPoints: [], vibrato: null }, 500)).toEqual([]);
	});

	it('keeps linear points as they are', () => {
		const pts = [createPitchPoint(-50, -100), createPitchPoint(0, 0), createPitchPoint(200, 50)];
		const out = compilePitch({ pitchPoints: pts, vibrato: null }, 500);
		expect(out).toEqual([
			{ offset: -50, value: -100 },
			{ offset: 0, value: 0 },
			{ offset: 200, value: 50 }
		]);
	});

	it('expands curved segments and passes through endpoints', () => {
		const pts = [createPitchPoint(0, 0, 's'), createPitchPoint(100, 100)];
		const out = compilePitch({ pitchPoints: pts, vibrato: null }, 300);
		expect(out.length).toBeGreaterThan(5);
		const mid = out.find((p) => p.offset === 50)!;
		expect(mid.value).toBeCloseTo(50, 0);
		expect(out.at(-1)).toEqual({ offset: 100, value: 100 });
	});

	it('adds vibrato only near the end of the note', () => {
		const v = { length: 50, period: 100, depth: 50, fadeIn: 0, fadeOut: 0, phase: 0 };
		const out = compilePitch({ pitchPoints: [], vibrato: v }, 1000);
		expect(out.filter((p) => p.offset < 490).every((p) => p.value === 0)).toBe(true);
		expect(Math.max(...out.map((p) => p.value))).toBeGreaterThan(40);
	});
});

describe('lyrics', () => {
	it('splits kana into morae', () => {
		expect(splitLyrics('きゃく さくら')).toEqual(['きゃ', 'く', 'さ', 'く', 'ら']);
		expect(splitLyrics('la la, la')).toEqual(['la', 'la', 'la']);
	});

	it('optionally cuts unbroken romaji into syllables, leaving everything else alone', () => {
		const romaji = { romaji: true };
		expect(splitLyrics('sakura', romaji)).toEqual(['sa', 'ku', 'ra']);
		expect(splitLyrics('kyaku shinjitsu', romaji)).toEqual(['kya', 'ku', 'shi', 'n', 'ji', 'tsu']);
		expect(splitLyrics('hello + R ka[mi]', romaji)).toEqual(['hello', '+', 'R', 'ka[mi]']);
		expect(splitLyrics('sakura')).toEqual(['sakura']); // off by default
	});

	it('assigns syllables in time order', () => {
		const a = createNote({ tick: 480, pitch: 60 });
		const b = createNote({ tick: 0, pitch: 60 });
		const out = applyLyrics([a, b], new Set([a.id, b.id]), 'ka ki');
		expect(out.find((n) => n.id === b.id)!.lyric).toBe('ka');
		expect(out.find((n) => n.id === a.id)!.lyric).toBe('ki');
	});
});

describe('ops', () => {
	const mk = (tick: number, length: number, pitch = 60) => createNote({ tick, length, pitch });

	it('does not move notes before tick 0', () => {
		const n = mk(100, 100);
		expect(moveNotes([n], new Set([n.id]), -500, 0)[0].tick).toBe(0);
	});

	it('quantizes starts and ends', () => {
		const n = mk(130, 200);
		const q = quantizeNotes([n], new Set([n.id]), 120)[0];
		expect([q.tick, q.length]).toEqual([120, 240]);
	});

	it('splits and joins', () => {
		const n = mk(0, 480);
		const split = splitNote([n], n.id, 240);
		expect(split).toHaveLength(2);
		expect(split[1].lyric).toBe('+');
		const joined = joinNotes(split, new Set(split.map((s) => s.id)));
		expect(joined).toHaveLength(1);
		expect(joined[0].length).toBe(480);
	});

	it('trims overlaps', () => {
		const out = trimOverlaps([mk(0, 600), mk(480, 480)]);
		expect(out[0].length).toBe(480);
	});
});

describe('History', () => {
	it('undoes and redoes', () => {
		const h = new History<number>();
		h.record(1);
		expect(h.undo(2)).toBe(1);
		expect(h.redo(1)).toBe(2);
		expect(h.canRedo).toBe(false);
	});
});

import { getFlag, setFlag } from './flags';

describe('flags', () => {
	it('reads and writes numeric flags', () => {
		expect(getFlag('g-5B30', 'B')).toBe(30);
		expect(getFlag('g-5B30', 'g')).toBe(-5);
		expect(getFlag('g-5', 'B')).toBeUndefined();
		expect(setFlag('g-5B30', 'B', 50)).toBe('g-5B50');
		expect(setFlag('g-5B30', 'B', undefined)).toBe('g-5');
		expect(setFlag('', 't', -100)).toBe('t-100');
	});
});
