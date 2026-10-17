<script lang="ts">
	import Dialog from './Dialog.svelte';
	import { splitLyrics } from '#lib/core/lyrics';
	import { edit, file } from '#lib/state/commands';
	import { getEngine } from '#lib/state/engine';
	import { project } from '#lib/state/project.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';
	import type { MidiFile } from '#lib/io/midi';
	import { asset } from '$app/paths';

	// ---- settings ------------------------------------------------------------------------
	let cacheInfo = $state('');
	async function refreshCache() {
		try {
			const usage = await (await getEngine()).cache?.usage();
			cacheInfo = usage
				? `${(usage.bytes / 1048576).toFixed(1)} MB in ${usage.banks} voicebank(s)`
				: 'Cache unavailable in this browser';
		} catch {
			cacheInfo = 'Cache unavailable';
		}
	}
	$effect(() => {
		if (ui.dialog === 'settings') void refreshCache();
	});
	async function clearCache() {
		await (await getEngine()).cache?.clear();
		await refreshCache();
		ui.toast('Analysis cache cleared.');
	}

	// ---- lyrics --------------------------------------------------------------------------------
	let lyricsText = $state('');
	const syllables = $derived(splitLyrics(lyricsText));
	const lyricTargets = $derived(project.selection.size || project.notes.length);

	// ---- tempo ---------------------------------------------------------------------------------
	const tempoTick = $derived((ui.dialogData as { tick?: number } | null)?.tick ?? 0);
	let bpmInput = $state(120);
	let numerator = $state(4);
	let denominator = $state(4);
	$effect(() => {
		if (ui.dialog === 'tempo') {
			bpmInput = Math.round(project.tempoMap.bpmAt(tempoTick) * 100) / 100;
			numerator = project.timeSignature.numerator;
			denominator = project.timeSignature.denominator;
		}
	});
	const hasTempoHere = $derived(tempoTick > 0 && project.tempos.some((t) => t.tick === tempoTick));
	function applyTempo() {
		if (Number.isFinite(bpmInput) && bpmInput > 0) project.setTempo(bpmInput, tempoTick);
		if (
			tempoTick === 0 &&
			(numerator !== project.timeSignature.numerator ||
				denominator !== project.timeSignature.denominator)
		) {
			project.setTimeSignature(numerator, denominator);
		}
		ui.closeDialog();
	}

	// ---- midi ------------------------------------------------------------------------------------
	const midiData = $derived(ui.dialogData as { midi: MidiFile; fileName: string } | null);

	const SHORTCUTS: [string, string][] = [
		['Space', 'Play / pause'],
		['Home', 'Stop and go to start'],
		['V / B / P / E', 'Select, draw, pitch, eraser tools'],
		['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
		['Ctrl+C / X / V', 'Copy / cut / paste'],
		['Ctrl+D', 'Duplicate'],
		['Ctrl+A', 'Select all'],
		['Delete / Backspace', 'Delete selected notes'],
		['Enter / F2', 'Edit lyric of selected note'],
		['← →', 'Move notes by one grid step'],
		['↑ ↓ (Shift = octave)', 'Transpose'],
		['Alt+← →', 'Shorter / longer'],
		['Ctrl+L', 'Fill lyrics'],
		['Ctrl+S / Ctrl+O', 'Save / open project'],
		['Ctrl+E', 'Export WAV'],
		['Ctrl+wheel', 'Zoom time'],
		['Alt+wheel', 'Zoom keys'],
		['Shift (while dragging)', 'Disable snapping'],
		['Alt+drag', 'Duplicate while moving'],
		['Right-click / long-press', 'Context menu'],
		['Double-click / double-tap', 'Edit lyric or add a note'],
		['Two fingers', 'Scroll & pinch-zoom (touch)']
	];
</script>

{#if ui.dialog === 'settings'}
	<Dialog title="Settings" onclose={ui.closeDialog}>
		<h3>Editor</h3>
		<div class="field">
			<label for="s-lyric">Default lyric for new notes</label>
			<input
				id="s-lyric"
				type="text"
				bind:value={settings.data.defaultLyric}
				autocapitalize="off"
			/>
		</div>
		<div class="field">
			<label for="s-play">Play from</label>
			<select id="s-play" bind:value={settings.data.playbackStart}>
				<option value="cursor">Playhead position</option>
				<option value="start">Start of the song</option>
			</select>
		</div>
		<label class="check"
			><input type="checkbox" bind:checked={settings.data.followPlayhead} /> Follow playhead while playing</label
		>
		<label class="check"
			><input type="checkbox" bind:checked={settings.data.showNoteNames} /> Show note names on long notes</label
		>

		<h3>Appearance</h3>
		<div class="field">
			<label for="s-theme">Theme</label>
			<select id="s-theme" bind:value={settings.data.theme}>
				<option value="auto">Match system</option>
				<option value="dark">Dark</option>
				<option value="light">Light</option>
			</select>
		</div>
		<div class="field">
			<label for="s-touch">Touch-friendly controls</label>
			<select id="s-touch" bind:value={settings.data.touchMode}>
				<option value="auto">Automatic</option>
				<option value="on">Always (larger buttons and handles)</option>
				<option value="off">Never</option>
			</select>
		</div>

		<h3>Sample analysis</h3>
		<div class="field">
			<label for="s-quality">Quality</label>
			<select id="s-quality" bind:value={settings.data.analysisQuality}>
				<option value="accurate">Accurate (Harvest) — best pitch tracking, slower</option>
				<option value="fast">Fast (DIO) — about 2× faster (default)</option>
			</select>
			<span class="hint">Changing this re-analyzes samples the next time they are needed.</span>
		</div>
		<div class="field">
			<label for="s-workers">Parallel workers (0 = automatic: {settings.workerCount})</label>
			<input
				id="s-workers"
				type="number"
				min="0"
				max="16"
				bind:value={settings.data.analysisWorkers}
			/>
		</div>
		<label class="check">
			<input type="checkbox" bind:checked={settings.data.backgroundAnalysis} />
			Analyze the whole voicebank in the background after loading (off: samples are analyzed when rendered)
		</label>
		<div class="field">
			<span class="label">Analysis cache: {cacheInfo}</span>
			<div class="row"><button class="btn danger" onclick={clearCache}>Clear cache</button></div>
		</div>

		{#snippet footer()}
			<button class="btn" onclick={() => settings.reset()}>Reset to defaults</button>
			<button class="btn primary" onclick={ui.closeDialog}>Done</button>
		{/snippet}
	</Dialog>
{:else if ui.dialog === 'lyrics'}
	<Dialog title="Fill lyrics" onclose={ui.closeDialog}>
		<div class="field">
			<label for="l-text">Lyrics</label>
			<textarea
				id="l-text"
				rows="6"
				bind:value={lyricsText}
				placeholder="la la la — or kana: さくらさく"
				autocapitalize="off"></textarea>
			<span class="hint">
				Separate syllables with spaces; Japanese kana is split automatically.
				{syllables.length} syllable(s) → {lyricTargets}
				{project.selection.size ? 'selected' : ''} note(s). Notes are filled in time order.
			</span>
		</div>
		{#snippet footer()}
			<button class="btn" onclick={ui.closeDialog}>Cancel</button>
			<button
				class="btn primary"
				disabled={!syllables.length}
				onclick={() => {
					edit.applyLyrics(lyricsText);
					ui.closeDialog();
				}}>Apply</button
			>
		{/snippet}
	</Dialog>
{:else if ui.dialog === 'tempo'}
	<Dialog
		title={tempoTick > 0 ? 'Tempo change' : 'Tempo & time signature'}
		onclose={ui.closeDialog}
		width={380}
	>
		<div class="field">
			<label for="t-bpm">Tempo (BPM){tempoTick > 0 ? ` from tick ${tempoTick}` : ''}</label>
			<input id="t-bpm" type="number" min="20" max="400" step="0.1" bind:value={bpmInput} />
		</div>
		{#if tempoTick === 0}
			<div class="field">
				<span class="label">Time signature</span>
				<div class="row">
					<input type="number" min="1" max="32" bind:value={numerator} aria-label="Beats per bar" />
					<span>/</span>
					<select bind:value={denominator} aria-label="Beat unit">
						{#each [2, 4, 8, 16] as d (d)}<option value={d}>{d}</option>{/each}
					</select>
				</div>
			</div>
		{/if}
		{#snippet footer()}
			{#if hasTempoHere}
				<button
					class="btn danger"
					onclick={() => {
						project.removeTempo(tempoTick);
						ui.closeDialog();
					}}>Remove</button
				>
			{/if}
			<button class="btn" onclick={ui.closeDialog}>Cancel</button>
			<button class="btn primary" onclick={applyTempo}>Apply</button>
		{/snippet}
	</Dialog>
{:else if ui.dialog === 'midi' && midiData}
	<Dialog title="Import MIDI — choose a track" onclose={ui.closeDialog} width={440}>
		<div class="tracks">
			<button
				class="btn primary track"
				onclick={() => {
					ui.closeDialog();
					file.applyMidiAll(midiData.midi, midiData.fileName);
				}}
			>
				<strong>All tracks</strong>
				<span class="hint">as separate tracks</span>
			</button>
			{#each midiData.midi.tracks.filter((t) => t.noteCount > 0) as t (t.index)}
				<button
					class="btn track"
					onclick={() => {
						ui.closeDialog();
						file.applyMidi(midiData.midi, t.index, midiData.fileName);
					}}
				>
					<strong>{t.name}</strong>
					<span class="hint">{t.noteCount} notes</span>
				</button>
			{/each}
		</div>
	</Dialog>
{:else if ui.dialog === 'shortcuts'}
	<Dialog title="Keyboard & gestures" onclose={ui.closeDialog} width={560}>
		<table>
			<tbody>
				{#each SHORTCUTS as [keys, what] (keys)}
					<tr><th><kbd>{keys}</kbd></th><td>{what}</td></tr>
				{/each}
			</tbody>
		</table>
	</Dialog>
{:else if ui.dialog === 'about'}
	<Dialog title="About WebTAU" onclose={ui.closeDialog} width={460}>
		<div class="about">
			<img src={asset('favicon.png')} alt="" width="64" height="64" />
			<p>
				<strong>WebTAU</strong> is a browser-based vocal synthesizer for UTAU voicebanks. Everything runs
				locally in your browser — no uploads.
			</p>
			<p class="hint">
				Engine based on <a
					href="https://github.com/UtaUtaUtau/straycat-rs"
					target="_blank"
					rel="noreferrer">straycat-rs</a
				>,
				<a href="https://github.com/BiggieBoo18/Rust-WORLD" target="_blank" rel="noreferrer"
					>Rust-WORLD</a
				>
				and the
				<a href="https://github.com/mmorise/World" target="_blank" rel="noreferrer">WORLD</a> vocoder.
			</p>
			<p>
				<a href="https://github.com/charl1e7/webtau" target="_blank" rel="noreferrer"
					>github.com/charl1e7/webtau</a
				>
				{#if voicebank.current}· voicebank: {voicebank.current.name}{/if}
			</p>
		</div>
	</Dialog>
{/if}

<style>
	h3 {
		margin: 14px 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	h3:first-child {
		margin-top: 4px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: var(--hit);
	}
	textarea {
		resize: vertical;
		font-size: 15px;
	}
	.tracks {
		display: grid;
		gap: 8px;
		padding-top: 6px;
	}
	.track {
		justify-content: space-between;
		min-height: 48px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		padding: 5px 12px 5px 0;
		white-space: nowrap;
		font-weight: 400;
	}
	td {
		padding: 5px 0;
		color: var(--muted);
	}
	tr + tr {
		border-top: 1px solid var(--border);
	}
	kbd {
		font-family: inherit;
		font-size: 12px;
		background: var(--panel-3);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 2px 7px;
	}
	.about {
		display: grid;
		gap: 6px;
		justify-items: center;
		text-align: center;
	}
	.about img {
		border-radius: 14px;
	}
	.about a {
		color: var(--accent);
	}
	.about p {
		margin: 4px 0;
	}
</style>
