<script lang="ts">
	import { onMount } from 'svelte';
	import ContextMenu from '#lib/components/ContextMenu.svelte';
	import Dialogs from '#lib/components/Dialogs.svelte';
	import Inspector from '#lib/components/Inspector.svelte';
	import PianoRoll from '#lib/components/roll/PianoRoll.svelte';
	import { rollHandle } from '#lib/components/roll/controller.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import Splitter from '#lib/components/Splitter.svelte';
	import StatusBar from '#lib/components/StatusBar.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import ToolBar from '#lib/components/ToolBar.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import VoicebankPanel from '#lib/components/VoicebankPanel.svelte';
	import { edit, file } from '#lib/state/commands';
	import { getEngine, preloadEngine } from '#lib/state/engine';
	import { playback } from '#lib/state/playback.svelte';
	import { project } from '#lib/state/project.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { lyrics } from '#lib/state/lyrics.svelte';
	import { plugins } from '#lib/state/plugins.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { view } from '#lib/state/view.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';

	let dragging = $state(false);

	onMount(() => {
		preloadEngine();
		// Handy for debugging and automated tests: open the app with ?debug.
		if (new URLSearchParams(location.search).has('debug')) {
			Object.assign(window, {
				webtau: {
					project,
					playback,
					voicebank,
					ui,
					view,
					settings,
					file,
					edit,
					lyrics,
					plugins,
					roll: rollHandle
				}
			});
		}
		if (!new URLSearchParams(location.search).has('fresh') && project.restoreAutosave())
			ui.toast('Restored your last session.');
	});

	// Push engine-related settings to the running engine.
	$effect(() => {
		const mode = settings.data.analysisQuality === 'fast' ? 1 : 0;
		const workers = settings.workerCount;
		void getEngine()
			.then((engine) => engine.configure({ mode, workers }))
			.catch(() => {});
	});

	function isTyping(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		if (!el) return false;
		return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
	}

	function onKeyDown(e: KeyboardEvent) {
		const typing = isTyping(e.target);
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();

		if (mod) {
			if (typing && !['s', 'o', 'e'].includes(key)) return;
			const handled = (fn: () => void) => {
				e.preventDefault();
				fn();
			};
			switch (key) {
				case 'z':
					return handled(e.shiftKey ? edit.redo : edit.undo);
				case 'y':
					return handled(edit.redo);
				case 'a':
					return handled(edit.selectAll);
				case 'c':
					return handled(edit.copy);
				case 'x':
					return handled(edit.cut);
				case 'v':
					return handled(edit.paste);
				case 'd':
					return handled(edit.duplicate);
				case 's':
					return handled(() => void file.save());
				case 'o':
					return handled(() => void file.open());
				case 'e':
					return handled(() => void file.exportWav());
				case 'l':
					return handled(() => ui.openDialog('lyrics'));
			}
			return;
		}
		if (typing || ui.dialog) return;

		const selected = project.selection.size > 0;
		const grid = settings.data.gridDivision;
		void grid;
		switch (e.key) {
			case ' ':
				if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
				e.preventDefault();
				void playback.toggle();
				return;
			case 'Home':
				e.preventDefault();
				playback.stop();
				return;
			case 'Delete':
			case 'Backspace':
				if (selected) {
					e.preventDefault();
					edit.delete();
				}
				return;
			case 'Enter':
			case 'F2':
				if (project.selection.size === 1) {
					e.preventDefault();
					ui.requestLyricEdit = [...project.selection][0];
				}
				return;
			case 'Escape':
				project.clearSelection();
				return;
			case 'ArrowLeft':
			case 'ArrowRight': {
				e.preventDefault();
				const dir = e.key === 'ArrowLeft' ? -1 : 1;
				if (e.altKey) edit.adjustLength(dir);
				else if (selected) edit.nudge((dir * (480 * 4)) / settings.data.gridDivision);
				else rollHandle.current?.scrollBy(dir * 120, 0);
				return;
			}
			case 'ArrowUp':
			case 'ArrowDown': {
				e.preventDefault();
				const dir = e.key === 'ArrowUp' ? 1 : -1;
				if (selected) edit.transpose(dir * (e.shiftKey ? 12 : 1));
				else rollHandle.current?.scrollBy(0, -dir * 80);
				return;
			}
			case '+':
			case '=':
				rollHandle.current?.zoomCenter(1.25, 1);
				return;
			case '-':
			case '_':
				rollHandle.current?.zoomCenter(1 / 1.25, 1);
				return;
			case '?':
				ui.openDialog('shortcuts');
				return;
		}
		switch (key) {
			case 'v':
				return view.setTool('select');
			case 'b':
				return view.setTool('draw');
			case 'p':
				return view.setTool('pitch');
			case 'e':
				return view.setTool('erase');
		}
	}

	// ---- drag & drop import -----------------------------------------------------------------

	function onDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}

	function onDrop(e: DragEvent) {
		dragging = false;
		const item = e.dataTransfer?.items[0];
		if (!item || item.kind !== 'file') return;
		e.preventDefault();
		// Entries are only valid during the event, so grab everything now.
		const entry = item.webkitGetAsEntry();
		const dropped = e.dataTransfer?.files[0];
		const name = (dropped?.name ?? entry?.name ?? '').toLowerCase();
		if (/\.(ust|ustx|vsqx|mid|midi|json|webtau)$/.test(name) && dropped)
			void file.openDropped(dropped);
		else if (entry) void voicebank.load(entry);
	}

	function beforeUnload(e: BeforeUnloadEvent) {
		if (project.dirty && project.notes.length) e.preventDefault();
	}
</script>

<svelte:window
	onkeydown={onKeyDown}
	ondragover={onDragOver}
	ondragleave={(e) => !e.relatedTarget && (dragging = false)}
	ondrop={onDrop}
	onbeforeunload={beforeUnload}
/>

<div class="app" class:compact={ui.compact}>
	<TopBar />

	<div class="body">
		{#if !ui.compact}
			{#if ui.leftOpen}
				<aside
					class="side card left"
					style:width="{settings.data.leftWidth}px"
					aria-label="Voicebank"
				>
					<VoicebankPanel />
				</aside>
			{/if}
			<Splitter side="left" />
		{/if}

		<main class="center card">
			{#if !ui.compact}
				<ToolBar zoom={(fx, fy) => rollHandle.current?.zoomCenter(fx, fy)} />
			{/if}
			<PianoRoll />
			{#if ui.compact}
				<ToolBar zoom={(fx, fy) => rollHandle.current?.zoomCenter(fx, fy)} />
			{/if}
		</main>

		{#if !ui.compact}
			<Splitter side="right" />
			{#if ui.rightOpen}
				<aside
					class="side card right"
					style:width="{settings.data.rightWidth}px"
					aria-label="Properties"
				>
					<Inspector />
				</aside>
			{/if}
		{/if}
	</div>

	<StatusBar />

	{#if ui.compact && ui.panel === 'voicebank'}
		<Sheet title="Voicebank" onclose={() => (ui.panel = null)}><VoicebankPanel /></Sheet>
	{:else if ui.compact && ui.panel === 'inspector'}
		<Sheet title="Properties" onclose={() => (ui.panel = null)}><Inspector /></Sheet>
	{/if}

	<Dialogs />
	<ContextMenu />
	<Toasts />

	{#if dragging}
		<div class="drop" aria-hidden="true">
			<div>Drop a voicebank (.zip / folder), a .ust, .ustx, .mid or project file</div>
		</div>
	{/if}
</div>

<style>
	.app {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		padding: 12px 12px 6px;
		gap: 12px;
	}
	.app.compact {
		padding: 6px 6px 0;
		gap: 6px;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.compact .body {
		gap: 6px;
	}
	.center {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.side {
		flex: none;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.drop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		backdrop-filter: blur(4px);
		pointer-events: none;
	}
	.drop div {
		padding: 28px 40px;
		border: 2px dashed var(--accent);
		border-radius: 18px;
		font-size: 17px;
		font-weight: 600;
		background: var(--panel);
		text-align: center;
		max-width: 80vw;
	}
</style>
