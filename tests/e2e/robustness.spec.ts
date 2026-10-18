import { readFile } from 'node:fs/promises';
import { expect, test, type App } from './fixtures';

/** Odd input and rough handling: nothing may crash, hang or give wrong audio. */

const LYRICS = ['ka', 'sa', 'mi', 'ta', 'a', 'ke', 'su', 'mo'];
const line = (count: number, step = 480) =>
	Array.from({ length: count }, (_, i) => ({
		tick: i * step,
		length: step,
		pitch: 57 + ((i * 5) % 12),
		lyric: LYRICS[i % LYRICS.length]
	}));

/** Page errors (uncaught exceptions) of the test, for the "nothing blew up" assertions. */
function watchErrors(page: import('@playwright/test').Page) {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	return errors;
}

const rendered = async (app: App) => {
	await app.eval((w) => w.playback.render());
	return app.eval((w) => ({
		status: w.playback.status,
		message: w.playback.message,
		peak: (() => {
			let m = 0;
			for (const v of w.playback.stream.buffer) m = Math.max(m, Math.abs(v));
			return m;
		})(),
		finite: Array.from(w.playback.stream.buffer).every((v: number) => Number.isFinite(v))
	}));
};

test.describe('engine robustness', () => {
	test.beforeEach(async ({ app }) => {
		await app.loadVoicebank();
	});

	test('whatever is typed into the flags box renders and never takes the engine down', async ({
		app,
		page
	}) => {
		const errors = watchErrors(page);
		const flags = [
			'',
			'あg5',
			'🎤',
			'g-',
			'---',
			'B999',
			'fe99999999999999',
			'g5/あ///',
			'xyz',
			'gw-1G',
			'+'
		];
		await app.setNotes(
			flags.map((_, i) => ({
				tick: i * 480,
				length: 480,
				pitch: 60 + (i % 5),
				lyric: LYRICS[i % 8]
			}))
		);
		await app.eval((w, list) => {
			list.forEach((f, i) => w.project.updateNote(w.project.notes[i].id, { flags: f }));
		}, flags);
		const out = await rendered(app);
		expect(out.status).toBe('ready');
		expect(out.finite).toBe(true);
		expect(out.peak).toBeGreaterThan(0.05);
		expect(out.message).toMatch(/Rendered 11/);
		// The engine is alive afterwards.
		await app.eval((w) => w.project.updateNote(w.project.notes[0].id, { flags: 'g10' }));
		expect((await rendered(app)).status).toBe('ready');
		expect(errors).toEqual([]);
	});

	test('extreme pitches, tiny and huge notes all give finite audio', async ({ app }) => {
		await app.setNotes([
			{ tick: 0, length: 15, pitch: 60, lyric: 'ka' },
			{ tick: 480, length: 480, pitch: 12, lyric: 'sa' },
			{ tick: 960, length: 480, pitch: 119, lyric: 'mi' },
			{ tick: 1440, length: 19200, pitch: 60, lyric: 'a' }
		]);
		const out = await rendered(app);
		expect(out.status).toBe('ready');
		expect(out.finite).toBe(true);
		expect(out.peak).toBeGreaterThan(0.05);
	});

	test('a song that is far too long is refused with a message instead of exhausting memory', async ({
		app
	}) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'a' },
			{ tick: 480 * 2 * 60 * 40, pitch: 60, lyric: 'a' }
		]);
		await app.eval((w) => void w.playback.play());
		expect(await app.eval((w) => w.playback.playing)).toBe(false);
		expect(await app.eval((w) => w.playback.status)).not.toBe('error');
		expect(await app.eval((w) => w.ui.status)).toMatch(/rendering is limited/);
	});

	test('repeating a syllable on one pitch renders it once and reuses it', async ({ app }) => {
		await app.setNotes(
			Array.from({ length: 8 }, (_, i) => ({ tick: i * 1000, length: 480, pitch: 60, lyric: 'ka' }))
		);
		const out = await rendered(app);
		expect(out.message).toMatch(/Rendered 1, reused 7/);
	});

	test('notes line up with the tempo, also across tempo changes', async ({ app }) => {
		await app.setNotes(line(8, 480));
		await app.eval((w) => {
			w.project.setTempo(90, 0);
			w.project.setTempo(200, 1920);
		});
		await rendered(app);
		const problems = await app.eval((w) => {
			const out: string[] = [];
			for (const n of w.project.notes) {
				const span = w.playback.spans.find((s: { id: string }) => s.id === n.id);
				const start = w.project.tempoMap.tickToMs(n.tick);
				if (!span) out.push(`${n.id}: no span`);
				else if (span.start > start + 1 || span.end < start || start - span.start > 800)
					out.push(`${n.id}: note at ${start} ms but sound ${span.start}–${span.end}`);
			}
			return out;
		});
		expect(problems).toEqual([]);
	});

	test('two tracks sing at the same time and both are in the mix', async ({ app }) => {
		await app.eval((w) => {
			w.project.load({ name: 'Two', notes: [] });
			w.project.addNote({ tick: 0, length: 960, pitch: 60, lyric: 'a' });
			w.project.addTrack();
			w.project.addNote({ tick: 0, length: 960, pitch: 67, lyric: 'a' });
			w.project.clearSelection();
		});
		const both = await rendered(app);
		const level = (ms: number) =>
			app.eval((w, at) => {
				const pcm = w.playback.stream.buffer;
				const a = Math.floor((at / 1000) * 44100);
				let sum = 0;
				for (let i = a; i < a + 4410; i++) sum += pcm[i] * pcm[i];
				return Math.sqrt(sum / 4410);
			}, ms);
		const together = await level(500);
		await app.eval((w) => w.project.updateTrack(w.project.tracks[1].id, { mute: true }));
		await rendered(app);
		const alone = await level(500);
		expect(both.status).toBe('ready');
		expect(together).toBeGreaterThan(alone * 1.15);
	});

	test('an unknown lyric does not stop its neighbours', async ({ app }) => {
		await app.setNotes([
			{ tick: 0, lyric: 'ka', pitch: 60 },
			{ tick: 480, lyric: 'zzzz', pitch: 60 },
			{ tick: 960, lyric: 'sa', pitch: 62 }
		]);
		const out = await rendered(app);
		expect(out.status).toBe('ready');
		expect(out.message).toMatch(/Rendered 2/);
		expect(await app.eval((w) => w.playback.unknownLyrics.size)).toBe(1);
	});

	test('exported WAV is a valid file with the audio of the song and no clipping', async ({
		app,
		page
	}) => {
		await app.eval((w) => {
			w.project.load({ name: 'Loud one', notes: [] });
			for (let i = 0; i < 6; i++) {
				if (i) w.project.addTrack();
				w.project.addNote({ tick: 0, length: 960, pitch: 60, lyric: 'a' });
			}
			w.project.clearSelection();
		});
		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 60_000 }),
			app.eval((w) => void w.file.exportWav())
		]);
		expect(download.suggestedFilename()).toBe('Loud one.wav');
		const bytes = await readFile((await download.path())!);
		expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
		expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
		expect(bytes.readUInt32LE(24)).toBe(44100);
		const samples = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) / 2);
		let peak = 0;
		for (const s of samples) peak = Math.max(peak, Math.abs(s));
		expect(peak).toBeGreaterThan(8000);
		expect(peak).toBeLessThanOrEqual(32767 * 0.97);
		expect(samples.length).toBeGreaterThan(44100);
	});

	test('a file name with odd characters still downloads', async ({ app, page }) => {
		await app.setNotes(line(2));
		await app.eval((w) => (w.project.name = 'a/b:c*d?"e<f>g|h'));
		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 60_000 }),
			app.eval((w) => void w.file.exportWav())
		]);
		expect(download.suggestedFilename()).toMatch(/^[^/\\:*?"<>|]+\.wav$/);
	});
});

test.describe('the transport under rough handling', () => {
	test.beforeEach(async ({ app }) => {
		await app.loadVoicebank();
	});

	test('seeking, pausing, playing and stopping in any order leaves a sane state', async ({
		app,
		page
	}) => {
		const errors = watchErrors(page);
		await app.setNotes(line(60, 300));
		let seed = 7;
		const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const ops = ['seek', 'play', 'pause', 'stop', 'seek', 'play', 'toggle'];
		for (let i = 0; i < 60; i++) {
			const op = ops[Math.floor(rnd() * ops.length)];
			const ms = Math.floor(rnd() * 25_000);
			await app.eval(
				(w, [o, at]) => {
					if (o === 'seek') w.playback.seekMs(at);
					else if (o === 'play') void w.playback.play();
					else if (o === 'pause') w.playback.pause();
					else if (o === 'stop') w.playback.stop();
					else void w.playback.toggle();
				},
				[op, ms] as [string, number]
			);
			if (i % 6 === 0) await page.waitForTimeout(80);
			const s = await app.eval((w) => ({
				pos: w.playback.positionMs,
				playing: w.playback.playing,
				status: w.playback.status
			}));
			expect(Number.isFinite(s.pos) && s.pos >= 0, `after ${op}: ${JSON.stringify(s)}`).toBe(true);
			expect(s.status).not.toBe('error');
		}
		await app.eval((w) => w.playback.stop());
		expect(await app.eval((w) => w.playback.playing)).toBe(false);
		expect(await app.eval((w) => w.playback.positionMs)).toBe(0);
		expect(await app.eval((w) => w.playback.buffering)).toBe(false);
		expect(errors).toEqual([]);
	});

	test('a storm of edits while playing ends with a consistent render and no errors', async ({
		app,
		page
	}) => {
		const errors = watchErrors(page);
		await app.setNotes(line(40, 300));
		await app.eval((w) => void w.playback.play());
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(300);
		for (let i = 0; i < 30; i++) {
			await app.eval((w, k) => {
				const n = w.project.notes[k % w.project.notes.length];
				w.project.updateNote(n.id, { pitch: 55 + (k % 12) });
				if (k % 7 === 0) w.project.updateTrack(w.project.tracks[0].id, { volume: 50 + (k % 50) });
			}, i);
			if (i % 5 === 0) await page.waitForTimeout(120);
		}
		// Everything settles: the render of the final song exists and the transport is still going.
		await expect.poll(() => app.eval((w) => w.playback.isStale), { timeout: 10_000 }).toBe(false);
		expect(await app.eval((w) => w.playback.status)).not.toBe('error');
		const at = await app.eval((w) => w.playback.positionMs);
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(at);
		await app.eval((w) => w.playback.stop());
		expect(errors).toEqual([]);
	});

	test('playing right to the end stops by itself and the next play starts over', async ({
		app
	}) => {
		await app.setNotes(line(3, 240));
		await app.eval((w) => void w.playback.play());
		await expect.poll(() => app.eval((w) => w.playback.playing), { timeout: 20_000 }).toBe(true);
		await expect.poll(() => app.eval((w) => w.playback.playing), { timeout: 30_000 }).toBe(false);
		expect(await app.eval((w) => w.playback.positionMs)).toBe(0);
		await app.eval((w) => void w.playback.play());
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(100);
		await app.eval((w) => w.playback.stop());
	});

	test('playing with nothing to play, or without a voicebank, says so and does not start', async ({
		app,
		page
	}) => {
		await app.setNotes([]);
		await app.eval((w) => void w.playback.play());
		expect(await app.eval((w) => w.playback.playing)).toBe(false);
		await page.reload();
		await page.waitForSelector('canvas');
		await app.eval((w) => {
			w.project.addNote({ tick: 0, pitch: 60 });
		});
		await app.eval((w) => void w.playback.play());
		expect(await app.eval((w) => w.playback.playing)).toBe(false);
	});
});
