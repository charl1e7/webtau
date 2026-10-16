<script lang="ts">
	import { playback } from '#lib/state/playback.svelte';
	import { project } from '#lib/state/project.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';

	const analysis = $derived(voicebank.stats);
	const analyzing = $derived(voicebank.current && (voicebank.warmingUp || analysis.running > 0));
</script>

<footer class="status" class:compact={ui.compact}>
	<span class="msg">{playback.busy ? playback.message : ui.status}</span>
	<span class="spacer"></span>
	{#if analyzing && analysis.total}
		<span class="chip" title="Background analysis of samples">
			Analyzing {analysis.ready}/{analysis.total}
		</span>
	{/if}
	{#if !ui.compact}
		<span class="chip">{voicebank.current?.name ?? 'No voicebank'}</span>
		<span class="chip">{project.name}{project.dirty ? ' •' : ''}</span>
	{/if}
</footer>

<style>
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 12px;
		font-size: 12px;
		color: var(--muted);
		flex: none;
		white-space: nowrap;
	}
	.status.compact {
		display: none;
	}
	.msg {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip {
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--panel);
		border: 1px solid var(--border);
	}
</style>
