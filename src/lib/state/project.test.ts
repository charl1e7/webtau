import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forSeeds, type Rng } from '../testing/rng';
import { createNote, createPitchPoint } from '#lib/core/music';
import { PPQ, type Note } from '#lib/core/types';
import { project } from './project.svelte';

beforeEach(() => {
	project.load({ name: 'T', notes: [] });
	project.clipboard = [];
});
afterEach(() => vi.useRealTimers());

const state = () =>
	JSON.stringify({
		notes: project.notes.map((n) => ({
			...n,
			pitchPoints: n.pitchPoints.map((p) => [p.x, p.y, p.shape])
		})),
		tracks: project.tracks,
		tempos: project.tempos,
		ts: project.timeSignature
	});

/** A random edit through the public API; returns false when the store refused to do anything. */
function randomEdit(r: Rng) {
	const notes = project.notes;
	const pick = () => (notes.length ? notes[r.int(0, notes.length - 1)] : undefined);
	switch (r.int(0, 13)) {
		case 0:
		case 1:
			project.addNote({
				tick: r.int(0, 8000),
				pitch: r.int(40, 90),
				length: r.int(30, 960),
				lyric: r.pick(['a', 'ka', 'ら'])
			});
			break;
		case 2: {
			const n = pick();
			if (n) project.updateNote(n.id, { pitch: r.int(40, 90) });
			break;
		}
		case 3: {
			const n = pick();
			if (n) project.deleteNotes(new Set([n.id]));
			break;
		}
		case 4:
			project.selectAll();
			project.copy();
			project.paste(r.int(0, 9000));
			break;
		case 5: {
			const n = pick();
			if (n) project.select([n.id]);
			project.cut();
			break;
		}
		case 6:
			project.setTempo(r.int(20, 400), r.pick([0, 480, 960, 2400]));
			break;
		case 7:
			project.removeTempo(r.pick([480, 960, 2400]));
			break;
		case 8:
			project.addTrack();
			break;
		case 9:
			project.removeTrack(project.tracks[r.int(0, project.tracks.length - 1)].id);
			break;
		case 10:
			project.updateTrack(project.tracks[0].id, { mute: r.bool(), volume: r.int(0, 150) });
			break;
		case 11: {
			const n = pick();
			if (n) {
				project.select([n.id]);
				project.moveSelectionToTrack(project.tracks[r.int(0, project.tracks.length - 1)].id);
			}
			break;
		}
		case 12:
			project.setTimeSignature(r.int(1, 12), r.pick([2, 4, 8]));
			break;
		default: {
			const n = pick();
			if (n) {
				project.beginGesture();
				project.preview((all) => all.map((x) => (x.id === n.id ? { ...x, tick: x.tick + 10 } : x)));
				project.preview((all) => all.map((x) => (x.id === n.id ? { ...x, tick: x.tick + 40 } : x)));
				if (r.bool()) project.endGesture();
				else project.cancelGesture();
			}
		}
	}
}

function expectConsistent() {
	expect(project.tracks.length).toBeGreaterThanOrEqual(1);
	const ids = new Set(project.tracks.map((t) => t.id));
	expect(ids.size).toBe(project.tracks.length);
	expect(ids.has(project.activeTrack)).toBe(true);
	for (const n of project.notes)
		expect(ids.has(n.track), `note ${n.id} on unknown track ${n.track}`).toBe(true);
	const noteIds = new Set(project.notes.map((n) => n.id));
	expect(noteIds.size).toBe(project.notes.length);
	for (const s of project.selection) expect(noteIds.has(s)).toBe(true);
	expect(project.tempos[0].tick).toBe(0);
	for (const t of project.tempos) expect(t.bpm).toBeGreaterThan(0);
}

describe('history', () => {
	it('undoing every step returns to the start and redoing every step returns to the end', () => {
		vi.useFakeTimers();
		forSeeds(120, (r) => {
			project.load({ name: 'H', notes: [] });
			const start = state();
			const steps = r.int(1, 25);
			for (let i = 0; i < steps; i++) {
				vi.advanceTimersByTime(2000); // no coalescing here
				randomEdit(r);
				expectConsistent();
			}
			const end = state();
			let guard = 0;
			while (project.canUndo && guard++ < 500) {
				project.undo();
				expectConsistent();
			}
			expect(state()).toBe(start);
			guard = 0;
			while (project.canRedo && guard++ < 500) {
				project.redo();
				expectConsistent();
			}
			expect(state()).toBe(end);
		});
	});

	it('a new edit after an undo drops the redo branch', () => {
		project.addNote({ tick: 0, pitch: 60 });
		project.addNote({ tick: 480, pitch: 62 });
		project.undo();
		expect(project.canRedo).toBe(true);
		project.addNote({ tick: 960, pitch: 64 });
		expect(project.canRedo).toBe(false);
		project.redo();
		expect(project.notes.map((n) => n.pitch).sort()).toEqual([60, 64]);
	});

	it('undo and redo with nothing to do are harmless', () => {
		const before = state();
		project.undo();
		project.redo();
		expect(state()).toBe(before);
		expect(project.canUndo || project.canRedo).toBe(false);
	});

	it('quick edits of the same kind make one step, slow ones or other kinds make several', () => {
		vi.useFakeTimers();
		const n = project.addNote({ tick: 0, pitch: 60, lyric: 'a' });
		vi.advanceTimersByTime(2000);
		project.updateNote(n.id, { lyric: 'k' }, 'lyric');
		vi.advanceTimersByTime(100);
		project.updateNote(n.id, { lyric: 'ka' }, 'lyric');
		vi.advanceTimersByTime(100);
		project.updateNote(n.id, { lyric: 'kam' }, 'lyric');
		project.undo(); // all three typed changes at once
		expect(project.notes[0].lyric).toBe('a');
		project.redo();
		vi.advanceTimersByTime(2000);
		project.updateNote(n.id, { lyric: 'kami' }, 'lyric');
		project.undo();
		expect(project.notes[0].lyric).toBe('kam');
		project.updateNote(n.id, { pitch: 61 }, 'pitch');
		project.updateNote(n.id, { lyric: 'x' }, 'lyric');
		project.undo();
		expect(project.notes[0]).toMatchObject({ pitch: 61, lyric: 'kam' });
	});

	it('a drag is one step, and cancelling leaves nothing behind', () => {
		const n = project.addNote({ tick: 0, pitch: 60 });
		const undoable = () => {
			let steps = 0;
			while (project.canUndo) {
				project.undo();
				steps++;
			}
			return steps;
		};
		project.beginGesture();
		for (let i = 1; i <= 20; i++)
			project.preview((all) => all.map((x) => (x.id === n.id ? { ...x, tick: i * 10 } : x)));
		project.endGesture();
		expect(project.notes[0].tick).toBe(200);
		project.beginGesture();
		project.preview((all) => all.map((x) => ({ ...x, tick: 999 })));
		project.cancelGesture();
		expect(project.notes[0].tick).toBe(200);
		expect(undoable()).toBe(2); // adding the note and the drag
		expect(project.notes).toEqual([]);
	});

	it('a gesture that changed nothing does not create a step', () => {
		project.addNote({ tick: 0, pitch: 60 });
		project.load({ name: 'x', notes: project.notes });
		project.beginGesture();
		project.endGesture();
		expect(project.canUndo).toBe(false);
	});

	it('the history is bounded', () => {
		vi.useFakeTimers();
		const n = project.addNote({ tick: 0, pitch: 60 });
		for (let i = 0; i < 300; i++) {
			vi.advanceTimersByTime(2000);
			project.updateNote(n.id, { pitch: 40 + (i % 40) });
		}
		let steps = 0;
		while (project.canUndo) {
			project.undo();
			steps++;
		}
		expect(steps).toBeLessThanOrEqual(200);
		expect(steps).toBeGreaterThan(100);
	});

	it('loading a project clears history and marks it clean', () => {
		project.addNote({ tick: 0, pitch: 60 });
		expect(project.dirty).toBe(true);
		project.load({ name: 'n', notes: [createNote({ tick: 0, pitch: 61 })] });
		expect(project.canUndo).toBe(false);
		expect(project.dirty).toBe(false);
		expect(project.name).toBe('n');
		const rev = project.revision;
		project.addNote({ tick: 0, pitch: 62 });
		expect(project.revision).toBeGreaterThan(rev);
	});
});

describe('tracks', () => {
	it('the last track cannot be removed; removing one takes its notes and keeps the active track valid', () => {
		const first = project.tracks[0];
		project.removeTrack(first.id);
		expect(project.tracks).toHaveLength(1);
		const second = project.addTrack();
		expect(project.activeTrack).toBe(second.id);
		const n = project.addNote({ tick: 0, pitch: 60 });
		expect(n.track).toBe(second.id);
		project.removeTrack(second.id);
		expect(project.tracks).toHaveLength(1);
		expect(project.activeTrack).toBe(first.id);
		expect(project.notes).toEqual([]);
		project.undo();
		expect(project.tracks).toHaveLength(2);
		expect(project.notes).toHaveLength(1);
	});

	it('new tracks get free colours first', () => {
		const colours = new Set<string>([project.tracks[0].color]);
		for (let i = 0; i < 5; i++) colours.add(project.addTrack().color);
		expect(colours.size).toBe(6);
	});

	it('removing a track removes it from the selection', () => {
		const t = project.addTrack();
		const a = project.addNote({ tick: 0, pitch: 60 });
		project.select([a.id]);
		project.removeTrack(t.id);
		expect(project.selection.size).toBe(0);
	});

	it('moving notes to another track', () => {
		const t = project.addTrack();
		project.setTempo(100, 0);
		project.activeTrack = project.tracks[0].id;
		const a = project.addNote({ tick: 0, pitch: 60 });
		project.select([a.id]);
		project.moveSelectionToTrack(t.id);
		expect(project.notes[0].track).toBe(t.id);
		project.moveSelectionToTrack(t.id); // already there: nothing happens, no extra step
		project.undo();
		expect(project.notes[0].track).toBe(project.tracks[0].id);
	});

	it('loading notes of an unknown track puts them on the first one', () => {
		project.load({ name: 'x', notes: [createNote({ tick: 0, pitch: 60, track: 'gone' })] });
		expect(project.notes[0].track).toBe(project.tracks[0].id);
	});

	it('pasting notes of a track that no longer exists puts them on the active track', () => {
		const t = project.addTrack();
		const a = project.addNote({ tick: 0, pitch: 60 });
		expect(a.track).toBe(t.id);
		project.select([a.id]);
		project.copy();
		project.removeTrack(t.id);
		expect(project.paste(480)).toBe(1);
		expectConsistent();
	});

	it('cutting and pasting keeps everything of a note except its identity', () => {
		const a = project.addNote({
			tick: 100,
			pitch: 66,
			lyric: 'ka',
			length: 300,
			flags: 'g5',
			pitchPoints: [createPitchPoint(0, 50)],
			vibrato: { length: 50, period: 200, depth: 30, fadeIn: 10, fadeOut: 10, phase: 0 }
		});
		project.select([a.id]);
		expect(project.cut()).toBe(1);
		expect(project.notes).toEqual([]);
		expect(project.paste(960)).toBe(1);
		const b = project.notes[0];
		expect(b.id).not.toBe(a.id);
		expect(b).toMatchObject({ tick: 960, pitch: 66, lyric: 'ka', length: 300, flags: 'g5' });
		expect(b.pitchPoints[0]).toMatchObject({ x: 0, y: 50 });
		expect(b.pitchPoints[0].id).not.toBe(a.pitchPoints[0].id);
		expect(b.vibrato).toEqual(a.vibrato);
	});

	it('paste with an empty clipboard does nothing, copy of nothing reports zero', () => {
		expect(project.paste(0)).toBe(0);
		expect(project.copy(new Set())).toBe(0);
		expect(project.canUndo).toBe(false);
	});
});

describe('tempo and time signature', () => {
	it('tempo is clamped, replaced at the same tick, kept in order and undoable', () => {
		project.setTempo(1000);
		expect(project.tempos[0].bpm).toBe(400);
		project.setTempo(1);
		expect(project.tempos).toEqual([{ tick: 0, bpm: 20 }]);
		project.setTempo(100, 960);
		project.setTempo(150, 480);
		expect(project.tempos.map((t) => t.tick)).toEqual([0, 480, 960]);
		project.undo();
		expect(project.tempos.map((t) => t.tick)).toEqual([0, 960]);
		expect(project.primaryTempo).toBe(20);
	});

	it('the first marker is fixed; markers cannot collide', () => {
		project.setTempo(100, 480);
		project.setTempo(110, 960);
		project.moveTempo(0, 100);
		project.moveTempo(480, 960);
		project.moveTempo(480, 0);
		project.moveTempo(480, 700);
		expect(project.tempos.map((t) => t.tick)).toEqual([0, 700, 960]);
		project.removeTempo(0);
		expect(project.tempos).toHaveLength(3);
		project.removeTempo(700);
		expect(project.tempos).toHaveLength(2);
	});

	it('time signature drives the measure length', () => {
		expect(project.ticksPerMeasure()).toBe(PPQ * 4);
		project.setTimeSignature(6, 8);
		expect(project.ticksPerMeasure()).toBe(PPQ * 3);
		project.undo();
		expect(project.ticksPerMeasure()).toBe(PPQ * 4);
	});

	it('the tempo map follows the markers', () => {
		project.setTempo(60, 0);
		project.setTempo(120, 480);
		expect(project.tempoMap.tickToMs(960)).toBeCloseTo(1500);
	});
});

describe('selection and song end', () => {
	it('select, toggle, all, clear', () => {
		const a = project.addNote({ tick: 0, pitch: 60 });
		const b = project.addNote({ tick: 480, pitch: 62 });
		project.select([a.id]);
		project.toggleSelect(b.id);
		expect(project.selection.size).toBe(2);
		project.toggleSelect(a.id);
		expect([...project.selection]).toEqual([b.id]);
		project.clearSelection();
		expect(project.selection.size).toBe(0);
		project.selectAll();
		expect(project.selection.size).toBe(2);
		expect(project.selectedNotes).toHaveLength(2);
	});

	it('deleting removes notes from the selection, an empty delete is not a step', () => {
		const a = project.addNote({ tick: 0, pitch: 60 });
		project.deleteNotes(new Set());
		project.select([a.id]);
		project.deleteNotes();
		expect(project.selection.size).toBe(0);
		expect(project.notes).toEqual([]);
	});

	it('songEnd is the end of the last note and zero without notes', () => {
		expect(project.songEnd).toBe(0);
		project.addNote({ tick: 100, pitch: 60, length: 50 });
		project.addNote({ tick: 10, pitch: 60, length: 500 });
		expect(project.songEnd).toBe(510);
	});

	it('toData reflects the store and load accepts it back', () => {
		project.addTrack('Two');
		project.addNote({ tick: 0, pitch: 61 });
		const data = project.toData();
		project.load({ name: 'other', notes: [] });
		project.load(data);
		expect(project.name).toBe('T');
		expect(project.tracks).toHaveLength(2);
		expect(project.notes).toHaveLength(1);
	});

	it('every note edit is a different revision, so renders are never reused for a different song', () => {
		const seen = new Set<number>([project.revision]);
		const n = project.addNote({ tick: 0, pitch: 60 });
		seen.add(project.revision);
		project.updateNote(n.id, { pitch: 61 });
		seen.add(project.revision);
		project.updateTrack(project.tracks[0].id, { solo: true });
		seen.add(project.revision);
		project.undo();
		seen.add(project.revision);
		expect(seen.size).toBe(5);
	});
});

describe('track pitch curve in the store', () => {
	it('strokes are undoable and clearing an empty curve is not a step', () => {
		const id = project.tracks[0].id;
		project.clearPitchCurve(id);
		expect(project.canUndo).toBe(false);
		project.addPitchStroke(id, [
			{ tick: 0, pitch: 60 },
			{ tick: 400, pitch: 62 }
		]);
		expect(project.tracks[0].pitchCurve).toHaveLength(1);
		project.addPitchStroke(id, [{ tick: 100, pitch: 61 }]);
		expect(project.tracks[0].pitchCurve).toHaveLength(1);
		project.undo();
		expect(project.tracks[0].pitchCurve).toHaveLength(0);
		project.addPitchStroke('missing', [
			{ tick: 0, pitch: 60 },
			{ tick: 400, pitch: 62 }
		]);
		expect(project.tracks[0].pitchCurve).toHaveLength(0);
	});

	it('moving a note under a curve carries the curve and undo restores both', () => {
		const id = project.tracks[0].id;
		const n = project.addNote({ tick: 0, pitch: 60, length: 960 });
		project.addPitchStroke(id, [
			{ tick: 100, pitch: 61 },
			{ tick: 800, pitch: 62 }
		]);
		const before = JSON.stringify(project.tracks[0].pitchCurve);
		project.updateNote(n.id, { pitch: 65 });
		expect(JSON.stringify(project.tracks[0].pitchCurve)).not.toBe(before);
		project.undo();
		expect(JSON.stringify(project.tracks[0].pitchCurve)).toBe(before);
	});
});

describe('a note list stays sorted for the engine', () => {
	it('load sorts by time then pitch', () => {
		const notes: Note[] = [
			createNote({ tick: 480, pitch: 60 }),
			createNote({ tick: 0, pitch: 70 }),
			createNote({ tick: 0, pitch: 60 })
		];
		project.load({ name: 'x', notes });
		expect(project.notes.map((n) => [n.tick, n.pitch])).toEqual([
			[0, 60],
			[0, 70],
			[480, 60]
		]);
	});
});
