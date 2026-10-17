<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { view, type Tool } from '#lib/state/view.svelte';
	import { project } from '#lib/state/project.svelte';
	import { trackMenu } from '#lib/state/menus';
	import type { MenuItem } from '#lib/state/ui.svelte';
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

	const LONG_PRESS_MS = 450;
	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	/** A long-press that opened a flyout must not also select the tool when the finger lifts. */
	let suppressClick = false;

	const hasFlyout = (id: Tool) => id === 'pitch' || id === 'erase';

	function pitchFlyout(): MenuItem[] {
		const { pitchMode: scope, pitchStyle: style } = settings.data;
		const entry = (
			label: string,
			hint: string,
			icon: string,
			nextScope: typeof scope,
			nextStyle: typeof style
		): MenuItem => ({
			label,
			hint,
			icon,
			checked: scope === nextScope && style === nextStyle,
			action: () => {
				settings.data.pitchMode = nextScope;
				settings.data.pitchStyle = nextStyle;
				view.setTool('pitch');
			}
		});
		return [
			entry('Freehand · whole track', 'drag to draw', 'curve', 'track', 'freehand'),
			entry('Points · whole track', 'click to place', 'dots', 'track', 'points'),
			entry('Freehand · single notes', 'stored on notes', 'pencil', 'note', 'freehand'),
			entry('Points · single notes', 'stored on notes', 'music', 'note', 'points')
		];
	}

	function eraserFlyout(): MenuItem[] {
		const entry = (
			label: string,
			icon: string,
			mode: typeof settings.data.eraserMode
		): MenuItem => ({
			label,
			icon,
			checked: settings.data.eraserMode === mode,
			action: () => {
				settings.data.eraserMode = mode;
				view.setTool('erase');
			}
		});
		return [
			entry('Erase notes and pitch', 'eraser', 'all'),
			entry('Erase notes only', 'music', 'notes'),
			entry('Erase pitch only', 'curve', 'pitch')
		];
	}

	function openFlyout(button: Element, id: Tool, guard: boolean) {
		if (ui.menu) return;
		const r = button.getBoundingClientRect();
		ui.openMenu({
			x: r.left,
			y: r.bottom + 6,
			items: id === 'pitch' ? pitchFlyout() : eraserFlyout(),
			guard
		});
	}

	function toolDown(e: PointerEvent, id: Tool) {
		clearTimeout(pressTimer);
		suppressClick = false;
		if (!hasFlyout(id) || e.pointerType === 'mouse') return;
		const button = e.currentTarget as Element;
		pressTimer = setTimeout(() => {
			suppressClick = true;
			navigator.vibrate?.(10);
			openFlyout(button, id, true);
		}, LONG_PRESS_MS);
	}

	function toolContext(e: MouseEvent, id: Tool) {
		if (!hasFlyout(id)) return;
		e.preventDefault();
		clearTimeout(pressTimer);
		suppressClick = true;
		openFlyout(
			e.currentTarget as Element,
			id,
			e instanceof PointerEvent && e.pointerType !== 'mouse'
		);
	}

	function toolClick(id: Tool) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		view.setTool(id);
	}

	const toolIcon = (t: (typeof TOOLS)[number]): IconName =>
		t.id === 'pitch' && settings.data.pitchStyle === 'points' ? 'dots' : t.icon;

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
				title={hasFlyout(t.id)
					? `${t.label} (${t.key}) — hold or right-click for more`
					: `${t.label} (${t.key})`}
				aria-label={t.label}
				aria-pressed={view.tool === t.id}
				aria-haspopup={hasFlyout(t.id) ? 'menu' : undefined}
				onpointerdown={(e) => toolDown(e, t.id)}
				onpointerup={() => clearTimeout(pressTimer)}
				onpointercancel={() => clearTimeout(pressTimer)}
				oncontextmenu={(e) => toolContext(e, t.id)}
				onclick={() => toolClick(t.id)}
			>
				<Icon name={toolIcon(t)} />
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
	.icon-btn {
		-webkit-touch-callout: none;
		user-select: none;
	}
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
