import { gridTicks, noteName } from '#lib/core/music';
import type { MenuItem } from './ui.svelte';
import { ui } from './ui.svelte';
import { edit, file, newNoteAt, pitch } from './commands';
import { playback } from './playback.svelte';
import { project } from './project.svelte';
import { settings } from './settings.svelte';
import { view } from './view.svelte';
import { voicebank } from './voicebank.svelte';
import { getEngine } from './engine';
import { TRACK_COLORS } from '#lib/core/music';

const sep: MenuItem = { separator: true };

export function fileMenu(): MenuItem[] {
	return [
		{ label: 'New project', icon: 'file', action: file.new },
		{ label: 'Open project…', icon: 'folder', hint: 'Ctrl+O', action: file.open },
		{ label: 'Save project', icon: 'save', hint: 'Ctrl+S', action: file.save },
		sep,
		{ label: 'Import UST…', icon: 'upload', action: file.importUst },
		{ label: 'Import USTX (OpenUtau)…', icon: 'upload', action: file.importUstx },
		{ label: 'Import MIDI…', icon: 'upload', action: file.importMidi },
		{ label: 'Import VSQX (VOCALOID)…', icon: 'upload', action: file.importVsqx },
		sep,
		{ label: 'Export WAV', icon: 'download', hint: 'Ctrl+E', action: file.exportWav },
		{ label: 'Export UST', icon: 'download', action: file.exportUst },
		{ label: 'Export USTX (OpenUtau)', icon: 'download', action: file.exportUstx },
		{ label: 'Export MIDI', icon: 'download', action: file.exportMidi }
	];
}

export function editMenu(): MenuItem[] {
	const has = project.selection.size > 0;
	return [
		{ label: 'Undo', icon: 'undo', hint: 'Ctrl+Z', disabled: !project.canUndo, action: edit.undo },
		{
			label: 'Redo',
			icon: 'redo',
			hint: 'Ctrl+Shift+Z',
			disabled: !project.canRedo,
			action: edit.redo
		},
		sep,
		{ label: 'Cut', icon: 'scissors', hint: 'Ctrl+X', disabled: !has, action: edit.cut },
		{ label: 'Copy', icon: 'copy', hint: 'Ctrl+C', disabled: !has, action: edit.copy },
		{
			label: 'Paste',
			icon: 'paste',
			hint: 'Ctrl+V',
			disabled: !project.clipboard.length,
			action: edit.paste
		},
		{
			label: 'Duplicate',
			icon: 'duplicate',
			hint: 'Ctrl+D',
			disabled: !has,
			action: edit.duplicate
		},
		{
			label: 'Delete',
			icon: 'trash',
			hint: 'Del',
			danger: true,
			disabled: !has,
			action: edit.delete
		},
		sep,
		{ label: 'Select all', hint: 'Ctrl+A', action: edit.selectAll },
		{ label: 'Lyrics…', icon: 'text', hint: 'Ctrl+L', action: () => ui.openDialog('lyrics') },
		toolsSubmenu()
	];
}

function toolsSubmenu(): MenuItem {
	const grid = `1/${settings.data.gridDivision}`;
	return {
		label: 'Notes',
		icon: 'music',
		children: [
			{ label: `Quantize to ${grid}`, action: edit.quantize },
			{ label: 'Legato (fill gaps)', action: edit.legato },
			{ label: 'Remove overlaps', action: edit.trimOverlaps },
			sep,
			{ label: 'Transpose +1', hint: '↑', action: () => edit.transpose(1) },
			{ label: 'Transpose −1', hint: '↓', action: () => edit.transpose(-1) },
			{ label: 'Transpose +12', hint: 'Shift+↑', action: () => edit.transpose(12) },
			{ label: 'Transpose −12', hint: 'Shift+↓', action: () => edit.transpose(-12) },
			sep,
			{ label: 'Double length', action: () => edit.scale(2) },
			{ label: 'Halve length', action: () => edit.scale(0.5) },
			sep,
			{ label: 'Join selected', disabled: project.selection.size < 2, action: edit.join },
			{ label: 'Pitch: auto portamento', action: () => pitch.portamento() },
			{ label: 'Pitch: clear curves', action: pitch.clear }
		]
	};
}

/** Right-click / long-press menu of a note (the selection is already set). */
export function noteMenu(id: string): MenuItem[] {
	const many = project.selection.size > 1;
	const note = project.notes.find((n) => n.id === id);
	const remove: MenuItem = {
		label: 'Delete',
		icon: 'trash',
		hint: 'Del',
		danger: true,
		action: edit.delete
	};
	const items: MenuItem[] = [
		{
			label: many
				? `${project.selection.size} notes selected`
				: `${note?.lyric ?? ''} · ${note ? noteName(note.pitch) : ''}`,
			disabled: true
		},
		{
			label: 'Edit lyric',
			icon: 'text',
			hint: 'Enter / dbl-click',
			action: () => (ui.requestLyricEdit = id)
		},
		// On phones the sheet is tall: keep the most used actions within thumb reach.
		...(ui.compact ? [remove] : []),
		{ label: 'Duplicate', icon: 'duplicate', hint: 'Ctrl+D', action: edit.duplicate },
		{ label: 'Properties…', icon: 'sliders', action: () => (ui.panel = 'inspector') },
		sep,
		{ label: 'Copy', icon: 'copy', action: edit.copy },
		{ label: 'Cut', icon: 'scissors', action: edit.cut },
		sep,
		{ label: 'Split in half', icon: 'split', disabled: many, action: () => edit.split(id) },
		{ label: 'Join selected', icon: 'join', disabled: !many, action: edit.join },
		{
			label: 'Length',
			icon: 'stretch',
			children: [
				{ label: 'Double', action: () => edit.scale(2) },
				{ label: 'Half', action: () => edit.scale(0.5) },
				{ label: 'Fill gap to next note', action: edit.legato },
				{ label: 'Quantize', action: edit.quantize }
			]
		},
		{
			label: 'Pitch',
			icon: 'curve',
			children: [
				{ label: 'Edit pitch curve', action: () => view.setTool('pitch') },
				{ label: 'Add vibrato', action: () => pitch.vibrato(true) },
				{ label: 'Remove vibrato', action: () => pitch.vibrato(false) },
				{ label: 'Auto portamento', action: () => pitch.portamento() },
				{ label: 'Clear pitch curve', danger: true, action: pitch.clear }
			]
		},
		{
			label: 'Transpose',
			icon: 'arrowUp',
			children: [
				{ label: '+1 semitone', action: () => edit.transpose(1) },
				{ label: '−1 semitone', action: () => edit.transpose(-1) },
				{ label: '+1 octave', action: () => edit.transpose(12) },
				{ label: '−1 octave', action: () => edit.transpose(-12) }
			]
		},
		...(ui.compact ? [] : [sep, remove])
	];
	return items;
}

export function emptyMenu(tick: number, pitchValue: number): MenuItem[] {
	return [
		{
			label: 'Add note here',
			icon: 'plus',
			action: () => {
				const note = newNoteAt(tick, pitchValue, gridTicks(settings.data.gridDivision));
				project.edit((notes) => [...notes, note]);
				project.select([note.id]);
			}
		},
		{
			label: 'Paste here',
			icon: 'paste',
			disabled: !project.clipboard.length,
			action: () => project.paste(tick)
		},
		{ label: 'Select all', action: edit.selectAll },
		sep,
		{ label: 'Move playhead here', icon: 'play', action: () => playback.seekTick(tick) },
		{ label: 'Set tempo here…', icon: 'music', action: () => ui.openDialog('tempo', { tick }) }
	];
}

export function rulerMenu(tick: number): MenuItem[] {
	const hasTempo = project.tempos.some((t) => t.tick > 0 && Math.abs(t.tick - tick) < 120);
	return [
		{ label: 'Set tempo here…', icon: 'music', action: () => ui.openDialog('tempo', { tick }) },
		{
			label: 'Remove tempo change nearby',
			disabled: !hasTempo,
			action: () => {
				const near = project.tempos.find((t) => t.tick > 0 && Math.abs(t.tick - tick) < 120);
				if (near) project.removeTempo(near.tick);
			}
		},
		{ label: 'Move playhead here', icon: 'play', action: () => playback.seekTick(tick) }
	];
}

export function mainMenu(): MenuItem[] {
	return [
		{ label: 'File', children: fileMenu() },
		{ label: 'Edit', children: editMenu() },
		{ label: 'Tracks', icon: 'music', children: trackMenu() },
		{
			label: 'Voicebank',
			children: [
				{ label: 'Open voicebank panel', icon: 'mic', action: () => (ui.panel = 'voicebank') },
				{
					label: 'Analyze all samples now',
					disabled: !voicebank.current || voicebank.warmingUp,
					action: () => void voicebank.analyzeAll()
				},
				{
					label: 'Clear analysis cache',
					danger: true,
					action: async () => {
						await (await getEngine()).cache?.clear();
						ui.toast('Analysis cache cleared.');
					}
				}
			]
		},
		sep,
		{ label: 'Settings', icon: 'settings', action: () => ui.openDialog('settings') },
		{ label: 'Keyboard shortcuts', icon: 'keyboard', action: () => ui.openDialog('shortcuts') },
		{ label: 'About WebTAU', icon: 'info', action: () => ui.openDialog('about') }
	];
}

/** Menu to switch, add and configure tracks. */
export function trackMenu(): MenuItem[] {
	const active = project.tracks.find((t) => t.id === project.activeTrack) ?? project.tracks[0];
	return [
		...project.tracks.map((t): MenuItem => ({
			label: `${t.name}${t.mute ? ' (muted)' : ''}${t.solo ? ' (solo)' : ''}`,
			checked: t.id === active.id,
			action: () => (project.activeTrack = t.id)
		})),
		sep,
		{ label: 'Add track', icon: 'plus', action: () => project.addTrack() },
		{
			label: active.mute ? 'Unmute active track' : 'Mute active track',
			action: () => project.updateTrack(active.id, { mute: !active.mute })
		},
		{
			label: active.solo ? 'Unsolo active track' : 'Solo active track',
			action: () => project.updateTrack(active.id, { solo: !active.solo })
		},
		{
			label: 'Clear pitch curve of active track',
			disabled: !active.pitchCurve.length,
			danger: true,
			action: () => project.clearPitchCurve(active.id)
		},
		{
			label: 'Rename active track…',
			action: () => {
				const name = prompt('Track name', active.name)?.trim();
				if (name) project.updateTrack(active.id, { name });
			}
		},
		{
			label: 'Track colour',
			children: TRACK_COLORS.map((color, i): MenuItem => ({
				label: `Colour ${i + 1}${color === active.color ? ' ✓' : ''}`,
				action: () => project.updateTrack(active.id, { color })
			}))
		},
		{
			label: 'Delete active track',
			icon: 'trash',
			danger: true,
			disabled: project.tracks.length < 2,
			action: () => {
				if (confirm(`Delete “${active.name}” and its notes?`)) project.removeTrack(active.id);
			}
		}
	];
}
