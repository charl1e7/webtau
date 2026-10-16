<script lang="ts">
	import Icon from '../Icon.svelte';
	import { edit, pitch } from '#lib/state/commands';
	import { noteMenu } from '#lib/state/menus';
	import { project } from '#lib/state/project.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { view } from '#lib/state/view.svelte';
	import type { PitchShape } from '#lib/core/types';
	import type { RollController } from './controller.svelte';

	let { c }: { c: RollController } = $props();

	const count = $derived(project.selection.size);
	const single = $derived(count === 1 ? project.selectedNotes[0] : null);
	const point = $derived(c.selectedPoint);
	const pointNote = $derived(point ? project.notes.find((n) => n.id === point.noteId) : null);
	const pointShape = $derived(pointNote?.pitchPoints.find((p) => p.id === point?.pointId)?.shape);

	function setShape(shape: PitchShape) {
		if (!point) return;
		project.edit((notes) =>
			notes.map((n) =>
				n.id === point.noteId
					? { ...n, pitchPoints: n.pitchPoints.map((p) => (p.id === point.pointId ? { ...p, shape } : p)) }
					: n
			)
		);
	}

	function more(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const first = project.selectedNotes[0];
		if (first) ui.openMenu({ x: r.left, y: r.top, items: noteMenu(first.id) });
	}

	const SHAPES: { shape: PitchShape; label: string }[] = [
		{ shape: 'l', label: 'Linear' },
		{ shape: 's', label: 'Smooth (S-curve)' },
		{ shape: 'r', label: 'Fast then slow' },
		{ shape: 'j', label: 'Slow then fast' }
	];
</script>

{#if count > 0}
	<div class="bar" class:compact={ui.compact} role="toolbar" aria-label="Selection actions">
		{#if view.tool === 'pitch'}
			{#if point}
				{#each SHAPES as s (s.shape)}
					<button
						class="icon-btn"
						class:active={pointShape === s.shape}
						title={s.label}
						onclick={() => setShape(s.shape)}
					>
						<span class="shape">{s.shape === 'l' ? '╱' : s.shape === 's' ? '∫' : s.shape === 'r' ? '⌒' : '⌐'}</span>
					</button>
				{/each}
				<button
					class="icon-btn"
					title="Delete point"
					onclick={() => point && c.deletePoint(point.noteId, point.pointId)}
				>
					<Icon name="trash" />
				</button>
				<span class="sep"></span>
			{/if}
			<button class="btn ghost" onclick={() => pitch.portamento()} title="Slide in from the previous note">
				Portamento
			</button>
			<button class="btn ghost" onclick={() => pitch.vibrato(true)} title="Add vibrato">Vibrato</button>
			<button class="icon-btn" title="Clear pitch curve" onclick={pitch.clear}><Icon name="eraser" /></button>
		{:else}
			{#if single}
				<button class="icon-btn" title="Edit lyric (Enter)" onclick={() => (ui.requestLyricEdit = single.id)}>
					<Icon name="text" />
				</button>
			{/if}
			<button class="icon-btn" title="Shorter (Alt+←)" onclick={() => edit.adjustLength(-1)}>
				<Icon name="minus" />
			</button>
			<span class="label"><Icon name="stretch" size={16} /></span>
			<button class="icon-btn" title="Longer (Alt+→)" onclick={() => edit.adjustLength(1)}>
				<Icon name="plus" />
			</button>
			<span class="sep"></span>
			<button class="icon-btn" title="Duplicate (Ctrl+D)" onclick={edit.duplicate}>
				<Icon name="duplicate" />
			</button>
			<button class="icon-btn danger" title="Delete (Del)" onclick={edit.delete}>
				<Icon name="trash" />
			</button>
			<button class="icon-btn" title="More actions" onclick={more}><Icon name="more" /></button>
		{/if}
	</div>
{/if}

<style>
	.bar {
		position: absolute;
		top: 40px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: color-mix(in srgb, var(--panel) 92%, transparent);
		backdrop-filter: blur(10px);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow);
		max-width: calc(100% - 20px);
		overflow-x: auto;
	}
	.bar.compact {
		top: auto;
		bottom: 14px;
	}
	.icon-btn.danger {
		color: var(--danger);
	}
	.sep {
		width: 1px;
		height: 22px;
		background: var(--border);
		margin: 0 4px;
	}
	.label {
		display: grid;
		place-items: center;
		color: var(--muted);
		width: 20px;
	}
	.shape {
		font-size: 18px;
		line-height: 1;
	}
</style>
