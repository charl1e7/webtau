<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
		width?: number;
	}
	let { title, onclose, children, footer, width = 520 }: Props = $props();

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
		}
	}
</script>

<svelte:window onkeydown={key} />

<div
	class="backdrop"
	role="presentation"
	onpointerdown={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="dialog" role="dialog" aria-modal="true" aria-label={title} style:--w="{width}px">
		<header>
			<h2>{title}</h2>
			<button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="close" /></button>
		</header>
		<div class="body">{@render children()}</div>
		{#if footer}<footer>{@render footer()}</footer>{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(4, 4, 6, 0.6);
		backdrop-filter: blur(8px);
		animation: fade 0.15s ease-out;
	}
	.dialog {
		width: min(var(--w), 100%);
		max-height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 18px;
		box-shadow:
			var(--shadow),
			0 0 0 1px rgba(255, 255, 255, 0.03) inset;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 10px 6px 20px;
	}
	h2 {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		color: var(--accent-2);
	}
	.body {
		padding: 8px 20px 16px;
		overflow-y: auto;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--border);
		background: rgba(0, 0, 0, 0.22);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
