<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { view, type Tool } from '#lib/state/view.svelte';
	import { project } from '#lib/state/project.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';

	const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
		{ id: 'select', icon: 'cursor', label: 'Select / move', key: 'V' },
		{ id: 'draw', icon: 'pencil', label: 'Draw notes', key: 'B' },
		{ id: 'pitch', icon: 'curve', label: 'Pitch curve', key: 'P' },
		{ id: 'erase', icon: 'eraser', label: 'Eraser', key: 'E' }
	];

	const GRIDS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64];
	const gridLabel = (d: number) => (d === 12 ? '1/8T' : d === 24 ? '1/16T' : d === 48 ? '1/32T' : `1/${d}`);

	let { zoom }: { zoom: (fx: number, fy: number) => void } = $props();
</script>

<div class="toolbar" class:compact={ui.compact} role="toolbar" aria-label="Tools">
	<div class="group">
		{#each TOOLS as t (t.id)}
			<button
				class="icon-btn"
				class:active={view.tool === t.id}
				title="{t.label} ({t.key})"
				aria-label={t.label}
				aria-pressed={view.tool === t.id}
				onclick={() => view.setTool(t.id)}
			>
				<Icon name={t.icon} />
			</button>
		{/each}
	</div>

	<div class="group">
		<label class="grid" title="Grid resolution">
			<Icon name="grid" size={16} />
			<select
				aria-label="Grid"
				value={settings.data.gridDivision}
				onchange={(e) => (settings.data.gridDivision = Number(e.currentTarget.value))}
			>
				{#each GRIDS as g (g)}
					<option value={g}>{gridLabel(g)}</option>
				{/each}
			</select>
		</label>
		<button
			class="icon-btn"
			class:active={settings.data.snap}
			title="Snap to grid"
			aria-label="Snap to grid"
			aria-pressed={settings.data.snap}
			onclick={() => (settings.data.snap = !settings.data.snap)}
		>
			<Icon name="magnet" />
		</button>
	</div>

	{#if !ui.compact}
		<div class="group">
			<button class="icon-btn" title="Zoom out (−)" aria-label="Zoom out horizontally" onclick={() => zoom(1 / 1.25, 1)}>
				<Icon name="zoomOut" />
			</button>
			<button class="icon-btn" title="Zoom in (+)" aria-label="Zoom in horizontally" onclick={() => zoom(1.25, 1)}>
				<Icon name="zoomIn" />
			</button>
			<button class="icon-btn" title="Taller keys" aria-label="Taller keys" onclick={() => zoom(1, 1.2)}>
				<Icon name="arrowUp" />
			</button>
			<button class="icon-btn" title="Shorter keys" aria-label="Shorter keys" onclick={() => zoom(1, 1 / 1.2)}>
				<Icon name="arrowDown" />
			</button>
		</div>
		<span class="spacer"></span>
		<span class="info">{project.notes.length} notes</span>
	{:else}
		<span class="spacer"></span>
		<button
			class="icon-btn"
			class:active={ui.panel === 'voicebank'}
			aria-label="Voicebank"
			onclick={() => ui.togglePanel('voicebank')}
		>
			<Icon name="mic" />
			{#if voicebank.loading}<span class="dot"></span>{/if}
		</button>
		<button
			class="icon-btn"
			class:active={ui.panel === 'inspector'}
			aria-label="Note properties"
			onclick={() => ui.togglePanel('inspector')}
		>
			<Icon name="sliders" />
		</button>
		<button class="icon-btn" aria-label="Settings" onclick={() => ui.openDialog('settings')}>
			<Icon name="settings" />
		</button>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 10px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		flex: none;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.toolbar.compact {
		border-bottom: 0;
		border-top: 1px solid var(--border);
		padding: 4px 6px calc(4px + env(safe-area-inset-bottom));
		gap: 4px;
		justify-content: space-between;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 10px;
		border-right: 1px solid var(--border);
	}
	.compact .group {
		padding-right: 4px;
		border-right: 0;
	}
	.group:last-of-type {
		border-right: 0;
	}
	.grid {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--muted);
		padding-left: 6px;
	}
	.grid select {
		width: auto;
		min-height: var(--hit);
		padding: 0 6px;
		border: 0;
		background: transparent;
		font-weight: 600;
		color: var(--text);
	}
	.info {
		color: var(--muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.icon-btn {
		position: relative;
	}
	.dot {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
	}
</style>
