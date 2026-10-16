<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		onclose: () => void;
		children: Snippet;
	}
	let { title, onclose, children }: Props = $props();

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={key} />

<div class="backdrop" role="presentation" onpointerdown={onclose}></div>
<div class="sheet" role="dialog" aria-label={title} tabindex="-1">
	<header>
		<div class="grabber" aria-hidden="true"></div>
		<h2>{title}</h2>
		<button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="close" /></button>
	</header>
	<div class="content">{@render children()}</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgba(0, 0, 0, 0.45);
		animation: fade 0.15s ease-out;
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 41;
		max-height: min(78vh, 640px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border-top: 1px solid var(--border);
		border-radius: 18px 18px 0 0;
		box-shadow: var(--shadow);
		padding-bottom: env(safe-area-inset-bottom);
		animation: rise 0.2s ease-out;
	}
	header {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 8px 4px 18px;
	}
	.grabber {
		position: absolute;
		top: 6px;
		left: 50%;
		width: 38px;
		height: 4px;
		margin-left: -19px;
		border-radius: 2px;
		background: var(--border);
	}
	h2 {
		margin: 0;
		font-size: 16px;
	}
	.content {
		overflow-y: auto;
		padding: 4px 18px 18px;
		overscroll-behavior: contain;
	}
	@keyframes rise {
		from {
			transform: translateY(40px);
			opacity: 0;
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
