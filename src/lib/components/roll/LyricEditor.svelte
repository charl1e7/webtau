<script lang="ts">
	import { tick } from 'svelte';
	import { project } from '#lib/state/project.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';
	import { edit } from '#lib/state/commands';
	import type { RollController } from './controller.svelte';
	import { RULER_H } from './controller.svelte';

	let { c }: { c: RollController } = $props();

	let input = $state<HTMLInputElement>();
	let list = $state<HTMLUListElement>();
	let text = $state('');
	let index = $state(0);
	let openedFor: string | null = null;

	const note = $derived(c.editingLyricId ? project.notes.find((n) => n.id === c.editingLyricId) : null);

	const matches = $derived.by(() => {
		const q = text.trim().toLowerCase();
		const all = voicebank.aliases;
		if (!q) return all.slice(0, 60);
		const starts: string[] = [];
		const contains: string[] = [];
		for (const a of all) {
			const l = a.toLowerCase();
			if (l.startsWith(q)) starts.push(a);
			else if (l.includes(q)) contains.push(a);
			if (starts.length >= 60) break;
		}
		return [...starts, ...contains].slice(0, 60);
	});

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

	function key(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commit(matches[index] && text.trim() !== matches[index] && index > 0 ? matches[index] : text);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			commit(matches[index] && index > 0 ? matches[index] : text, true);
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
			oninput={() => (index = 0)}
			onkeydown={key}
			onblur={() => setTimeout(() => c.editingLyricId && commit(), 120)}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			enterkeyhint="done"
			aria-label="Lyric"
		/>
		{#if matches.length}
			<ul bind:this={list} role="listbox">
				{#each matches as alias, i (alias)}
					<li
						role="option"
						aria-selected={i === index}
						class:active={i === index}
						onpointerdown={(e) => {
							e.preventDefault();
							commit(alias);
						}}
					>
						{alias}
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
		padding: 5px 12px;
		cursor: pointer;
		white-space: nowrap;
		font-size: 13px;
	}
	.compact li {
		padding: 10px 14px;
		font-size: 15px;
	}
	li.active,
	li:hover {
		background: var(--accent);
		color: var(--accent-contrast);
	}
</style>
