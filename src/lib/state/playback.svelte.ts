import { toEngineNotes } from '#lib/core/engine-notes';
import { encodeWav } from '#lib/io/wav';
import { downloadBlob, safeFilename } from '#lib/io/download';
import { getEngine } from './engine';
import { project } from './project.svelte';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';
import { lyrics } from './lyrics.svelte';
import { voicebank } from './voicebank.svelte';

export type RenderStatus = 'idle' | 'analyzing' | 'rendering' | 'ready' | 'error';

const SAMPLE_RATE = 44100;

class PlaybackState {
	status = $state<RenderStatus>('idle');
	progress = $state(0);
	message = $state('');
	playing = $state(false);
	/** Playhead position in milliseconds. */
	positionMs = $state(0);
	durationMs = $state(0);
	/** Notes whose lyric was not found in the voicebank (after the last render). */
	unknownLyrics = $state.raw<ReadonlySet<string>>(new Set());

	/** Playhead in ticks (follows tempo changes). */
	positionTick = $derived(project.tempoMap.msToTick(this.positionMs));
	busy = $derived(this.status === 'analyzing' || this.status === 'rendering');

	private buffer: AudioBuffer | null = null;
	private renderedKey = '';
	private job: { cancel: () => void } | null = null;
	private ctx: AudioContext | null = null;
	private source: AudioBufferSourceNode | null = null;
	private startedAtCtx = 0;
	private startOffsetMs = 0;
	private raf = 0;

	private key(): string {
		return `${project.revision}:${voicebank.revision}:${settings.data.analysisQuality}`;
	}

	get isStale(): boolean {
		return !this.buffer || this.renderedKey !== this.key();
	}

	// ---- rendering -----------------------------------------------------------

	/** Synthesizes the project. Resolves true when audio is available. */
	async render(): Promise<boolean> {
		if (!voicebank.current) {
			ui.error('Load a voicebank first (left panel).');
			return false;
		}
		if (!project.notes.length) {
			ui.error('Add some notes first.');
			return false;
		}
		this.job?.cancel();

		const key = this.key();
		const { notes, ids } = toEngineNotes(
			project.notes,
			project.tempoMap,
			project.tracks,
			lyrics.alias
		);
		this.status = 'analyzing';
		this.progress = 0;
		this.message = 'Preparing samples…';

		try {
			const engine = await getEngine();
			const job = engine.render(notes, project.primaryTempo, {
				onAnalyze: (done, total) => {
					this.status = 'analyzing';
					this.progress = total ? done / total : 0;
					this.message = `Analyzing samples ${done}/${total}`;
				},
				onSynthesize: (done, total) => {
					this.status = 'rendering';
					this.progress = total ? done / total : 0;
					this.message = `Synthesizing ${done}/${total}`;
				}
			});
			this.job = job;
			const outcome = await job.promise;
			if (this.job !== job) return false; // superseded
			this.job = null;
			if (!outcome) {
				this.status = 'idle';
				return false;
			}

			const buffer = new AudioBuffer({ length: outcome.pcm.length, sampleRate: SAMPLE_RATE });
			buffer.copyToChannel(outcome.pcm as Float32Array<ArrayBuffer>, 0);
			this.buffer = buffer;
			this.renderedKey = key;
			this.durationMs = buffer.duration * 1000;

			const { report } = outcome;
			this.unknownLyrics = new Set(report.missing_alias.map((i) => ids[i]));
			this.status = 'ready';
			this.progress = 1;
			this.message = `Rendered ${report.rendered}, reused ${report.cached}`;
			ui.setStatus(this.message);
			if (report.missing_alias.length) {
				ui.toast(
					`${report.missing_alias.length} note(s) have lyrics that are not in the voicebank (marked in red).`,
					'error'
				);
			}
			if (report.errors.length) console.warn('[render]', report.errors);
			return true;
		} catch (error) {
			this.job = null;
			this.status = 'error';
			this.message = error instanceof Error ? error.message : 'Synthesis failed.';
			ui.error(this.message);
			return false;
		}
	}

	cancelRender() {
		this.job?.cancel();
		this.job = null;
		if (this.busy) this.status = 'idle';
	}

	// ---- transport -----------------------------------------------------------------

	async toggle() {
		if (this.playing) this.pause();
		else await this.play();
	}

	async play() {
		if (this.busy) {
			this.cancelRender();
			return;
		}
		if (this.isStale && !(await this.render())) return;
		this.start(this.startPosition());
	}

	private startPosition(): number {
		if (settings.data.playbackStart === 'start') return 0;
		return this.positionMs >= this.durationMs - 30 ? 0 : this.positionMs;
	}

	private start(fromMs: number) {
		if (!this.buffer) return;
		this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
		void this.ctx.resume();
		this.halt();

		const source = this.ctx.createBufferSource();
		source.buffer = this.buffer;
		source.connect(this.ctx.destination);
		source.onended = () => {
			if (this.source !== source) return;
			this.halt();
			this.playing = false;
			this.positionMs = 0;
		};
		this.startOffsetMs = fromMs;
		this.startedAtCtx = this.ctx.currentTime;
		source.start(0, fromMs / 1000);
		this.source = source;
		this.playing = true;
		this.positionMs = fromMs;

		const tick = () => {
			if (!this.playing || !this.ctx) return;
			this.positionMs = this.startOffsetMs + (this.ctx.currentTime - this.startedAtCtx) * 1000;
			this.raf = requestAnimationFrame(tick);
		};
		cancelAnimationFrame(this.raf);
		this.raf = requestAnimationFrame(tick);
	}

	/** Stops the audio node without touching the playhead. */
	private halt() {
		cancelAnimationFrame(this.raf);
		if (this.source) {
			this.source.onended = null;
			try {
				this.source.stop();
			} catch {
				/* already stopped */
			}
			this.source.disconnect();
			this.source = null;
		}
	}

	pause() {
		if (this.playing && this.ctx) {
			this.positionMs = this.startOffsetMs + (this.ctx.currentTime - this.startedAtCtx) * 1000;
		}
		this.halt();
		this.playing = false;
	}

	stop() {
		this.pause();
		this.cancelRender();
		this.positionMs = 0;
	}

	seekMs(ms: number) {
		const target = Math.max(0, ms);
		if (this.playing && this.buffer) this.start(Math.min(target, this.durationMs - 5));
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
		this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
		void this.ctx.resume();
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
			const engine = await getEngine();
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
			const out = await engine.render([note], project.primaryTempo).promise;
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
		if (this.isStale && !(await this.render())) return;
		const pcm = this.buffer!.getChannelData(0);
		downloadBlob(encodeWav(pcm, SAMPLE_RATE), `${safeFilename(project.name)}.wav`, 'audio/wav');
		ui.toast('WAV exported.', 'success');
	}
}

export const playback = new PlaybackState();
