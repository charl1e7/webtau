import type { PluginHost } from '#lib/plugins/api';
import { lyrics } from './lyrics.svelte';
import { plugins } from './plugins.svelte';
import { project } from './project.svelte';
import { ui } from './ui.svelte';
import { voicebank } from './voicebank.svelte';
import type { MenuItem } from './ui.svelte';

/** What plugin commands may see and do. Built fresh for every command run. */
export function pluginHost(): PluginHost {
	const selected = project.selection;
	return {
		notes: project.notes,
		targets: selected.size ? project.notes.filter((n) => selected.has(n.id)) : project.notes,
		index: voicebank.index,
		resolve: (note) => lyrics.resolutionOf(note.id) ?? null,
		setLyrics: (changes) =>
			project.edit((notes) =>
				notes.map((n) => (changes.has(n.id) ? { ...n, lyric: changes.get(n.id)! } : n))
			),
		toast: (message, kind = 'info') => ui.toast(message, kind),
		openLyricDoctor: () => ui.openDialog('lyric-doctor')
	};
}

/** Menu entries of every active plugin's commands. */
export function pluginMenuItems(): MenuItem[] {
	return plugins.registry.commands().map((c) => ({
		label: c.label,
		icon: c.icon,
		disabled: c.enabled ? !c.enabled(pluginHost()) : false,
		action: () => void c.run(pluginHost())
	}));
}
