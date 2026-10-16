import { browser } from '$app/env';
import { History } from '#lib/core/history';
import { TempoMap } from '#lib/core/tempo';
import { cloneNote, createNote } from '#lib/core/music';
import { pasteNotes, sortNotes } from '#lib/core/ops';
import { PPQ, type Note, type ProjectData, type TempoChange, type TimeSignature } from '#lib/core/types';

interface Snapshot {
	notes: Note[];
	tempos: TempoChange[];
	timeSignature: TimeSignature;
}

const AUTOSAVE_KEY = 'webtau:autosave';

export class ProjectState {
	name = $state('Untitled');
	voicebankName = $state('');
	notes = $state.raw<Note[]>([]);
	tempos = $state.raw<TempoChange[]>([{ tick: 0, bpm: 120 }]);
	timeSignature = $state.raw<TimeSignature>({ numerator: 4, denominator: 4 });
	selection = $state.raw<ReadonlySet<string>>(new Set());

	/** Increases with every change of the musical content; used to invalidate renders. */
	revision = $state(0);
	/** Whether there are changes that were not exported or saved. */
	dirty = $state(false);
	/** Increases whenever a whole project is loaded (not on edits). */
	loadCount = $state(0);
	canUndo = $state(false);
	canRedo = $state(false);

	tempoMap = $derived(new TempoMap(this.tempos));
	selectedNotes = $derived(this.notes.filter((n) => this.selection.has(n.id)));
	primaryTempo = $derived(this.tempos[0]?.bpm ?? 120);

	private history = new History<Snapshot>();
	private gestureBase: Snapshot | null = null;
	private coalesceKey = '';
	private coalesceTime = 0;
	clipboard: Note[] = [];

	// ---- snapshots --------------------------------------------------------

	private snapshot(): Snapshot {
		return { notes: this.notes, tempos: this.tempos, timeSignature: this.timeSignature };
	}

	private restore(s: Snapshot) {
		this.notes = s.notes;
		this.tempos = s.tempos;
		this.timeSignature = s.timeSignature;
		const ids = new Set(s.notes.map((n) => n.id));
		this.selection = new Set([...this.selection].filter((id) => ids.has(id)));
		this.changed();
	}

	private changed() {
		this.revision++;
		this.dirty = true;
		this.canUndo = this.history.canUndo;
		this.canRedo = this.history.canRedo;
		this.scheduleAutosave();
	}

	toData(): ProjectData {
		return {
			name: this.name,
			notes: this.notes,
			tempos: this.tempos,
			timeSignature: this.timeSignature,
			voicebank: this.voicebankName
		};
	}

	/** Replaces the whole project (new / open / import) and clears the history. */
	load(data: Partial<ProjectData> & { notes: Note[] }) {
		this.name = data.name ?? 'Untitled';
		this.voicebankName = data.voicebank ?? this.voicebankName;
		this.notes = sortNotes(data.notes);
		this.tempos = data.tempos?.length ? data.tempos : [{ tick: 0, bpm: 120 }];
		this.timeSignature = data.timeSignature ?? { numerator: 4, denominator: 4 };
		this.selection = new Set();
		this.history.clear();
		this.gestureBase = null;
		this.changed();
		this.dirty = false;
		this.loadCount++;
	}

	reset() {
		this.load({ notes: [] });
	}

	// ---- history ------------------------------------------------------------

	/**
	 * Applies an edit as one undo step. Edits with the same `coalesce` key in
	 * quick succession (typing in a field, nudging) share a single step.
	 */
	edit(update: (notes: Note[]) => Note[], opts: { coalesce?: string } = {}) {
		const next = update(this.notes);
		if (next === this.notes) return;
		if (!this.gestureBase) this.record(opts.coalesce);
		this.notes = next;
		this.changed();
	}

	editTempos(update: (tempos: TempoChange[]) => TempoChange[]) {
		const next = update([...this.tempos]);
		this.record();
		this.tempos = next;
		this.changed();
	}

	private record(coalesce?: string) {
		const now = Date.now();
		const merge = coalesce && coalesce === this.coalesceKey && now - this.coalesceTime < 900;
		this.coalesceKey = coalesce ?? '';
		this.coalesceTime = now;
		if (!merge) this.history.record(this.snapshot());
	}

	/** Starts a continuous edit (drag); previews do not create undo steps. */
	beginGesture() {
		this.gestureBase = this.snapshot();
	}

	preview(update: (notes: Note[]) => Note[]) {
		const next = update(this.notes);
		if (next === this.notes) return;
		this.notes = next;
		this.revision++;
		this.dirty = true;
	}

	endGesture() {
		const base = this.gestureBase;
		this.gestureBase = null;
		if (!base) return;
		if (base.notes !== this.notes) {
			this.history.record(base);
			this.coalesceKey = '';
			this.changed();
		}
	}

	cancelGesture() {
		const base = this.gestureBase;
		this.gestureBase = null;
		if (base) {
			this.notes = base.notes;
			this.revision++;
		}
	}

	undo() {
		const previous = this.history.undo(this.snapshot());
		if (previous) {
			this.coalesceKey = '';
			this.restore(previous);
		}
	}

	redo() {
		const next = this.history.redo(this.snapshot());
		if (next) {
			this.coalesceKey = '';
			this.restore(next);
		}
	}

	// ---- selection ------------------------------------------------------------

	select(ids: Iterable<string>) {
		this.selection = new Set(ids);
	}

	toggleSelect(id: string) {
		const next = new Set(this.selection);
		if (!next.delete(id)) next.add(id);
		this.selection = next;
	}

	selectAll() {
		this.selection = new Set(this.notes.map((n) => n.id));
	}

	clearSelection() {
		if (this.selection.size) this.selection = new Set();
	}

	// ---- common commands ---------------------------------------------------------

	addNote(init: Partial<Note> & Pick<Note, 'tick' | 'pitch'>): Note {
		const note = createNote(init);
		this.edit((notes) => [...notes, note]);
		this.select([note.id]);
		return note;
	}

	deleteNotes(ids: ReadonlySet<string> = this.selection) {
		if (!ids.size) return;
		this.edit((notes) => notes.filter((n) => !ids.has(n.id)));
		this.selection = new Set([...this.selection].filter((id) => !ids.has(id)));
	}

	updateNote(id: string, patch: Partial<Note>, coalesce?: string) {
		this.edit((notes) => notes.map((n) => (n.id === id ? { ...n, ...patch } : n)), { coalesce });
	}

	updateSelected(patch: Partial<Note>, coalesce?: string) {
		const ids = this.selection;
		this.edit((notes) => notes.map((n) => (ids.has(n.id) ? { ...n, ...patch } : n)), { coalesce });
	}

	copy(ids: ReadonlySet<string> = this.selection) {
		this.clipboard = this.notes.filter((n) => ids.has(n.id)).map((n) => cloneNote(n));
		return this.clipboard.length;
	}

	paste(atTick: number): number {
		const added = pasteNotes(this.clipboard, atTick);
		if (!added.length) return 0;
		this.edit((notes) => [...notes, ...added]);
		this.select(added.map((n) => n.id));
		return added.length;
	}

	cut() {
		const n = this.copy();
		this.deleteNotes();
		return n;
	}

	setTempo(bpm: number, tick = 0) {
		const value = Math.min(400, Math.max(20, bpm));
		this.editTempos((tempos) => {
			const next = tempos.filter((t) => t.tick !== tick);
			next.push({ tick, bpm: value });
			return next.sort((a, b) => a.tick - b.tick);
		});
	}

	removeTempo(tick: number) {
		if (tick === 0) return;
		this.editTempos((tempos) => tempos.filter((t) => t.tick !== tick));
	}

	setTimeSignature(numerator: number, denominator: number) {
		this.record();
		this.timeSignature = { numerator, denominator };
		this.changed();
	}

	get songEnd(): number {
		return this.notes.reduce((m, n) => Math.max(m, n.tick + n.length), 0);
	}

	// ---- autosave --------------------------------------------------------------

	private saveTimer: ReturnType<typeof setTimeout> | undefined;

	private scheduleAutosave() {
		if (!browser) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			try {
				localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...this.toData(), savedAt: Date.now() }));
			} catch {
				/* storage full or unavailable */
			}
		}, 1200);
	}

	/** Restores the last autosaved project, if any. */
	restoreAutosave(): boolean {
		if (!browser) return false;
		try {
			const raw = localStorage.getItem(AUTOSAVE_KEY);
			if (!raw) return false;
			const data = JSON.parse(raw) as ProjectData;
			if (!Array.isArray(data.notes) || !data.notes.length) return false;
			this.load({ ...data, notes: data.notes.map((n) => createNote({ ...n })) });
			return true;
		} catch {
			return false;
		}
	}

	ticksPerMeasure(): number {
		return (PPQ * 4 * this.timeSignature.numerator) / this.timeSignature.denominator;
	}
}

export const project = new ProjectState();
