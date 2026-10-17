import { BUILTIN_PLUGINS } from '#lib/plugins/builtin';
import { NoteResolver } from '#lib/plugins/resolve-notes';
import { PluginRegistry } from '#lib/plugins/registry';
import type { Plugin } from '#lib/plugins/api';
import { settings } from './settings.svelte';

/**
 * The app's plugin registry. `version` is reactive: anything derived from the
 * plugins (lyric resolution, suggestions) re-runs when one is switched on or off.
 */
class PluginState {
	readonly registry = new PluginRegistry();
	readonly resolver = new NoteResolver(this.registry);
	version = $state(0);
	list = $state.raw<Plugin[]>([]);

	constructor() {
		for (const p of BUILTIN_PLUGINS) this.registry.register(p);
		this.list = this.registry.all();
		this.registry.setDisabled(settings.data.disabledPlugins);
		this.version++;
	}

	/** Adds a plugin at runtime (the extension point for other modules). */
	register(plugin: Plugin) {
		this.registry.register(plugin);
		this.list = this.registry.all();
		this.version++;
	}

	isEnabled(id: string): boolean {
		return !settings.data.disabledPlugins.includes(id);
	}

	setEnabled(id: string, enabled: boolean) {
		const next = new Set(settings.data.disabledPlugins);
		if (enabled) next.delete(id);
		else next.add(id);
		settings.data.disabledPlugins = [...next];
		this.registry.setDisabled(next);
		this.version++;
	}
}

export const plugins = new PluginState();
