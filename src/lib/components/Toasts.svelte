<script lang="ts">
	import { ui } from '#lib/state/ui.svelte';
</script>

<div class="toasts" aria-live="polite">
	{#each ui.toasts as t (t.id)}
		<div class="toast {t.kind}" role="status">{t.text}</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		top: calc(var(--topbar-h) + 24px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 90;
		display: grid;
		gap: 8px;
		width: min(440px, calc(100vw - 24px));
		pointer-events: none;
	}
	.toast {
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--panel) 92%, transparent);
		backdrop-filter: blur(12px);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow);
		font-size: 13px;
		line-height: 1.4;
		animation: drop 0.18s ease-out;
	}
	.toast.error {
		border-color: var(--danger);
		background: color-mix(in srgb, var(--danger) 18%, var(--panel));
	}
	.toast.success {
		border-color: var(--ok);
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
</style>
