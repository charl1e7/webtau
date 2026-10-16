<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { view, type Tool } from '#lib/state/view.svelte';
	import { project } from '#lib/state/project.svelte';
	import { trackMenu } from '#lib/state/menus';
	import { voicebank } from '#lib/state/voicebank.svelte';

	const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
		{ id: 'select', icon: 'cursor', label: 'Select / move', key: 'V' },
		{ id: 'draw', icon: 'pencil', label: 'Draw notes', key: 'B' },
		{ id: 'pitch', icon: 'curve', label: 'Pitch curve', key: 'P' },
		{ id: 'erase', icon: 'eraser', label: 'Eraser', key: 'E' }
	];

	const GRIDS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64];
	const gridLabel = (d: number) =>
		d === 12 ? '1/8T' : d === 24 ? '1/16T' : d === 48 ? '1/32T' : `1/${d}`;

	let { zoom }: { zoom: (fx: number, fy: number) => void } = $props();

	const activeTrack = $derived(project.tracks.find((t) => t.id === project.activeTrack));
	function openTracks(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		ui.openMenu({ x: r.left, y: r.bottom + 4, items: trackMenu() });
	}
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
			{#if !ui.compact}<Icon name="grid" size={16} />{/if}
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
		<button class="btn track-chip" title="Tracks: switch, add, mute, solo" onclick={openTracks}>
			<span class="swatch" style:background={activeTrack?.color}></span>
			{activeTrack?.name}
			<Icon name="chevronDown" size={14} />
		</button>
		<div class="group">
			<button
				class="icon-btn"
				title="Zoom out (−)"
				aria-label="Zoom out horizontally"
				onclick={() => zoom(1 / 1.25, 1)}
			>
				<Icon name="zoomOut" />
			</button>
			<button
				class="icon-btn"
				title="Zoom in (+)"
				aria-label="Zoom in horizontally"
				onclick={() => zoom(1.25, 1)}
			>
				<Icon name="zoomIn" />
			</button>
			<button
				class="icon-btn"
				title="Taller keys"
				aria-label="Taller keys"
				onclick={() => zoom(1, 1.2)}
			>
				<Icon name="arrowUp" />
			</button>
			<button
				class="icon-btn"
				title="Shorter keys"
				aria-label="Shorter keys"
				onclick={() => zoom(1, 1 / 1.2)}
			>
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
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent);
		border-bottom: 1px solid var(--border);
		flex: none;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.toolbar.compact {
		border-bottom: 0;
		border-top: 1px solid var(--border);
		padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
		gap: 6px;
		justify-content: space-between;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.4);
	}
	.compact .group {
		padding: 2px;
	}
	.compact {
		--hit: 38px;
		gap: 4px;
	}
	.compact .grid select {
		padding: 0 18px 0 8px;
		background-position: right 3px center;
		min-width: 0;
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
	.track-chip {
		min-height: 36px;
		padding: 0 12px;
		border-radius: 12px;
		max-width: 180px;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: 0 0 8px currentColor;
		flex: none;
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
