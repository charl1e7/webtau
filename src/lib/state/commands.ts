import { bakeCurve } from '#lib/core/pitch-curve';
import { DEFAULT_VIBRATO, createPitchPoint, gridTicks, noteEnd } from '#lib/core/music';
import {
	applyPortamento,
	duplicateNotes,
	joinNotes,
	legato,
	mapSelected,
	moveNotes,
	quantizeNotes,
	scaleLengths,
	splitNote,
	transposeNotes,
	trimOverlaps
} from '#lib/core/ops';
import { applyLyrics } from '#lib/core/lyrics';
import { createNote } from '#lib/core/music';
import { downloadBlob, safeFilename } from '#lib/io/download';
import { parseMidi, serializeMidi, type MidiFile } from '#lib/io/midi';
import { parseProject, serializeProject } from '#lib/io/project-file';
import { parseUst, serializeUst } from '#lib/io/ust';
import { parseUstx, serializeUstx } from '#lib/io/ustx';
import { parseVsqx } from '#lib/io/vsqx';
import { createTrack } from '#lib/core/music';
import { decodeText } from '#lib/io/text';
import { MIN_NOTE_TICKS, type Note } from '#lib/core/types';
import { lyrics } from './lyrics.svelte';
import { playback } from './playback.svelte';
import { project } from './project.svelte';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';

// ---- helpers ----------------------------------------------------------------

/** Opens the native file picker. Resolves with an empty list when cancelled. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.multiple = multiple;
		input.style.display = 'none';
		input.onchange = () => {
			resolve([...(input.files ?? [])]);
			input.remove();
		};
		input.oncancel = () => {
			resolve([]);
			input.remove();
		};
		document.body.appendChild(input);
		input.click();
	});
}

const readBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

/** Replaces the project with imported content and points out lyrics the voicebank cannot sing. */
function loadImported(data: Parameters<typeof project.load>[0]) {
	project.load(data);
	lyrics.offerFix();
}

function confirmDiscard(): boolean {
	return !project.dirty || project.notes.length === 0 || confirm('Discard unsaved changes?');
}

/** The selection, or every note if nothing is selected. */
function targetIds(): ReadonlySet<string> {
	return project.selection.size ? project.selection : new Set(project.notes.map((n) => n.id));
}

function guard<A extends unknown[]>(fn: (...args: A) => void | Promise<void>) {
	return async (...args: A) => {
		try {
			await fn(...args);
		} catch (error) {
			ui.error(error instanceof Error ? error.message : String(error));
		}
	};
}

// ---- file commands --------------------------------------------------------------

export const file = {
	new: () => {
		if (!confirmDiscard()) return;
		playback.stop();
		project.reset();
	},

	save: guard(() => {
		downloadBlob(
			serializeProject(project.toData()),
			`${safeFilename(project.name)}.webtau.json`,
			'application/json'
		);
		project.dirty = false;
		ui.toast('Project saved.', 'success');
	}),

	open: guard(async () => {
		const [f] = await pickFiles('.json,.webtau,application/json');
		if (!f || !confirmDiscard()) return;
		playback.stop();
		project.load(parseProject(await f.text()));
		ui.toast(`Opened “${project.name}”.`, 'success');
	}),

	importUst: guard(async () => {
		const [f] = await pickFiles('.ust');
		if (!f || !confirmDiscard()) return;
		const ust = parseUst(await readBytes(f));
		if (!ust.notes.length) throw new Error('The UST file contains no notes.');
		playback.stop();
		loadImported({
			name: ust.name || f.name.replace(/\.ust$/i, ''),
			notes: ust.notes,
			tempos: ust.tempos,
			voicebank: ust.voicebank
		});
		ui.toast(
			`Imported ${ust.notes.length} notes from UST` +
				(ust.voicebank ? ` (voicebank: ${ust.voicebank})` : ''),
			'success'
		);
		ust.warnings.forEach((w) => ui.toast(w));
	}),

	importUstx: guard(async () => {
		const [f] = await pickFiles('.ustx');
		if (!f || !confirmDiscard()) return;
		file.applyUstx(await readBytes(f), f.name);
	}),

	applyUstx: (bytes: Uint8Array, fileName: string) => {
		const ustx = parseUstx(bytes);
		if (!ustx.notes.length) throw new Error('The USTX file contains no notes.');
		playback.stop();
		loadImported({
			name: ustx.name || fileName.replace(/\.ustx$/i, ''),
			notes: ustx.notes,
			tracks: ustx.tracks,
			tempos: ustx.tempos,
			timeSignature: ustx.timeSignature,
			voicebank: ustx.voicebank
		});
		ui.toast(
			`Imported ${ustx.notes.length} notes from USTX (${ustx.tracks.length} track(s)).`,
			'success'
		);
		ustx.warnings.forEach((w) => ui.toast(w));
	},

	exportUstx: guard(() => {
		if (!project.notes.length) throw new Error('Nothing to export: add some notes first.');
		const { text, warnings } = serializeUstx({
			name: project.name,
			voicebank: project.voicebankName,
			notes: project.notes,
			tracks: project.tracks,
			tempos: project.tempos,
			timeSignature: project.timeSignature
		});
		downloadBlob(text, `${safeFilename(project.name)}.ustx`, 'text/yaml;charset=utf-8');
		ui.toast('USTX exported for OpenUtau (all tracks).', 'success');
		warnings.forEach((w) => ui.toast(w));
	}),

	exportUst: guard(() => {
		if (!project.notes.length) throw new Error('Nothing to export: add some notes first.');
		const track = project.tracks.find((t) => t.id === project.activeTrack) ?? project.tracks[0];
		const own = project.notes.filter((n) => n.track === track.id);
		if (!own.length) throw new Error(`The track “${track.name}” has no notes to export.`);
		const notes = bakeCurve(own, track, project.tempoMap);
		const { text, warnings } = serializeUst(notes, project.tempos, {
			name: project.name,
			voicebank: project.voicebankName
		});
		downloadBlob(text, `${safeFilename(project.name)}.ust`, 'text/plain;charset=utf-8');
		ui.toast(
			project.tracks.length > 1
				? `UST exported (UTF-8): track “${track.name}” only, UST holds a single voice.`
				: 'UST exported (UTF-8).',
			'success'
		);
		warnings.forEach((w) => ui.toast(w));
	}),

	importMidi: guard(async () => {
		const [f] = await pickFiles('.mid,.midi,audio/midi');
		if (!f) return;
		const midi = parseMidi(await readBytes(f));
		const withNotes = midi.tracks.filter((t) => t.noteCount > 0);
		if (!withNotes.length) throw new Error('The MIDI file contains no notes.');
		if (withNotes.length === 1) file.applyMidi(midi, withNotes[0].index, f.name);
		else ui.openDialog('midi', { midi, fileName: f.name });
	}),

	applyMidi: (midi: MidiFile, trackIndex: number, fileName: string) => {
		if (!confirmDiscard()) return;
		const track = midi.tracks.find((t) => t.index === trackIndex);
		if (!track) return;
		const lyric = settings.data.defaultLyric || 'a';
		const notes = track.notes.map((n) => (n.lyric === 'a' ? { ...n, lyric } : n));
		playback.stop();
		loadImported({ name: fileName.replace(/\.midi?$/i, ''), notes, tempos: midi.tempos });
		ui.toast(`Imported ${notes.length} notes from “${track.name}”.`, 'success');
	},

	/** Imports every track of a MIDI file as its own project track. */
	applyMidiAll: (midi: MidiFile, fileName: string) => {
		if (!confirmDiscard()) return;
		const lyric = settings.data.defaultLyric || 'a';
		const withNotes = midi.tracks.filter((t) => t.noteCount > 0);
		const tracks = withNotes.map((t, i) => createTrack(i, { name: t.name }));
		const notes = withNotes.flatMap((t, i) =>
			t.notes.map((n) => ({ ...n, track: tracks[i].id, lyric: n.lyric === 'a' ? lyric : n.lyric }))
		);
		playback.stop();
		loadImported({ name: fileName.replace(/\.midi?$/i, ''), notes, tracks, tempos: midi.tempos });
		ui.toast(`Imported ${withNotes.length} tracks, ${notes.length} notes.`, 'success');
	},

	importVsqx: guard(async () => {
		const [f] = await pickFiles('.vsqx');
		if (!f || !confirmDiscard()) return;
		await file.applyVsqx(await f.text(), f.name);
	}),

	applyVsqx: async (xml: string, fileName: string) => {
		const v = parseVsqx(xml);
		if (!v.tracks.length) throw new Error('The VSQX file contains no notes.');
		const tracks = v.tracks.map((t, i) => createTrack(i, { name: t.name }));
		const notes = v.tracks.flatMap((t, i) => t.notes.map((n) => ({ ...n, track: tracks[i].id })));
		playback.stop();
		loadImported({
			name: fileName.replace(/\.vsqx$/i, ''),
			notes,
			tracks,
			tempos: v.tempos,
			timeSignature: v.timeSignature
		});
		ui.toast(`Imported ${notes.length} notes from VSQX (${tracks.length} track(s)).`, 'success');
	},

	exportMidi: guard(() => {
		if (!project.notes.length) throw new Error('Nothing to export: add some notes first.');
		downloadBlob(
			serializeMidi(
				project.tracks.map((t) => ({
					name: t.name,
					notes: project.notes.filter((n) => n.track === t.id)
				})),
				project.tempos,
				project.name
			),
			`${safeFilename(project.name)}.mid`,
			'audio/midi'
		);
		ui.toast('MIDI exported.', 'success');
	}),

	exportWav: guard(() => playback.exportWav()),

	/** Opens a project, UST or MIDI that was dropped onto the window. */
	openDropped: guard(async (f: File) => {
		const name = f.name.toLowerCase();
		if (name.endsWith('.ust')) {
			const ust = parseUst(await readBytes(f));
			if (!confirmDiscard()) return;
			loadImported({
				name: ust.name,
				notes: ust.notes,
				tempos: ust.tempos,
				voicebank: ust.voicebank
			});
			ui.toast(`Imported ${ust.notes.length} notes from UST.`, 'success');
		} else if (name.endsWith('.ustx')) {
			if (!confirmDiscard()) return;
			file.applyUstx(await readBytes(f), f.name);
		} else if (name.endsWith('.mid') || name.endsWith('.midi')) {
			const midi = parseMidi(await readBytes(f));
			const withNotes = midi.tracks.filter((t) => t.noteCount > 0);
			if (withNotes.length === 1) file.applyMidi(midi, withNotes[0].index, f.name);
			else if (withNotes.length) ui.openDialog('midi', { midi, fileName: f.name });
		} else if (name.endsWith('.vsqx')) {
			await file.applyVsqx(await f.text(), f.name);
		} else if (name.endsWith('.json') || name.endsWith('.webtau')) {
			if (!confirmDiscard()) return;
			project.load(parseProject(decodeText(await readBytes(f))));
		}
	})
};

// ---- edit commands ----------------------------------------------------------------

export const edit = {
	undo: () => project.undo(),
	redo: () => project.redo(),

	selectAll: () => project.selectAll(),

	delete: () => project.deleteNotes(),

	copy: () => {
		const n = project.copy();
		if (n) ui.toast(`Copied ${n} note(s).`);
	},

	cut: () => {
		const n = project.cut();
		if (n) ui.toast(`Cut ${n} note(s).`);
	},

	paste: () => {
		const at =
			playback.playing || playback.positionMs > 0 ? playback.positionTick : lastSelectedEnd();
		if (!project.paste(Math.round(at))) ui.toast('Clipboard is empty.');
	},

	duplicate: () => {
		const ids = project.selection;
		if (!ids.size) return;
		const { notes, added } = duplicateNotes(project.notes, ids);
		project.edit(() => notes);
		project.select(added.map((n) => n.id));
	},

	transpose: (semitones: number) => {
		project.edit((notes) => transposeNotes(notes, targetIds(), semitones), {
			coalesce: 'transpose'
		});
	},

	nudge: (ticks: number) => {
		project.edit((notes) => moveNotes(notes, targetIds(), ticks, 0), { coalesce: 'nudge' });
	},

	quantize: () => {
		project.edit((notes) =>
			quantizeNotes(notes, targetIds(), gridTicks(settings.data.gridDivision))
		);
	},

	legato: () => project.edit((notes) => legato(notes, targetIds())),

	trimOverlaps: () => project.edit((notes) => trimOverlaps(notes)),

	/** Lengthens (+1) or shortens (-1) the selected notes by one grid step. */
	adjustLength: (direction: 1 | -1) => {
		const step = gridTicks(settings.data.gridDivision);
		project.edit(
			(notes) =>
				mapSelected(notes, project.selection, (n) => ({
					...n,
					length: Math.max(MIN_NOTE_TICKS, n.length + direction * step)
				})),
			{ coalesce: 'length' }
		);
	},

	scale: (factor: number) =>
		project.edit((notes) => scaleLengths(notes, targetIds(), factor), { coalesce: 'scale' }),

	split: (id?: string, at?: number) => {
		const note = id
			? project.notes.find((n) => n.id === id)
			: project.selectedNotes.length === 1
				? project.selectedNotes[0]
				: undefined;
		if (!note) return;
		const cut = at ?? Math.round((note.tick + noteEnd(note)) / 2 / 15) * 15;
		project.edit((notes) => splitNote(notes, note.id, cut));
	},

	join: () => project.edit((notes) => joinNotes(notes, project.selection)),

	setLyric: (id: string, lyric: string) => project.updateNote(id, { lyric }, `lyric:${id}`),

	applyLyrics: (text: string) => {
		const ids = project.selection.size
			? project.selection
			: new Set(project.notes.map((n) => n.id));
		project.edit((notes) => applyLyrics(notes, ids, text));
	},

	/** Adds a note at the end of the song, or after the selection. */
	appendNote: () => {
		const last = project.selectedNotes.at(-1) ?? project.notes.at(-1);
		const tick = last ? noteEnd(last) : 0;
		project.addNote({
			tick,
			pitch: last?.pitch ?? 60,
			length: last?.length ?? 240,
			lyric: settings.data.defaultLyric || 'a'
		});
	},

	addRestAfter: () => {
		const last = project.selectedNotes.at(-1);
		if (last)
			project.addNote({ tick: noteEnd(last), pitch: last.pitch, length: last.length, lyric: 'R' });
	}
};

function lastSelectedEnd(): number {
	const sel = project.selectedNotes;
	return sel.length ? Math.max(...sel.map(noteEnd)) : 0;
}

// ---- pitch commands -------------------------------------------------------------------

export const pitch = {
	clear: () =>
		project.edit((notes) =>
			mapSelected(notes, targetIds(), (n) => ({ ...n, pitchPoints: [], vibrato: null }))
		),

	portamento: (slideMs = 60) =>
		project.edit((notes) =>
			applyPortamento(notes, targetIds(), slideMs, (x, y, shape) => createPitchPoint(x, y, shape))
		),

	vibrato: (on: boolean) =>
		project.edit((notes) =>
			mapSelected(notes, targetIds(), (n) => ({
				...n,
				vibrato: on ? { ...DEFAULT_VIBRATO } : null
			}))
		),

	setVibrato: (patch: Partial<NonNullable<Note['vibrato']>>) =>
		project.edit(
			(notes) =>
				mapSelected(notes, project.selection, (n) =>
					n.vibrato ? { ...n, vibrato: { ...n.vibrato, ...patch } } : n
				),
			{ coalesce: 'vibrato' }
		)
};

export function newNoteAt(tick: number, pitchValue: number, length: number): Note {
	return createNote({
		track: project.activeTrack,
		tick,
		pitch: pitchValue,
		length,
		lyric: settings.data.defaultLyric || 'a'
	});
}
