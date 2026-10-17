<script lang="ts">
	import Icon from './Icon.svelte';
	import { edit } from '#lib/state/commands';
	import { editMenu, fileMenu, mainMenu } from '#lib/state/menus';
	import { playback } from '#lib/state/playback.svelte';
	import { project } from '#lib/state/project.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { asset } from '$app/paths';

	function dropdown(e: MouseEvent, items: () => ReturnType<typeof fileMenu>) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		ui.openMenu({ x: r.left, y: r.bottom + 4, items: items() });
	}

	const time = $derived.by(() => {
		const s = Math.max(0, playback.positionMs) / 1000;
		const m = Math.floor(s / 60);
		return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
	});

	const position = $derived.by(() => {
		const measure = project.ticksPerMeasure();
		const tick = Math.max(0, playback.positionTick);
		const bar = Math.floor(tick / measure) + 1;
		const beatTicks = measure / project.timeSignature.numerator;
		const beat = Math.floor((tick % measure) / beatTicks) + 1;
		return `${bar}.${beat}`;
	});

	const bpm = $derived(Math.round(project.primaryTempo * 10) / 10);
</script>

<header class="topbar card">
	<div class="left">
		{#if ui.compact}
			<button class="icon-btn" aria-label="Menu" onclick={(e) => dropdown(e, mainMenu)}>
				<Icon name="menu" />
			</button>
		{:else}
			<button class="brand" onclick={() => ui.openDialog('about')} aria-label="About WebTAU">
				<img src={asset('favicon.png')} alt="" width="26" height="26" />
				<span>WebTAU</span>
			</button>
			<button class="btn ghost" onclick={(e) => dropdown(e, fileMenu)}>File</button>
			<button class="btn ghost" onclick={(e) => dropdown(e, editMenu)}>Edit</button>
		{/if}
	</div>

	<div class="transport" role="group" aria-label="Transport">
		{#if !ui.compact}
			<button
				class="icon-btn"
				title="Back to start (Home)"
				aria-label="Back to start"
				onclick={() => playback.stop()}
			>
				<Icon name="rewind" />
			</button>
		{:else if playback.playing || playback.positionMs > 0}
			<button class="icon-btn" title="Stop" aria-label="Stop" onclick={() => playback.stop()}>
				<Icon name="stop" size={18} />
			</button>
		{/if}
		<button
			class="icon-btn accent play"
			title={playback.playing ? 'Pause (Space)' : 'Play (Space)'}
			aria-label={playback.playing ? 'Pause' : 'Play'}
			onclick={() => playback.toggle()}
		>
			{#if playback.busy}
				<span class="spinner" aria-hidden="true"></span>
			{:else}
				<Icon name={playback.playing ? 'pause' : 'play'} />
			{/if}
		</button>
		<div class="clock" title="Playhead">
			<span class="time">{time}</span>
			{#if !ui.compact}<span class="pos">{position}</span>{/if}
		</div>
		{#if playback.busy}
			<div class="progress" title={playback.message}>
				<div class="bar" style:width="{Math.round(playback.progress * 100)}%"></div>
			</div>
		{/if}
	</div>

	<div class="right">
		{#if !ui.compact}
			<button
				class="btn tempo"
				onclick={() => ui.openDialog('tempo', { tick: 0 })}
				title="Tempo & time signature"
			>
				♩ {bpm}
				<span class="sig"
					>{project.timeSignature.numerator}/{project.timeSignature.denominator}</span
				>
			</button>
		{/if}
		<button
			class="icon-btn"
			title="Undo (Ctrl+Z)"
			aria-label="Undo"
			disabled={!project.canUndo}
			onclick={edit.undo}
		>
			<Icon name="undo" />
		</button>
		<button
			class="icon-btn"
			title="Redo (Ctrl+Shift+Z)"
			aria-label="Redo"
			disabled={!project.canRedo}
			onclick={edit.redo}
		>
			<Icon name="redo" />
		</button>
		{#if !ui.compact}
			<button
				class="icon-btn"
				class:active={ui.leftOpen}
				title="Voicebank panel"
				aria-label="Toggle voicebank panel"
				onclick={() => (ui.leftOpen = !ui.leftOpen)}
			>
				<Icon name="mic" />
			</button>
			<button
				class="icon-btn"
				class:active={ui.rightOpen}
				title="Note properties"
				aria-label="Toggle properties panel"
				onclick={() => (ui.rightOpen = !ui.rightOpen)}
			>
				<Icon name="sliders" />
			</button>
			<button
				class="icon-btn"
				title="Settings"
				aria-label="Settings"
				onclick={() => ui.openDialog('settings')}
			>
				<Icon name="settings" />
			</button>
		{:else}
			<button
				class="btn tempo compact-tempo"
				onclick={() => ui.openDialog('tempo', { tick: 0 })}
				aria-label="Tempo"
			>
				♩{bpm}
			</button>
		{/if}
	</div>
</header>

<style>
	.topbar {
		height: var(--topbar-h);
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		flex: none;
		overflow: visible;
	}
	.left,
	.right {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}
	.right {
		justify-content: flex-end;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 750;
		font-size: 17px;
		letter-spacing: 0.02em;
		margin-right: 10px;
	}
	.brand span {
		background: linear-gradient(135deg, #ffffff 0%, #ffc2da 55%, #ff7ab0 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	.brand img {
		border-radius: 8px;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.1),
			0 4px 14px rgba(255, 61, 143, 0.3);
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 8px;
		position: relative;
		padding: 5px 14px 5px 8px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.45);
	}
	.play {
		width: 42px;
		height: 42px;
		border-radius: 50%;
	}
	.clock {
		display: grid;
		min-width: 66px;
		text-align: center;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
	}
	.time {
		font-weight: 700;
		font-size: 16px;
		letter-spacing: 0.02em;
		text-shadow: 0 0 14px rgba(255, 61, 143, 0.55);
	}
	.pos {
		color: var(--muted);
		font-size: 11px;
	}
	.tempo {
		min-height: 34px;
		padding: 0 12px;
		margin-right: 6px;
		font-variant-numeric: tabular-nums;
		border-radius: 999px;
	}
	.sig {
		color: var(--muted);
		font-size: 12px;
	}
	.progress {
		position: absolute;
		left: 18px;
		right: 18px;
		bottom: -1px;
		height: 3px;
		border-radius: 2px;
		background: var(--panel-3);
		overflow: hidden;
	}
	.bar {
		height: 100%;
		background: var(--accent);
		transition: width 0.1s linear;
	}
	.spinner {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2.5px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: currentColor;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 820px), (max-height: 520px) {
		.topbar {
			padding: 0 6px;
			grid-template-columns: auto minmax(0, 1fr) auto;
			gap: 4px;
		}
		.transport {
			justify-self: center;
			padding: 4px 12px 4px 5px;
			gap: 6px;
		}
		.clock {
			min-width: 52px;
		}
		.time {
			font-size: 15px;
		}
		.compact-tempo {
			min-height: 38px;
			padding: 0 9px;
			margin: 0 0 0 2px;
		}
		:global(:root) {
			--topbar-h: 50px;
		}
	}
</style>
