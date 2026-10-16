<script lang="ts">
	import Icon from './Icon.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';
	import { project } from '#lib/state/project.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { edit } from '#lib/state/commands';

	let zipInput = $state<HTMLInputElement>();
	let folderInput = $state<HTMLInputElement>();
	let query = $state('');

	const vb = $derived(voicebank.current);
	const stats = $derived(voicebank.stats);
	const percent = $derived(stats.total ? Math.round((stats.ready / stats.total) * 100) : 0);

	const found = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const all = vb?.aliases ?? [];
		return (q ? all.filter((a) => a.toLowerCase().includes(q)) : all).slice(0, 150);
	});

	function chosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length) void voicebank.load(files);
	}

	function useAlias(alias: string) {
		if (project.selection.size) project.updateSelected({ lyric: alias });
		else {
			settings.data.defaultLyric = alias;
			ui.toast(`New notes will use “${alias}”.`);
		}
	}
</script>

<div class="panel">
	<div class="actions">
		<button class="btn primary" disabled={voicebank.loading} onclick={() => zipInput?.click()}>
			<Icon name="upload" size={18} /> Open ZIP
		</button>
		<button class="btn" disabled={voicebank.loading} onclick={() => folderInput?.click()}>
			<Icon name="folder" size={18} /> Folder
		</button>
		<input bind:this={zipInput} type="file" accept=".zip,application/zip" hidden onchange={chosen} />
		<input bind:this={folderInput} type="file" webkitdirectory hidden onchange={chosen} />
	</div>
	<p class="hint">…or drop a voicebank (.zip or folder) anywhere on the window.</p>

	{#if voicebank.loading}
		<div class="loading"><span class="spinner"></span> {ui.status}</div>
	{/if}

	{#if vb}
		<div class="card">
			{#if vb.image}<img src={vb.image} alt="" class="portrait" />{/if}
			<div class="meta">
				<strong>{vb.name}</strong>
				{#if vb.character.get('author')}<span class="muted">by {vb.character.get('author')}</span>{/if}
				<span class="muted">{vb.aliases.length} aliases · {vb.samples.size} samples</span>
				{#if vb.generatedOto}
					<span class="warn"><Icon name="alert" size={14} /> oto.ini generated from file names</span>
				{/if}
			</div>
		</div>

		<section>
			<h3>Sample analysis</h3>
			<div class="meter" role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
				<div class="fill" style:width="{percent}%"></div>
			</div>
			<div class="meter-text">
				<span>{stats.ready} / {stats.total} analyzed</span>
				{#if stats.fromCache}<span class="muted">· {stats.fromCache} from cache</span>{/if}
				{#if stats.failed}<span class="warn">· {stats.failed} failed</span>{/if}
			</div>
			<p class="hint">
				Samples are analyzed on demand when you press Play, and cached in your browser for next time.
			</p>
			{#if voicebank.warmingUp}
				<button class="btn" onclick={() => voicebank.stopAnalysis()}>Pause background analysis</button>
			{:else if stats.ready < stats.total}
				<button class="btn" onclick={() => voicebank.analyzeAll()}>Analyze everything now</button>
			{/if}
		</section>

		<section>
			<h3>Aliases</h3>
			<input type="text" placeholder="Search aliases…" bind:value={query} aria-label="Search aliases" />
			<div class="chips">
				{#each found as alias (alias)}
					<button class="chip" onclick={() => useAlias(alias)} ondblclick={edit.appendNote}>{alias}</button>
				{/each}
			</div>
			<p class="hint">
				{project.selection.size
					? 'Click an alias to apply it to the selected notes.'
					: 'Click an alias to use it for new notes.'}
			</p>
		</section>
	{:else if !voicebank.loading}
		<div class="empty">
			<Icon name="mic" size={30} />
			<p>No voicebank loaded</p>
			<span class="hint">WebTAU works with UTAU voicebanks (oto.ini + WAV samples).</span>
		</div>
	{/if}
</div>

<style>
	.panel {
		padding: 14px;
		display: grid;
		gap: 12px;
		align-content: start;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.actions .btn {
		flex: 1;
	}
	.card {
		display: flex;
		gap: 12px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--panel-2);
	}
	.portrait {
		width: 64px;
		height: 64px;
		border-radius: 10px;
		object-fit: cover;
		flex: none;
	}
	.meta {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.meta strong {
		font-size: 15px;
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--muted);
		font-size: 12px;
	}
	.warn {
		color: var(--warn);
		font-size: 12px;
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.meter {
		height: 8px;
		border-radius: 4px;
		background: var(--panel-3);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--accent-strong));
		transition: width 0.2s;
	}
	.meter-text {
		display: flex;
		gap: 6px;
		margin: 6px 0;
		font-size: 12px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 8px;
		max-height: 260px;
		overflow-y: auto;
	}
	.chip {
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--panel-3);
		font-size: 12px;
		min-height: 26px;
	}
	.chip:hover {
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 28px 12px;
		text-align: center;
		color: var(--muted);
		border: 1px dashed var(--border);
		border-radius: 12px;
	}
	.empty p {
		margin: 4px 0 0;
		color: var(--text);
		font-weight: 600;
	}
	.loading {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.spinner {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid var(--panel-3);
		border-top-color: var(--accent);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.hint {
		margin: 0;
	}
</style>
