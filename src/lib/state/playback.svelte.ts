import { toEngineNotes } from '#lib/core/engine-notes';
import { encodeWav } from '#lib/io/wav';
import { downloadBlob, safeFilename } from '#lib/io/download';
import {
	startRender,
	type NoteSpanInfo,
	type ProjectRender,
	type RenderGroup
} from '#lib/render/registry';
import type { Interval } from '#lib/render/intervals';
import type { RenderStream } from '#lib/render/types';
import { renderers } from './renderers';
import { project } from './project.svelte';
import { settings } from './settings.svelte';
import { DEFAULT_CEILING, LIMITER_LOOKAHEAD, limit } from '#lib/render/limiter';
import { ui } from './ui.svelte';
import { lyrics } from './lyrics.svelte';
import { voicebank } from './voicebank.svelte';

export type RenderStatus = 'idle' | 'analyzing' | 'rendering' | 'ready' | 'error';

const SAMPLE_RATE = 44100;
/** How far ahead of the playhead audio is handed to the sound card. */
const AHEAD_S = 0.5;
/** Size of one scheduled piece of audio. */
const CHUNK_MS = 200;
/** Do not schedule slivers: wait until at least this much is ready. */
const MIN_CHUNK_MS = 20;
/**
 * After running dry (or at the start) playback waits until this much audio is ready ahead of the
 * playhead, so that a single finished note does not make it stutter forward one note at a time.
 */
const LEAD_MS = 2000;
/** An edit made under playback is re-rendered once the changes stop for this long (or after EDIT_MAX_WAIT_MS). */
const EDIT_SETTLE_MS = 150;
const EDIT_MAX_WAIT_MS = 800;

class PlaybackState {
	status = $state<RenderStatus>('idle');
	progress = $state(0);
	message = $state('');
	playing = $state(false);
	/** Playing, but the render has not caught up with the playhead yet. */
	buffering = $state(false);
	/** Gain the limiter applied to the piece last handed to the sound card (1 = untouched, below 1 = it was clipping). */
	limiterGain = $state(1);
	/** Playhead position in milliseconds. */
	positionMs = $state(0);
	durationMs = $state(0);
	/** The stretches of the song whose audio is final so far (while a render is going on). */
	readyRanges = $state.raw<Interval[]>([]);
	/** Notes whose lyric was not found in the voicebank (after the last render). */
	unknownLyrics = $state.raw<ReadonlySet<string>>(new Set());
	/** Where each note's sound lies on the time axis after the last render (for diagnostics and tests). */
	spans = $state.raw<NoteSpanInfo[]>([]);

	/** Playhead in ticks (follows tempo changes). */
	positionTick = $derived(project.tempoMap.msToTick(this.positionMs));
	busy = $derived(this.status === 'analyzing' || this.status === 'rendering');

	private buffer: AudioBuffer | null = null;
	private renderedKey = '';
	private run: ProjectRender | null = null;
	private ctx: AudioContext | null = null;
	private sources: AudioBufferSourceNode[] = [];
	private timer: ReturnType<typeof setInterval> | undefined;
	/** Next sample (of the song) to hand over, and the audio-clock time at which it will sound. */
	private nextSample = 0;
	private nextCtx = 0;
	private startedFrom = 0;
	private completed = false;
	/** Waiting for the render to get LEAD_MS ahead of the playhead before going on. */
	private holding = false;
	private exporting = false;
	/** The render the sound card is being fed from; differs from `run` while an edit is being re-rendered. */
	private feed: RenderStream | null = null;
	/** When the project last changed under playback (debounce), and when the first of those changes was. */
	private editSeen = { key: '', at: 0, first: 0 };

	/** The progressive render that is going on (or was the last one). */
	get stream(): RenderStream | null {
		return this.run?.stream ?? null;
	}

	private key(): string {
		return `${project.revision}:${voicebank.revision}:${settings.data.analysisQuality}`;
	}

	/** True when there is no finished or running render of what is on screen now. */
	get isStale(): boolean {
		return !this.run || this.renderedKey !== this.key();
	}

	/** End of the music in ms (a short tail after the last note). */
	private endMs(): number {
		return project.tempoMap.tickToMs(project.songEnd) + 300;
	}

	// ---- rendering -----------------------------------------------------------

	/**
	 * Makes sure there is a render of the current project (starting one if needed) and tells it
	 * to work around `focusMs` first. Returns null when there is nothing to render.
	 */
	private ensureRender(focusMs: number): ProjectRender | null {
		if (!voicebank.current) {
			ui.error('Load a voicebank first (left panel).');
			return null;
		}
		if (!project.notes.length) {
			ui.error('Add some notes first.');
			return null;
		}
		if (this.run && this.renderedKey === this.key()) {
			this.run.stream.focus(focusMs);
			return this.run;
		}
		this.run?.cancel();

		const key = this.key();
		const groups: RenderGroup[] = renderers
			.plan(project.notes, project.tracks)
			.map(({ backend, notes }) => ({
				backend,
				...toEngineNotes(notes, project.tempoMap, project.tracks, lyrics.alias)
			}));
		this.status = 'analyzing';
		this.progress = 0;
		this.message = 'Preparing samples…';
		this.completed = false;
		this.buffer = null;
		this.readyRanges = [];

		const run = startRender(groups, project.primaryTempo, {
			onAnalyze: (done, total) => {
				if (this.run !== run) return;
				this.status = 'analyzing';
				this.message = `Analyzing samples ${done}/${total}`;
			}
		});
		this.run = run;
		this.renderedKey = key;
		run.stream.focus(focusMs);
		run.stream.onChange = () => this.syncStream(run);

		void run.result.then(
			(outcome) => {
				if (this.run !== run) return;
				if (!outcome) {
					this.run = null;
					this.status = 'idle';
					this.readyRanges = [];
					return;
				}
				const buffer = new AudioBuffer({ length: outcome.pcm.length, sampleRate: SAMPLE_RATE });
				buffer.copyToChannel(outcome.pcm as Float32Array<ArrayBuffer>, 0);
				this.buffer = buffer;
				this.completed = true;
				this.durationMs = buffer.duration * 1000;
				this.unknownLyrics = new Set(outcome.missingAlias);
				this.spans = outcome.spans;
				this.readyRanges = [];
				this.status = 'ready';
				this.progress = 1;
				this.message = `Rendered ${outcome.rendered}, reused ${outcome.cached}`;
				ui.setStatus(this.message);
				if (outcome.missingAlias.length) {
					ui.toast(
						`${outcome.missingAlias.length} note(s) have lyrics that are not in the voicebank (marked in red).`,
						'error'
					);
				}
				if (outcome.errors.length) console.warn('[render]', outcome.errors);
			},
			(error) => {
				if (this.run !== run) return;
				this.run = null;
				this.status = 'error';
				this.buffering = false;
				this.message = error instanceof Error ? error.message : 'Synthesis failed.';
				ui.error(this.message);
			}
		);
		return run;
	}

	/** Copies what the running render knows into reactive state. */
	private syncStream(run: ProjectRender) {
		if (this.run !== run || this.completed) return;
		const { stream } = run;
		const { done, total } = stream.progress;
		this.durationMs = stream.durationMs;
		this.readyRanges = stream.ready();
		this.progress = total ? done / total : 0;
		this.status = stream.waiting?.startsWith('Analy') ? 'analyzing' : 'rendering';
		this.message = this.buffering
			? `Buffering… ${done}/${total} notes`
			: (stream.waiting ?? `Rendering ${done}/${total}`);
	}

	/** Synthesizes the whole project. Resolves true when all of its audio is available. */
	async render(): Promise<boolean> {
		const run = this.ensureRender(0);
		if (!run) return false;
		const outcome = await run.result.catch(() => null);
		return !!outcome && this.run === run;
	}

	cancelRender() {
		this.run?.cancel();
		this.run = null;
		this.readyRanges = [];
		this.buffering = false;
		if (this.busy) this.status = 'idle';
	}

	// ---- transport -----------------------------------------------------------------

	async toggle() {
		if (this.playing) this.pause();
		else await this.play();
	}

	/** Starts playing at once: whatever is not rendered yet is rendered ahead of the playhead. */
	async play() {
		const from = this.startPosition();
		if (!this.ensureRender(from)) return;
		this.start(from);
	}

	private startPosition(): number {
		if (settings.data.playbackStart === 'start') return 0;
		return this.positionMs >= this.endMs() - 30 ? 0 : this.positionMs;
	}

	private audioContext(): AudioContext {
		if (!this.ctx) {
			try {
				// The song is rendered at 44.1 kHz; the same rate avoids resampling at piece borders.
				this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: SAMPLE_RATE });
			} catch {
				this.ctx = new AudioContext({ latencyHint: 'interactive' });
			}
		}
		return this.ctx;
	}

	private start(fromMs: number) {
		const ctx = this.audioContext();
		void ctx.resume();
		this.halt();
		this.playing = true;
		this.buffering = false;
		this.holding = true;
		this.feed = this.run?.stream ?? null;
		this.startedFrom = fromMs;
		this.positionMs = fromMs;
		this.nextSample = Math.floor((fromMs / 1000) * SAMPLE_RATE);
		this.nextCtx = ctx.currentTime + 0.06;
		this.run?.stream.focus(fromMs);
		this.timer = setInterval(() => this.pump(), 30);
		this.pump();
	}

	/** What of `stream` can be handed to the sound card from `fromSample` on. */
	private availability(stream: RenderStream, fromSample: number, endSample: number) {
		// Limiting a sample needs a little final audio after it too.
		const readyMs = stream.readyUntil((fromSample / SAMPLE_RATE) * 1000);
		const whole = stream.complete || (stream.durationMs > 0 && readyMs >= stream.durationMs - 1);
		const lastSample = Math.min(endSample, Math.floor((stream.durationMs / 1000) * SAMPLE_RATE));
		const playable = Math.min(
			endSample,
			Math.floor((readyMs / 1000) * SAMPLE_RATE) - (whole ? 0 : LIMITER_LOOKAHEAD)
		);
		const lead = Math.min(Math.floor((LEAD_MS / 1000) * SAMPLE_RATE), endSample - fromSample);
		return {
			playable,
			hasLead: playable - fromSample >= lead || (whole && playable >= lastSample)
		};
	}

	/**
	 * The project changed while playing (solo, volume, notes…): render it again from the playhead
	 * and, once the new render has a lead, carry on from it. The old audio plays until then.
	 */
	private followEdits() {
		const key = this.key();
		if (!this.run || key === this.renderedKey) {
			this.editSeen.first = 0;
			return;
		}
		const t = performance.now();
		if (key !== this.editSeen.key) this.editSeen = { key, at: t, first: this.editSeen.first || t };
		// Wait for a burst of changes (a slider being dragged) to settle, but not for ever.
		if (t - this.editSeen.at < EDIT_SETTLE_MS && t - this.editSeen.first < EDIT_MAX_WAIT_MS) return;
		this.editSeen.first = 0;
		this.ensureRender(this.positionMs);
	}

	/** Hands the next ready pieces of the song to the sound card and moves the playhead. */
	private pump() {
		const ctx = this.ctx;
		if (!ctx || !this.run || !this.playing) return;
		this.followEdits();
		const run = this.run;
		if (!run) return;
		const now = ctx.currentTime;
		const endSample = Math.floor((this.endMs() / 1000) * SAMPLE_RATE);

		if (this.nextCtx < now) {
			// Everything handed over has been played: the playhead waits where the audio ends.
			this.positionMs = Math.max(this.positionMs, (this.nextSample / SAMPLE_RATE) * 1000);
			this.nextCtx = now + 0.03;
		}
		run.stream.focus((this.nextSample / SAMPLE_RATE) * 1000);

		// A newer render takes over as soon as it has a lead at the point where the sound card is fed next.
		if (
			this.feed !== run.stream &&
			(!this.feed || this.availability(run.stream, this.nextSample, endSample).hasLead)
		) {
			this.feed = run.stream;
		}
		const stream = this.feed ?? run.stream;
		const { playable, hasLead } = this.availability(stream, this.nextSample, endSample);

		let starving = false;
		if (this.holding && this.nextSample < endSample) {
			if (hasLead) this.holding = false;
			else starving = true;
		}
		while (!starving && this.nextCtx - now < AHEAD_S && this.nextSample < endSample) {
			const toSample = Math.min(
				playable,
				this.nextSample + Math.floor((CHUNK_MS / 1000) * SAMPLE_RATE)
			);
			if (toSample - this.nextSample < (MIN_CHUNK_MS / 1000) * SAMPLE_RATE) {
				starving = true;
				break;
			}
			this.schedule(ctx, stream.buffer, this.nextSample, toSample);
		}

		const queued = Math.max(0, this.nextCtx - now);
		const playedMs = (this.nextSample / SAMPLE_RATE) * 1000 - queued * 1000;
		this.positionMs = Math.max(this.positionMs, this.startedFrom, playedMs);

		// Out of audio to play: from now on wait for a proper lead. If a newer render exists, it is the one to wait for.
		if (starving && queued < 0.04 && this.nextSample < endSample) {
			this.holding = true;
			this.feed = run.stream;
		}
		const wasBuffering = this.buffering;
		this.buffering = this.holding && queued < 0.04 && this.nextSample < endSample;
		if (this.buffering !== wasBuffering && this.run) this.syncStream(this.run);

		if (this.nextSample >= endSample && queued <= 0.01) {
			this.halt();
			this.playing = false;
			this.buffering = false;
			this.positionMs = 0;
		}
	}

	private schedule(ctx: AudioContext, pcm: Float32Array, from: number, to: number) {
		const limited = limit(pcm, from, to, DEFAULT_CEILING);
		this.limiterGain = limited.minGain;
		const piece = ctx.createBuffer(1, to - from, SAMPLE_RATE);
		piece.copyToChannel(limited.pcm as Float32Array<ArrayBuffer>, 0);
		const source = ctx.createBufferSource();
		source.buffer = piece;
		source.connect(ctx.destination);
		source.onended = () => {
			this.sources = this.sources.filter((s) => s !== source);
		};
		source.start(this.nextCtx);
		this.sources.push(source);
		this.nextCtx += (to - from) / SAMPLE_RATE;
		this.nextSample = to;
	}

	/** Stops the audio without touching the playhead. */
	private halt() {
		clearInterval(this.timer);
		this.timer = undefined;
		for (const source of this.sources) {
			source.onended = null;
			try {
				source.stop();
			} catch {
				/* already stopped */
			}
			source.disconnect();
		}
		this.sources = [];
	}

	pause() {
		if (this.playing && this.ctx) {
			const queued = Math.max(0, this.nextCtx - this.ctx.currentTime);
			const playedMs = (this.nextSample / SAMPLE_RATE) * 1000 - queued * 1000;
			this.positionMs = Math.max(this.startedFrom, playedMs, this.positionMs);
		}
		this.halt();
		this.playing = false;
		this.buffering = false;
		this.settingsChanged();
	}

	/** Without background rendering an unfinished render stops when nothing is playing (the cache keeps its work). */
	settingsChanged() {
		if (this.playing || this.exporting || this.completed || settings.data.backgroundRender) return;
		if (!this.run) return;
		this.cancelRender();
		this.message = '';
	}

	stop() {
		this.pause();
		this.cancelRender();
		this.positionMs = 0;
	}

	/** Moves the playhead. The render follows: whatever is around the new position is done first. */
	seekMs(ms: number) {
		const target = Math.max(0, ms);
		this.run?.stream.focus(target);
		if (this.playing) this.start(target);
		else this.positionMs = target;
	}

	seekTick(tick: number) {
		this.seekMs(project.tempoMap.tickToMs(Math.max(0, tick)));
	}

	// ---- note preview (piano keys) -------------------------------------------

	private previewCache = new Map<string, AudioBuffer>();
	private previewing = new Set<string>();
	private previewSource: AudioBufferSourceNode | null = null;
	private stopBeep: (() => void) | null = null;

	/**
	 * Plays a short note when a piano key is pressed: with the loaded voicebank
	 * if the lyric exists there, otherwise as a plain tone.
	 */
	async preview(pitch: number) {
		void this.audioContext().resume();
		const lyric = (project.selectedNotes[0]?.lyric || settings.data.defaultLyric || 'a').trim();
		const key = `${voicebank.revision}|${lyric}|${pitch}`;
		this.stopPreview();

		const cached = this.previewCache.get(key);
		if (cached) return this.playPreview(cached);
		if (!voicebank.current || this.previewing.has(key)) return this.beep(pitch);

		this.previewing.add(key);
		const pressedAt = performance.now();
		this.beep(pitch); // instant feedback while the voice is rendered
		try {
			const resolved = lyrics.preview(lyric, pitch);
			const alias =
				resolved && resolved.status !== 'missing' && resolved.status !== 'rest'
					? resolved.alias
					: lyric;
			const note = {
				alias,
				pitch,
				start_time: 0,
				duration: 500,
				pitchbend: [],
				flags: '',
				velocity: 100,
				volume: 100,
				modulation: 0
			};
			const backend = renderers.forTrack(project.tracks.find((t) => t.id === project.activeTrack));
			const out = await backend.render([note], project.primaryTempo).promise;
			if (!out || out.report.missing_alias.length || out.report.missing_features.length) return;
			const samples = out.pcm.subarray(0, Math.floor(SAMPLE_RATE * 0.75));
			const buffer = new AudioBuffer({ length: samples.length, sampleRate: SAMPLE_RATE });
			buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
			if (this.previewCache.size > 80)
				this.previewCache.delete(this.previewCache.keys().next().value!);
			this.previewCache.set(key, buffer);
			// If the voice is ready quickly it replaces the beep; later it is just cached.
			if (performance.now() - pressedAt < 1200) {
				this.stopPreview();
				this.playPreview(buffer);
			}
		} catch {
			/* the beep already played */
		} finally {
			this.previewing.delete(key);
		}
	}

	private playPreview(buffer: AudioBuffer) {
		if (!this.ctx) return;
		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(this.ctx.destination);
		source.onended = () => {
			if (this.previewSource === source) this.previewSource = null;
		};
		source.start();
		this.previewSource = source;
	}

	private beep(pitch: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'triangle';
		osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
		const t = ctx.currentTime;
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
		osc.connect(gain).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + 0.5);
		this.previewSource = {
			stop: () => osc.stop(),
			onended: null
		} as unknown as AudioBufferSourceNode;
		osc.onended = () => {
			if (this.previewSource && 'stop' in this.previewSource) this.previewSource = null;
		};
	}

	private stopPreview() {
		try {
			this.previewSource?.stop();
			this.stopBeep?.();
		} catch {
			/* already stopped */
		}
		this.previewSource = null;
		this.stopBeep = null;
	}

	// ---- export ---------------------------------------------------------------------

	async exportWav() {
		this.exporting = true;
		try {
			if ((this.isStale || !this.completed) && !(await this.render())) return;
		} finally {
			this.exporting = false;
		}
		const source = this.buffer!.getChannelData(0);
		// Playback is limited on the fly; the file gets the same limiter, and quiet mixes are brought up first.
		let peak = 0;
		for (const v of source) peak = Math.max(peak, Math.abs(v));
		const boost = peak > 0.001 && peak < 0.8 ? 0.95 / peak : 1;
		const mix = boost === 1 ? source : source.map((v) => v * boost);
		const pcm = limit(mix, 0, mix.length, DEFAULT_CEILING).pcm;
		downloadBlob(encodeWav(pcm, SAMPLE_RATE), `${safeFilename(project.name)}.wav`, 'audio/wav');
		ui.toast('WAV exported.', 'success');
	}
}

export const playback = new PlaybackState();
