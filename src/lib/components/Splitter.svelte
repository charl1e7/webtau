<script lang="ts">
	import Icon from './Icon.svelte';
	import { settings } from '#lib/state/settings.svelte';

	let { side }: { side: 'left' | 'right' } = $props();

	const MIN = 220;
	const MAX = 560;
	/** Dragging below this width collapses the panel. */
	const COLLAPSE_AT = 150;
	const DEFAULTS = { left: 308, right: 296 };

	const open = $derived(side === 'left' ? settings.data.leftOpen : settings.data.rightOpen);
	let dragging = $state(false);
	let startX = 0;
	let startWidth = 0;

	const width = () => (side === 'left' ? settings.data.leftWidth : settings.data.rightWidth);
	function setWidth(w: number) {
		if (side === 'left') settings.data.leftWidth = w;
		else settings.data.rightWidth = w;
	}
	function setOpen(v: boolean) {
		if (side === 'left') settings.data.leftOpen = v;
		else settings.data.rightOpen = v;
	}

	function down(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
		startX = e.clientX;
		startWidth = open ? width() : 0;
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
		const raw = startWidth + delta;
		if (raw < COLLAPSE_AT) {
			if (open) setOpen(false);
		} else {
			if (!open) setOpen(true);
			setWidth(Math.min(MAX, Math.max(MIN, raw)));
		}
	}

	function up() {
		dragging = false;
	}

	function reset() {
		setOpen(true);
		setWidth(DEFAULTS[side]);
	}

	function key(e: KeyboardEvent) {
		const step = e.shiftKey ? 40 : 12;
		const grow =
			(side === 'left' ? 1 : -1) * (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
		if (!grow) return;
		e.preventDefault();
		const next = (open ? width() : 0) + grow * step;
		if (next < COLLAPSE_AT) setOpen(false);
		else {
			setOpen(true);
			setWidth(Math.min(MAX, Math.max(MIN, next)));
		}
	}
</script>

<!-- A focusable separator is an interactive widget (ARIA window splitter). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div
	class="splitter"
	class:dragging
	class:collapsed={!open}
	class:left={side === 'left'}
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize {side} panel"
	aria-valuenow={open ? width() : 0}
	aria-valuemin={0}
	aria-valuemax={MAX}
	tabindex="0"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	ondblclick={reset}
	onkeydown={key}
>
	<span class="grip" aria-hidden="true"></span>
	{#if !open}
		<button
			class="reopen"
			title="Show panel (drag or double-click the edge to resize)"
			aria-label="Show {side} panel"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={() => setOpen(true)}
		>
			<Icon name="chevronRight" size={14} />
		</button>
	{/if}
</div>

<style>
	.splitter {
		position: relative;
		flex: none;
		width: 12px;
		z-index: 4;
		cursor: col-resize;
		touch-action: none;
		display: grid;
		place-items: center;
		outline: none;
	}
	.grip {
		width: 4px;
		height: 44px;
		border-radius: 2px;
		background: var(--border-strong);
		opacity: 0;
		transition:
			opacity 0.15s,
			background 0.15s,
			height 0.15s;
	}
	.splitter:hover .grip,
	.splitter:focus-visible .grip,
	.splitter.dragging .grip {
		opacity: 1;
	}
	.splitter.dragging .grip {
		background: var(--accent);
		height: 72px;
		box-shadow: var(--glow);
	}
	/* A collapsed panel leaves a slim rail with a button to bring it back. */
	.splitter.collapsed {
		width: 22px;
	}
	.splitter.collapsed .grip {
		opacity: 0.7;
	}
	.reopen {
		position: absolute;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
		width: 22px;
		height: 56px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		color: var(--accent-2);
		background: var(--surface-hi);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow);
	}
	.splitter.left .reopen :global(svg) {
		transform: none;
	}
	.splitter:not(.left) .reopen :global(svg) {
		transform: rotate(180deg);
	}
	.reopen:hover {
		border-color: var(--accent);
		box-shadow: var(--glow);
	}
</style>
