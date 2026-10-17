<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { project } from '#lib/state/project.svelte';
	import { playback } from '#lib/state/playback.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { view } from '#lib/state/view.svelte';
	import { gridTicks } from '#lib/core/music';
	import { PPQ } from '#lib/core/types';
	import { isAudible } from '#lib/core/engine-notes';
	import { RollController, RULER_H, rollHandle } from './controller.svelte';
	import { drawFrame, readTheme, type Frame, type Theme } from './draw';
	import LyricEditor from './LyricEditor.svelte';
	import Scrollbar from './Scrollbar.svelte';
	import SelectionBar from './SelectionBar.svelte';

	const c = new RollController();
	let host = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let theme = $state.raw<Theme | null>(null);
	let dpr = $state(1);

	// ---- sizing ---------------------------------------------------------------------

	onMount(() => {
		if (!host || !canvas) return;
		c.canvas = canvas;
		rollHandle.current = c;
		dpr = window.devicePixelRatio || 1;
		const resize = () => {
			c.width = host!.clientWidth;
			c.height = host!.clientHeight;
			c.setScroll(c.scrollX, c.scrollY);
		};
		resize();
		c.showSong();
		const ro = new ResizeObserver(resize);
		ro.observe(host);
		const onWheel = (e: WheelEvent) => c.onWheel(e);
		canvas.addEventListener('wheel', onWheel, { passive: false });
		const dprQuery = matchMedia(`(resolution: ${dpr}dppx)`);
		const onDpr = () => (dpr = window.devicePixelRatio || 1);
		dprQuery.addEventListener('change', onDpr);
		return () => {
			rollHandle.current = null;
			ro.disconnect();
			canvas?.removeEventListener('wheel', onWheel);
			dprQuery.removeEventListener('change', onDpr);
		};
	});

	// Theme colours come from CSS variables; re-read whenever the theme changes.
	$effect(() => {
		void settings.data.theme;
		if (!host) return;
		queueMicrotask(() => (theme = readTheme(host!)));
		const mq = matchMedia('(prefers-color-scheme: light)');
		const onChange = () => (theme = readTheme(host!));
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	// ---- painting -------------------------------------------------------------------------

	let raf = 0;
	let pendingFrame: Frame | null = null;

	function paint() {
		raf = 0;
		const ctx = canvas?.getContext('2d');
		if (!ctx || !pendingFrame) return;
		drawFrame(ctx, pendingFrame);
	}

	$effect(() => {
		if (!theme || !canvas || c.width < 10 || c.height < 10) return;
		const w = c.width;
		const h = c.height;
		const backingW = Math.round(w * dpr);
		const backingH = Math.round(h * dpr);
		untrack(() => {
			if (canvas!.width !== backingW || canvas!.height !== backingH) {
				canvas!.width = backingW;
				canvas!.height = backingH;
			}
		});

		const showPlayhead = playback.playing || playback.positionMs > 0;
		pendingFrame = {
			w,
			h,
			dpr,
			keysW: c.keysW,
			rulerH: RULER_H,
			scrollX: c.scrollX,
			scrollY: c.scrollY,
			ppt: view.pxPerTick,
			keyH: view.keyHeight,
			notes: project.notes,
			selection: project.selection,
			playTick: showPlayhead ? playback.positionTick : (null as number | null),
			tempoMap: project.tempoMap,
			tempos: project.tempos,
			measureTicks: project.ticksPerMeasure(),
			beatTicks: (PPQ * 4) / project.timeSignature.denominator,
			gridTicks: gridTicks(settings.data.gridDivision),
			showNames: settings.data.showNoteNames,
			unknown: playback.unknownLyrics,
			hoverId: c.hoverId,
			trackStyles: new Map(
				project.tracks.map((t) => [t.id, { color: t.color, muted: !isAudible(t, project.tracks) }])
			),
			activeTrack: project.activeTrack,
			tool: view.tool,
			touch: ui.touch,
			selectedPoint: c.selectedPoint,
			trackCurves: project.tracks
				.filter((t) => t.pitchCurve.length)
				.map((t) => ({
					color: t.color,
					muted: !isAudible(t, project.tracks),
					active: t.id === project.activeTrack,
					strokes: t.pitchCurve
				})),
			liveStroke: c.liveStroke
				? {
						color: project.tracks.find((t) => t.id === c.liveStroke!.track)?.color ?? '#ffffff',
						pts: c.liveStroke.pts
					}
				: null,
			notePitchMode: settings.data.pitchMode === 'note',
			rubber: c.rubber,
			guideTick: c.guideTick,
			pressedKey: c.pressedKey,
			editingLyricId: c.editingLyricId,
			theme
		};
		if (!raf) raf = requestAnimationFrame(paint);
	});

	// ---- behaviours -----------------------------------------------------------------------------

	$effect(() => {
		const playing = playback.playing;
		const tick = playback.positionTick;
		if (playing && settings.data.followPlayhead) untrack(() => c.revealTick(tick));
	});

	$effect(() => {
		void project.loadCount;
		untrack(() => c.showSong());
	});

	// Tools other than "pitch" do not use a selected pitch point.
	$effect(() => {
		if (view.tool !== 'pitch') c.selectedPoint = null;
	});

	// Keep the scroll position valid when zooming / resizing the content.
	$effect(() => {
		void view.pxPerTick;
		void view.keyHeight;
		untrack(() => c.setScroll(c.scrollX, c.scrollY));
	});

	function onKeyDownLocal(e: KeyboardEvent) {
		if (e.key === 'Escape') c.selectedPoint = null;
	}
</script>

<svelte:window onkeydown={onKeyDownLocal} />

<div class="roll" bind:this={host} id="piano-roll" class:touch={ui.touch}>
	<canvas
		bind:this={canvas}
		style:width="{c.width}px"
		style:height="{c.height}px"
		style:cursor={c.cursor}
		onmousedown={(e) => e.preventDefault()}
		onpointerdown={c.onPointerDown}
		onpointermove={c.onPointerMove}
		onpointerup={c.onPointerUp}
		onpointercancel={c.onPointerCancel}
		onpointerleave={c.onPointerLeave}
		oncontextmenu={c.onContextMenu}
	></canvas>

	<Scrollbar
		orientation="x"
		content={c.contentWidth}
		viewport={c.width - c.keysW}
		offset={c.scrollX}
		inset={c.keysW}
		onscroll={(v) => c.setScroll(v, c.scrollY)}
	/>
	<Scrollbar
		orientation="y"
		content={c.contentHeight}
		viewport={c.height - RULER_H}
		offset={c.scrollY}
		inset={RULER_H}
		onscroll={(v) => c.setScroll(c.scrollX, v)}
	/>

	<SelectionBar {c} />
	<LyricEditor {c} />

	{#if project.notes.length === 0}
		<div class="empty" aria-hidden="true">
			<p>
				{#if ui.touch}
					Pick the <b>pencil</b> tool and tap to add notes,<br />or double-tap anywhere.
				{:else}
					Double-click to add a note, or choose the <b>pencil</b> tool (B).<br />
					Drop a <b>.ust</b> / <b>.mid</b> file to import.
				{/if}
			</p>
		</div>
	{/if}
</div>

<style>
	.roll {
		position: relative;
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		background: var(--roll-bg);
		user-select: none;
		-webkit-user-select: none;
	}
	canvas {
		display: block;
		touch-action: none;
		outline: none;
	}
	.empty {
		position: absolute;
		inset: 44px 0 0 56px;
		display: grid;
		place-items: center;
		pointer-events: none;
		text-align: center;
		color: var(--muted);
		line-height: 1.7;
		padding: 20px;
	}
	.empty b {
		color: var(--accent);
	}
</style>
