<script lang="ts">
	import Dialog from './Dialog.svelte';
	import { lyrics } from '#lib/state/lyrics.svelte';
	import { project } from '#lib/state/project.svelte';
	import { ui } from '#lib/state/ui.svelte';

	/** What to write instead, per missing lyric; empty keeps the lyric as it is. */
	let choice = $state<Record<string, string>>({});

	const groups = $derived(lyrics.groups);
	const rows = $derived(
		groups.map((g) => ({
			...g,
			value: choice[g.lyric] ?? g.suggestions[0]?.alias ?? ''
		}))
	);
	const pending = $derived(rows.filter((r) => r.value.trim() && r.value.trim() !== r.lyric));
	const noteCount = $derived(groups.reduce((n, g) => n + g.noteIds.length, 0));

	function apply() {
		const changes = new Map<string, string>();
		for (const r of pending) for (const id of r.noteIds) changes.set(id, r.value.trim());
		if (changes.size)
			project.edit((notes) =>
				notes.map((n) => (changes.has(n.id) ? { ...n, lyric: changes.get(n.id)! } : n))
			);
		ui.toast(`${changes.size} note(s) updated.`, 'success');
		choice = {};
		if (!lyrics.groups.length) ui.closeDialog();
	}
</script>

<Dialog title="Fix lyrics" onclose={ui.closeDialog} width={560}>
	{#if !rows.length}
		<p class="hint">Every lyric matches the loaded voicebank.</p>
	{:else}
		<p class="hint">
			{rows.length} lyric(s) on {noteCount} note(s) are not in the voicebank. The closest alias is filled
			in: change it, or clear the field to keep the lyric.
		</p>
		<div class="rows" role="list">
			{#each rows as r (r.lyric)}
				<div class="row" role="listitem">
					<span class="from"><b>{r.lyric}</b> <span class="count">× {r.noteIds.length}</span></span>
					<span class="arrow" aria-hidden="true">→</span>
					<input
						type="text"
						list="fix-{r.lyric}"
						autocomplete="off"
						autocapitalize="off"
						aria-label="Replacement for {r.lyric}"
						value={r.value}
						placeholder="keep"
						oninput={(e) => (choice[r.lyric] = e.currentTarget.value)}
					/>
					<datalist id="fix-{r.lyric}">
						{#each r.suggestions as s (s.alias)}
							<option value={s.alias} label="{s.alias} · {s.why}"></option>
						{/each}
					</datalist>
				</div>
			{/each}
		</div>
	{/if}
	{#snippet footer()}
		<button class="btn" onclick={ui.closeDialog}>{rows.length ? 'Skip' : 'Close'}</button>
		{#if rows.length}
			<button class="btn primary" disabled={!pending.length} onclick={apply}
				>Replace {pending.length} lyric(s)</button
			>
		{/if}
	{/snippet}
</Dialog>

<style>
	.rows {
		display: grid;
		gap: 8px;
		margin-top: 10px;
		max-height: 50vh;
		overflow-y: auto;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(80px, 1fr) auto minmax(110px, 1.2fr);
		align-items: center;
		gap: 10px;
	}
	.count {
		color: var(--muted);
		font-size: 12px;
	}
	.arrow {
		color: var(--muted);
	}
	input {
		min-height: var(--hit);
	}
</style>
