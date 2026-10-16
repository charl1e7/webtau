<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';
	import { ui, type MenuItem } from '#lib/state/ui.svelte';

	let menu = $derived(ui.menu);
	let stack = $state.raw<{ title: string; items: MenuItem[] }[]>([]);
	let el = $state<HTMLDivElement>();
	let pos = $state({ left: 0, top: 0 });

	// A finger that opened the menu with a long-press is still lifting; its
	// synthesized click must not activate the item underneath.
	let openedAt = 0;
	$effect(() => {
		stack = menu ? [{ title: '', items: menu.items }] : [];
		openedAt = performance.now();
	});

	const current = $derived(stack[stack.length - 1]);

	// Keep the menu inside the window.
	$effect(() => {
		if (!menu || !el || ui.compact) return;
		void current;
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		pos = {
			left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
			top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8))
		};
	});

	function pick(item: MenuItem) {
		if (item.disabled || (menu?.guard && performance.now() - openedAt < 400)) return;
		if (item.children) {
			stack = [...stack, { title: item.label ?? '', items: item.children }];
			return;
		}
		ui.closeMenu();
		item.action?.();
	}

	function key(e: KeyboardEvent) {
		if (!menu) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (stack.length > 1) stack = stack.slice(0, -1);
			else ui.closeMenu();
		}
	}
</script>

<svelte:window onkeydown={key} />

{#if menu}
	<div
		class="backdrop"
		class:compact={ui.compact}
		role="presentation"
		onpointerdown={ui.closeMenu}
		oncontextmenu={(e) => e.preventDefault()}
	></div>
	<div
		bind:this={el}
		class="menu"
		class:compact={ui.compact}
		role="menu"
		style={ui.compact ? '' : `left:${pos.left}px; top:${pos.top}px`}
	>
		{#if stack.length > 1}
			<button class="item back" onclick={() => (stack = stack.slice(0, -1))}>
				<Icon name="chevronRight" size={16} /> <span class="rot">{current.title}</span>
			</button>
		{/if}
		{#each current?.items ?? [] as item, i (i)}
			{#if item.separator}
				<hr />
			{:else}
				<button
					class="item"
					class:danger={item.danger}
					class:header={item.disabled && !item.action && !item.children}
					role="menuitem"
					disabled={item.disabled}
					onclick={() => pick(item)}
				>
					<span class="icon"
						>{#if item.icon}<Icon name={item.icon as IconName} size={17} />{/if}</span
					>
					<span class="label">{item.label}</span>
					{#if item.hint && !ui.compact}<span class="hint">{item.hint}</span>{/if}
					{#if item.children}<Icon name="chevronRight" size={16} />{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 70;
	}
	.backdrop.compact {
		background: rgba(0, 0, 0, 0.4);
	}
	.menu {
		position: fixed;
		z-index: 71;
		min-width: 220px;
		max-width: min(320px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 5px;
		background: color-mix(in srgb, var(--panel) 94%, transparent);
		backdrop-filter: blur(14px);
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		box-shadow: var(--shadow);
		animation: pop 0.1s ease-out;
	}
	.menu.compact {
		left: 0;
		right: 0;
		bottom: 0;
		top: auto;
		max-width: none;
		max-height: 72vh;
		border-radius: 20px 20px 0 0;
		padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
		animation: rise 0.18s ease-out;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 34px;
		padding: 0 10px;
		border-radius: 8px;
		text-align: left;
	}
	.compact .item {
		min-height: 48px;
		font-size: 15px;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: linear-gradient(90deg, rgba(255, 61, 143, 0.2), rgba(255, 61, 143, 0.05));
	}
	.item.danger {
		color: var(--danger);
	}
	.item.header {
		opacity: 0.7;
		font-size: 12px;
		font-weight: 600;
	}
	.item.back {
		color: var(--muted);
		font-weight: 600;
	}
	.item.back :global(svg) {
		transform: rotate(180deg);
	}
	.icon {
		width: 18px;
		display: grid;
		place-items: center;
		color: var(--muted);
	}
	.label {
		flex: 1;
	}
	.hint {
		color: var(--muted);
		font-size: 12px;
		margin-left: 18px;
	}
	hr {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 4px 6px;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.97);
		}
	}
	@keyframes rise {
		from {
			transform: translateY(30px);
			opacity: 0;
		}
	}
</style>
