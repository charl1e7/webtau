<script lang="ts">
	interface Props {
		orientation: 'x' | 'y';
		/** Total scrollable length, visible length and current offset (all px). */
		content: number;
		viewport: number;
		offset: number;
		/** Space reserved at the track start (px) */
		inset?: number;
		onscroll: (offset: number) => void;
	}
	let { orientation, content, viewport, offset, inset = 0, onscroll }: Props = $props();

	const track = $derived(Math.max(0, viewport - inset - 12));
	const ratio = $derived(content > 0 ? Math.min(1, viewport / content) : 1);
	const thumb = $derived(Math.max(28, track * ratio));
	const range = $derived(Math.max(1, content - viewport));
	const pos = $derived((offset / range) * Math.max(0, track - thumb));
	const visible = $derived(content > viewport + 1);

	let drag: { start: number; offset: number } | null = null;

	function down(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { start: orientation === 'x' ? e.clientX : e.clientY, offset };
		e.stopPropagation();
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const d = (orientation === 'x' ? e.clientX : e.clientY) - drag.start;
		onscroll(drag.offset + (d / Math.max(1, track - thumb)) * range);
	}
	function up() {
		drag = null;
	}
</script>

{#if visible}
	<div class="bar {orientation}" style:--inset="{inset}px">
		<div
			class="thumb"
			role="scrollbar"
			aria-controls="piano-roll"
			aria-orientation={orientation === 'x' ? 'horizontal' : 'vertical'}
			aria-valuenow={Math.round(offset)}
			tabindex="-1"
			style={orientation === 'x'
				? `width:${thumb}px; transform:translateX(${pos}px)`
				: `height:${thumb}px; transform:translateY(${pos}px)`}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		></div>
	</div>
{/if}

<style>
	.bar {
		position: absolute;
		z-index: 5;
		pointer-events: none;
	}
	.bar.x {
		left: var(--inset);
		right: 12px;
		bottom: 2px;
		height: 10px;
	}
	.bar.y {
		top: var(--inset);
		bottom: 12px;
		right: 2px;
		width: 10px;
	}
	.thumb {
		pointer-events: auto;
		background: var(--muted);
		opacity: 0.35;
		border-radius: 5px;
		transition: opacity 0.15s;
		touch-action: none;
	}
	.x .thumb {
		height: 100%;
	}
	.y .thumb {
		width: 100%;
	}
	.thumb:hover {
		opacity: 0.7;
	}
</style>
