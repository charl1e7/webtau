<script lang="ts">
	import { tick } from 'svelte';
	import { project } from '#lib/state/project.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { lyrics } from '#lib/state/lyrics.svelte';
	import { edit } from '#lib/state/commands';
	import type { RollController } from './controller.svelte';
	import { RULER_H } from './controller.svelte';

	let { c }: { c: RollController } = $props();

	let input = $state<HTMLInputElement>();
	let list = $state<HTMLUListElement>();
	let text = $state('');
	let index = $state(0);
	/** The list shows everything until the user starts typing. */
	let typed = $state(false);
	let openedFor: string | null = null;
	/** The list entry a finger/mouse went down on; it is picked only if the same pointer lifts without scrolling. */
	let press: { id: number; x: number; y: number; alias: string } | null = null;

	const note = $derived(
		c.editingLyricId ? project.notes.find((n) => n.id === c.editingLyricId) : null
	);

	/** Plugins decide what is listed: by spelling, and across scripts (ra → ら). */
	const matches = $derived(note ? lyrics.suggestFor(typed ? text : '', note.pitch, 60) : []);

	// Open on request from menus / shortcuts.
	$effect(() => {
		const id = ui.requestLyricEdit;
		if (id) {
			ui.requestLyricEdit = null;
			project.select([id]);
			c.editingLyricId = id;
		}
	});

	$effect(() => {
		if (note && openedFor !== note.id) {
			openedFor = note.id;
			text = note.lyric;
			index = 0;
			typed = false;
			void tick().then(() => {
				input?.focus();
				input?.select();
			});
		}
		if (!note) openedFor = null;
	});

	// Keep the note on screen while editing.
	$effect(() => {
		if (note) c.revealTick(note.tick, 120);
	});

	const box = $derived.by(() => {
		if (!note) return '';
		const x = c.xAtTick(note.tick);
		const y = c.rowTop(note.pitch);
		const w = Math.max(110, note.length * c.ppt);
		return `left:${x}px; top:${y}px; width:${w}px; height:${c.keyH}px;`;
	});
	/** On phones the list must fit between the editor and the bottom of the roll, or part of it is clipped. */
	const maxListHeight = $derived(Math.max(96, Math.min(c.height - RULER_H - 70, 320)));
	const below = $derived(note ? c.rowTop(note.pitch) < 200 : false);

	function commit(value = text, advance = false) {
		if (!c.editingLyricId) return;
		const id = c.editingLyricId;
		const v = value.trim();
		if (v && v !== note?.lyric) edit.setLyric(id, v);
		c.editingLyricId = null;
		if (advance) {
			const sorted = [...project.notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
			const next = sorted[sorted.findIndex((n) => n.id === id) + 1];
			if (next) {
				project.select([next.id]);
				c.editingLyricId = next.id;
			}
		}
	}

	function cancel() {
		c.editingLyricId = null;
	}

	// Picking is driven by pointer events on the list itself instead of `click`: a click can also be
	// the tail of the double-tap that opened the editor, and the browser cancels the pointer when a
	// swipe turns into a scroll, so scrolling can never pick.
	function listDown(e: PointerEvent) {
		const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-alias]');
		press = li ? { id: e.pointerId, x: e.clientX, y: e.clientY, alias: li.dataset.alias! } : null;
	}

	function listUp(e: PointerEvent) {
		const p = press;
		press = null;
		if (!p || p.id !== e.pointerId) return;
		if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) commit(p.alias);
	}

	function key(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commit(
				matches[index] && text.trim() !== matches[index].alias && index > 0
					? matches[index].alias
					: text
			);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			commit(matches[index] && index > 0 ? matches[index].alias : text, true);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!matches.length) return;
			index = (index + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
			void tick().then(() => list?.children[index]?.scrollIntoView({ block: 'nearest' }));
		}
	}
</script>

{#if note}
	<div
		class="editor"
		class:compact={ui.compact}
		class:below
		style={ui.compact ? `top:${RULER_H + 6}px` : box}
	>
		<input
			bind:this={input}
			bind:value={text}
			oninput={() => {
				index = 0;
				typed = true;
			}}
			onkeydown={key}
			onblur={() => c.editingLyricId && commit()}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			enterkeyhint="done"
			aria-label="Lyric"
		/>
		{#if matches.length}
			<!-- Keep the input focused while the list is touched. -->
			<ul
				bind:this={list}
				role="listbox"
				style={ui.compact ? `max-height:${maxListHeight}px` : undefined}
				onmousedown={(e) => e.preventDefault()}
				onpointerdown={listDown}
				onpointerup={listUp}
				onpointercancel={() => (press = null)}
			>
				{#each matches as s, i (s.alias)}
					<li
						role="option"
						aria-selected={i === index}
						class:active={i === index}
						data-alias={s.alias}
						aria-label={s.alias}
					>
						<span class="alias">{s.alias}</span>
						{#if s.hint}<span class="reading">{s.hint}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.editor {
		position: absolute;
		z-index: 20;
	}
	.editor.compact {
		left: 8px;
		right: 8px;
		width: auto;
		height: auto;
	}
	input {
		width: 100%;
		height: 100%;
		min-height: 28px;
		border: 2px solid var(--accent);
		background: var(--panel);
		color: var(--text);
		border-radius: 6px;
		padding: 0 8px;
		font-weight: 600;
		box-shadow: var(--shadow);
	}
	.compact input {
		min-height: 44px;
		font-size: 16px;
	}
	ul {
		position: absolute;
		bottom: 100%;
		left: 0;
		min-width: 140px;
		max-width: 260px;
		max-height: 190px;
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		margin: 0 0 4px;
		padding: 4px 0;
		list-style: none;
		background: var(--panel);
		border: 1px solid var(--accent);
		border-radius: 8px;
		box-shadow: var(--shadow);
	}
	.below ul,
	.compact ul {
		bottom: auto;
		top: 100%;
		margin: 4px 0 0;
	}
	.compact ul {
		max-width: none;
		right: 0;
		max-height: 38vh;
	}
	li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		padding: 5px 12px;
		cursor: pointer;
		white-space: nowrap;
		font-size: 13px;
	}
	.compact li {
		padding: 10px 14px;
		font-size: 15px;
	}
	.reading {
		font-size: 0.85em;
		opacity: 0.6;
	}
	li.active {
		background: var(--accent);
		color: var(--accent-contrast);
	}
	/* Touch screens keep :hover on the last touched entry, which looked like a second selection. */
	@media (hover: hover) {
		li:hover {
			background: var(--accent);
			color: var(--accent-contrast);
		}
	}
</style>
