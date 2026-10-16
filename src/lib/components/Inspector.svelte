<script lang="ts">
	import Icon from './Icon.svelte';
	import Stepper from './Stepper.svelte';
	import { DEFAULT_VIBRATO, gridTicks, noteEnd, noteName } from '#lib/core/music';
	import { getFlag, setFlag } from '#lib/core/flags';
	import { PPQ, type Note } from '#lib/core/types';
	import { pitch } from '#lib/state/commands';
	import { playback } from '#lib/state/playback.svelte';
	import { project } from '#lib/state/project.svelte';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';
	import { voicebank } from '#lib/state/voicebank.svelte';

	const sel = $derived(project.selectedNotes);
	const count = $derived(sel.length);
	const step = $derived(gridTicks(settings.data.gridDivision));

	/** Value shared by all selected notes, or undefined when they differ. */
	function common<K extends keyof Note>(key: K): Note[K] | undefined {
		if (!sel.length) return undefined;
		const first = sel[0][key];
		return sel.every((n) => n[key] === first) ? first : undefined;
	}

	const apply = (patch: Partial<Note>, key?: string) =>
		project.updateSelected(patch, key ?? Object.keys(patch)[0]);

	const lyric = $derived(common('lyric'));
	const midi = $derived(common('pitch'));
	const length = $derived(common('length'));
	const tick = $derived(common('tick'));
	const velocity = $derived(common('velocity'));
	const volume = $derived(common('volume'));
	const modulation = $derived(common('modulation'));
	const flags = $derived(common('flags'));

	const breath = $derived(flags === undefined ? undefined : getFlag(flags, 'B'));
	const pitchOffset = $derived(flags === undefined ? undefined : getFlag(flags, 't'));

	const FLAG_SLIDERS = [
		{ flag: 'g', label: 'Gender (g): − deeper, + brighter', min: -100, max: 100, step: 1 },
		{ flag: 'A', label: 'Amplitude follows pitch (A)', min: -100, max: 100, step: 1 },
		{ flag: 'fe', label: 'Vocal fry length at the end (fe, ms)', min: 0, max: 800, step: 10 }
	];

	const vib = $derived(sel.length && sel.every((n) => n.vibrato) ? sel[0].vibrato : null);
	const anyVib = $derived(sel.some((n) => n.vibrato));

	const measureTicks = $derived(project.ticksPerMeasure());
	const startLabel = $derived.by(() => {
		if (tick === undefined) return 'mixed';
		const bar = Math.floor(tick / measureTicks) + 1;
		const beatTicks = measureTicks / project.timeSignature.numerator;
		const beat = Math.floor((tick % measureTicks) / beatTicks) + 1;
		const rest = Math.round(tick % beatTicks);
		return `bar ${bar} · beat ${beat}${rest ? ` + ${rest}` : ''}`;
	});

	const durationMs = $derived.by(() => {
		if (length === undefined || tick === undefined) return undefined;
		const map = project.tempoMap;
		return Math.round(map.tickToMs(tick + length) - map.tickToMs(tick));
	});

	const totalMs = $derived(project.tempoMap.tickToMs(project.songEnd));

	function patchFlag(name: string, value: number | undefined) {
		project.edit(
			(notes) =>
				notes.map((n) =>
					project.selection.has(n.id) ? { ...n, flags: setFlag(n.flags, name, value) } : n
				),
			{ coalesce: `flag-${name}` }
		);
	}

	function setVibrato(patch: Partial<NonNullable<Note['vibrato']>>) {
		project.edit(
			(notes) =>
				notes.map((n) =>
					project.selection.has(n.id)
						? { ...n, vibrato: { ...(n.vibrato ?? DEFAULT_VIBRATO), ...patch } }
						: n
				),
			{ coalesce: 'vibrato' }
		);
	}

	const fmtTime = (ms: number) =>
		`${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
</script>

<div class="inspector">
	{#if count === 0}
		<h2>Project</h2>
		<div class="field">
			<label for="proj-name">Name</label>
			<input
				id="proj-name"
				type="text"
				bind:value={project.name}
				onchange={() => (project.dirty = true)}
			/>
		</div>
		<div class="field">
			<span class="label">Tempo</span>
			<Stepper
				label="Tempo"
				value={project.primaryTempo}
				min={20}
				max={400}
				step={1}
				suffix="BPM"
				onchange={(v) => project.setTempo(v, 0)}
			/>
			{#if project.tempos.length > 1}
				<span class="hint">{project.tempos.length - 1} more tempo change(s) on the ruler.</span>
			{/if}
		</div>
		<h3>Tracks</h3>
		<div class="tracks">
			{#each project.tracks as t (t.id)}
				<div class="track" class:active={t.id === project.activeTrack}>
					<button
						class="swatch"
						style:background={t.color}
						title="Make this track active"
						aria-label="Make {t.name} the active track"
						onclick={() => (project.activeTrack = t.id)}
					></button>
					<input
						type="text"
						value={t.name}
						aria-label="Track name"
						onchange={(e) =>
							e.currentTarget.value.trim() &&
							project.updateTrack(t.id, { name: e.currentTarget.value.trim() })}
					/>
					<button
						class="icon-btn small"
						class:active={t.mute}
						title="Mute"
						aria-label="Mute {t.name}"
						aria-pressed={t.mute}
						onclick={() => project.updateTrack(t.id, { mute: !t.mute })}>M</button
					>
					<button
						class="icon-btn small"
						class:active={t.solo}
						title="Solo"
						aria-label="Solo {t.name}"
						aria-pressed={t.solo}
						onclick={() => project.updateTrack(t.id, { solo: !t.solo })}>S</button
					>
					<button
						class="icon-btn small"
						title="Delete track"
						aria-label="Delete {t.name}"
						disabled={project.tracks.length < 2}
						onclick={() =>
							confirm(`Delete “${t.name}” and its notes?`) && project.removeTrack(t.id)}
					>
						<Icon name="trash" size={15} />
					</button>
					<input
						class="vol"
						type="range"
						min="0"
						max="150"
						value={t.volume}
						aria-label="{t.name} volume"
						oninput={(e) =>
							project.updateTrack(t.id, { volume: Number(e.currentTarget.value) }, `vol-${t.id}`)}
					/>
				</div>
			{/each}
			<button class="btn" onclick={() => project.addTrack()}
				><Icon name="plus" size={16} /> Add track</button
			>
		</div>
		<div class="field">
			<span class="label">Summary</span>
			<span class="hint">
				{project.notes.length} notes · {fmtTime(totalMs)} · {project.timeSignature
					.numerator}/{project.timeSignature.denominator}
			</span>
			{#if project.voicebankName}
				<span class="hint"
					>Voicebank: {voicebank.current?.name ?? `${project.voicebankName} (not loaded)`}</span
				>
			{/if}
		</div>
		<p class="hint">
			Select a note to edit its lyric, length, expression and pitch. Drag with the pencil tool to
			draw notes; use two fingers to scroll and zoom on touch screens.
		</p>
	{:else}
		<h2>{count === 1 ? 'Note' : `${count} notes`}</h2>

		<div class="field">
			<label for="lyric">Lyric</label>
			<input
				id="lyric"
				type="text"
				list="alias-list"
				autocomplete="off"
				autocapitalize="off"
				value={lyric ?? ''}
				placeholder={lyric === undefined ? 'mixed' : ''}
				onchange={(e) =>
					e.currentTarget.value.trim() && apply({ lyric: e.currentTarget.value.trim() })}
			/>
			<datalist id="alias-list">
				{#each voicebank.aliases.slice(0, 800) as alias (alias)}
					<option value={alias}></option>
				{/each}
			</datalist>
			{#if playback.unknownLyrics.size && sel.some((n) => playback.unknownLyrics.has(n.id))}
				<span class="warn">Not found in the voicebank.</span>
			{/if}
		</div>

		{#if project.tracks.length > 1}
			<div class="field">
				<label for="note-track">Track</label>
				<select
					id="note-track"
					value={common('track') ?? ''}
					onchange={(e) => project.moveSelectionToTrack(e.currentTarget.value)}
				>
					{#if common('track') === undefined}<option value="" disabled>mixed</option>{/if}
					{#each project.tracks as t (t.id)}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="grid2">
			<div class="field">
				<span class="label">Pitch {midi !== undefined ? `· ${noteName(midi)}` : ''}</span>
				<Stepper
					label="Pitch"
					value={midi}
					mixed={midi === undefined}
					min={12}
					max={119}
					onchange={(v) => apply({ pitch: Math.round(v) })}
				/>
			</div>
			<div class="field">
				<span class="label">Length {durationMs !== undefined ? `· ${durationMs} ms` : ''}</span>
				<Stepper
					label="Length"
					value={length}
					mixed={length === undefined}
					min={15}
					{step}
					suffix="t"
					onchange={(v) => apply({ length: Math.round(v) })}
				/>
			</div>
		</div>

		<div class="field">
			<span class="label">Start · {startLabel}</span>
			<Stepper
				label="Start"
				value={tick}
				mixed={tick === undefined}
				min={0}
				{step}
				suffix="t"
				onchange={(v) => apply({ tick: Math.round(v) })}
			/>
			<span class="hint"
				>{PPQ} ticks per quarter note. Last note ends at {sel.length
					? Math.max(...sel.map(noteEnd))
					: 0} t.</span
			>
		</div>

		<h3>Expression</h3>
		{#each [{ key: 'velocity', label: 'Velocity (consonant speed)', value: velocity }, { key: 'volume', label: 'Volume', value: volume }, { key: 'modulation', label: 'Modulation', value: modulation }] as p (p.key)}
			<div class="field">
				<span class="label">{p.label} · {p.value ?? 'mixed'}</span>
				<input
					type="range"
					min="0"
					max="200"
					step="1"
					value={p.value ?? 100}
					aria-label={p.label}
					oninput={(e) => apply({ [p.key]: Number(e.currentTarget.value) } as Partial<Note>, p.key)}
				/>
			</div>
		{/each}

		<h3>Voice flags</h3>
		<div class="field">
			<span class="label">Breathiness (B) · {breath ?? 'default'}</span>
			<input
				type="range"
				min="0"
				max="100"
				value={breath ?? 50}
				aria-label="Breathiness"
				oninput={(e) => patchFlag('B', Number(e.currentTarget.value))}
			/>
		</div>
		<div class="field">
			<span class="label">Pitch offset (t, cents) · {pitchOffset ?? 0}</span>
			<input
				type="range"
				min="-600"
				max="600"
				step="5"
				value={pitchOffset ?? 0}
				aria-label="Pitch offset"
				oninput={(e) => patchFlag('t', Number(e.currentTarget.value) || undefined)}
			/>
		</div>
		{#each FLAG_SLIDERS as f (f.flag)}
			{@const value = flags === undefined ? undefined : getFlag(flags, f.flag)}
			<div class="field">
				<span class="label">{f.label} · {value ?? 'off'}</span>
				<input
					type="range"
					min={f.min}
					max={f.max}
					step={f.step}
					value={value ?? 0}
					aria-label={f.label}
					oninput={(e) => patchFlag(f.flag, Number(e.currentTarget.value) || undefined)}
				/>
			</div>
		{/each}
		<div class="field">
			<label for="flags">Raw flags</label>
			<input
				id="flags"
				type="text"
				autocapitalize="off"
				spellcheck="false"
				value={flags ?? ''}
				placeholder={flags === undefined ? 'mixed' : 'e.g. B30t50'}
				onchange={(e) => apply({ flags: e.currentTarget.value.trim() })}
			/>
		</div>

		<h3>Pitch</h3>
		<div class="row wrap">
			<button class="btn" onclick={() => pitch.portamento()}>Portamento</button>
			<button class="btn" onclick={() => pitch.clear()}>Clear curve</button>
			<button
				class="btn"
				onclick={() => ui.setStatus('Choose the Pitch tool to edit the curve')}
				disabled
			>
				{sel.some((n) => n.pitchPoints.length)
					? `${sel.reduce((n, s) => n + s.pitchPoints.length, 0)} points`
					: 'No curve'}
			</button>
		</div>
		<label class="check">
			<input
				type="checkbox"
				checked={anyVib}
				onchange={(e) => pitch.vibrato(e.currentTarget.checked)}
			/>
			Vibrato
		</label>
		{#if vib}
			{#each [{ k: 'length', label: 'Length', min: 0, max: 100, unit: '%' }, { k: 'period', label: 'Period', min: 60, max: 500, unit: 'ms' }, { k: 'depth', label: 'Depth', min: 0, max: 200, unit: 'c' }, { k: 'fadeIn', label: 'Fade in', min: 0, max: 100, unit: '%' }, { k: 'fadeOut', label: 'Fade out', min: 0, max: 100, unit: '%' }, { k: 'phase', label: 'Phase', min: 0, max: 100, unit: '%' }] as v (v.k)}
				<div class="field">
					<span class="label">{v.label} · {vib[v.k as keyof typeof vib]}{v.unit}</span>
					<input
						type="range"
						min={v.min}
						max={v.max}
						value={vib[v.k as keyof typeof vib]}
						aria-label={v.label}
						oninput={(e) => setVibrato({ [v.k]: Number(e.currentTarget.value) })}
					/>
				</div>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.inspector {
		padding: 14px;
	}
	h2 {
		margin: 0 0 16px;
		padding-bottom: 12px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		color: var(--muted);
		border-bottom: 1px solid var(--border);
	}
	h3 {
		margin: 22px 0 10px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--accent-2);
	}
	.tracks {
		display: grid;
		gap: 10px;
		margin-bottom: 14px;
	}
	.track {
		display: grid;
		grid-template-columns: 22px 1fr auto auto auto;
		gap: 4px 6px;
		align-items: center;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--panel-2);
	}
	.track.active {
		border-color: var(--accent);
		box-shadow: var(--glow);
	}
	.track .vol {
		grid-column: 2 / -1;
	}
	.swatch {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		box-shadow:
			0 0 0 2px var(--panel),
			0 0 10px currentColor;
	}
	.icon-btn.small {
		width: 30px;
		height: 30px;
		font-size: 12px;
		font-weight: 700;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr;
	}
	.warn {
		color: var(--warn);
		font-size: 12px;
	}
	.wrap {
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 8px 0;
		min-height: var(--hit);
	}
	.label {
		font-size: 12px;
		color: var(--muted);
		font-weight: 600;
	}
</style>
