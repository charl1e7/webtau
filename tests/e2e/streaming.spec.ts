import { expect, test, type App } from './fixtures';

/**
 * Progressive rendering: playback starts at once, the render works ahead of
 * the playhead and follows it when it moves, and the finished audio has no holes.
 */

const LYRICS = ['ka', 'sa', 'mi', 'ta', 'a', 'ke', 'su', 'mo'];

/** `count` notes of 300 ms (half a beat at 120 BPM is 240 ticks; 288 ticks ≈ 300 ms). */
async function longSong(app: App, count: number, shift = 0) {
	await app.setNotes(
		Array.from({ length: count }, (_, i) => ({
			tick: i * 288,
			length: 288,
			pitch: 57 + shift + ((i * 5) % 12),
			lyric: LYRICS[i % LYRICS.length],
			// Every note a sound of its own: identical notes are rendered once, which would make the song too easy.
			volume: 40 + (i % 111)
		}))
	);
}

/** Rendering goes on while paused only when asked to (it is off by default). */
const renderInBackground = (app: App) => app.eval((w) => (w.settings.data.backgroundRender = true));

const done = (app: App) =>
	app.eval((w) => {
		const s = w.playback.stream;
		return s ? s.progress.done / Math.max(1, s.progress.total) : 0;
	});

test.describe('progressive rendering', () => {
	test.beforeEach(async ({ app }) => {
		await app.loadVoicebank();
	});

	test('playback starts before the whole song is rendered and the playhead advances', async ({
		app
	}) => {
		await longSong(app, 400);
		await app.eval((w) => void w.playback.play());
		await expect.poll(() => app.eval((w) => w.playback.playing), { timeout: 10_000 }).toBe(true);
		// Moving while most of the song does not exist yet.
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(400);
		expect(await done(app)).toBeLessThan(1);
		expect(await app.eval((w) => w.playback.status)).not.toBe('ready');
		// The render goes on while it plays, and the ruler can show how far it is.
		const before = await done(app);
		await expect.poll(() => done(app), { timeout: 20_000 }).toBeGreaterThan(before);
		expect(await app.eval((w) => w.playback.readyRanges.length)).toBeGreaterThan(0);
	});

	test('starting in the middle renders the middle first, and moving the playhead moves the render', async ({
		app
	}) => {
		await longSong(app, 400);
		const midMs = 60_000;
		await app.eval((w, at) => {
			w.playback.seekMs(at);
			void w.playback.play();
		}, midMs);
		// What is around the playhead becomes ready first, while the beginning does not exist yet.
		await expect
			.poll(() => app.eval((w, at) => w.playback.stream.readyUntil(at), midMs), { timeout: 30_000 })
			.toBeGreaterThan(midMs + 600);
		expect(await app.eval((w) => w.playback.stream.readyUntil(500))).toBeLessThan(900);
		expect(await done(app)).toBeLessThan(0.9);

		// Jump to near the end while playing: the render follows at once.
		const lateMs = 112_000;
		await app.eval((w, at) => w.playback.seekMs(at), lateMs);
		await expect
			.poll(() => app.eval((w, at) => w.playback.stream.readyUntil(at), lateMs), {
				timeout: 30_000
			})
			.toBeGreaterThan(lateMs + 600);
		expect(await app.eval((w) => w.playback.stream.complete)).toBe(false);
	});

	test('the playhead waits and says so when playback outruns the render', async ({ app }) => {
		await longSong(app, 400);
		// Far from the start: nothing there is ready when playback begins. A watcher records
		// every moment the transport reports buffering, and where the playhead was then.
		await app.eval((w) => {
			const seen = { buffering: false, positions: [] as number[], message: '' };
			(globalThis as Record<string, unknown>).seen = seen;
			setInterval(() => {
				if (!w.playback.buffering) return;
				seen.buffering = true;
				seen.message = w.playback.message;
				seen.positions.push(w.playback.positionMs);
			}, 5);
			w.playback.seekMs(90_000);
			void w.playback.play();
		});
		const seen = () =>
			app.eval(
				() =>
					(globalThis as Record<string, unknown>).seen as {
						buffering: boolean;
						positions: number[];
						message: string;
					}
			);
		await expect.poll(async () => (await seen()).buffering, { timeout: 20_000 }).toBe(true);
		const { positions, message } = await seen();
		// While buffering the position does not run away, and the user is told why.
		expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(100);
		expect(message).toMatch(/Buffering|Analyzing|Rendering/);
		// Then it carries on once the audio is there.
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 30_000 })
			.toBeGreaterThan(90_500);
		await expect.poll(() => app.eval((w) => w.playback.buffering)).toBe(false);
	});

	test('what was rendered out of order has no holes', async ({ app }) => {
		await renderInBackground(app);
		await longSong(app, 120);
		// Start in the middle, then jump around while it renders.
		await app.eval((w) => {
			w.playback.seekMs(20_000);
			void w.playback.play();
		});
		await expect.poll(() => done(app), { timeout: 30_000 }).toBeGreaterThan(0.1);
		await app.eval((w) => w.playback.seekMs(3_000));
		await app.eval((w) => w.playback.seekMs(30_000));
		await app.eval((w) => w.playback.pause());
		await expect.poll(() => app.eval((w) => w.playback.status), { timeout: 60_000 }).toBe('ready');

		const quiet = await app.eval((w) => {
			const pcm = w.playback.buffer.getChannelData(0);
			const sr = 44100;
			const holes: number[] = [];
			w.project.notes.forEach((n: { tick: number; length: number }, i: number) => {
				const a = Math.floor(((n.tick / 480) * 0.5 + 0.05) * sr);
				const b = Math.floor((((n.tick + n.length) / 480) * 0.5 - 0.03) * sr);
				let sum = 0;
				for (let k = a; k < b; k++) sum += pcm[k] * pcm[k];
				if (Math.sqrt(sum / Math.max(1, b - a)) < 0.003) holes.push(i);
			});
			return holes;
		});
		expect(quiet).toEqual([]);
	});

	test('the finished render is the same however it was reached', async ({ app }) => {
		await longSong(app, 40);
		// Rendered in order …
		await app.eval((w) => w.playback.render());
		const inOrder = await app.eval((w) => Array.from(w.playback.buffer.getChannelData(0)));
		// … and again from the end backwards (everything comes from the render cache).
		await app.eval((w) => w.project.updateNote(w.project.notes[0].id, { lyric: 'ka' }));
		await app.eval((w) => {
			w.project.updateNote(w.project.notes[0].id, { lyric: 'sa' });
			w.playback.seekMs(11_000);
		});
		await app.eval((w) => void w.playback.render());
		await app.eval((w) => w.project.updateNote(w.project.notes[0].id, { lyric: 'ka' }));
		await app.eval((w) => {
			w.playback.seekMs(11_000);
			return w.playback.render();
		});
		const again = await app.eval((w) => Array.from(w.playback.buffer.getChannelData(0)));
		expect(again.length).toBe(inOrder.length);
		let worst = 0;
		for (let i = 0; i < again.length; i++) worst = Math.max(worst, Math.abs(again[i] - inOrder[i]));
		expect(worst).toBeLessThan(1e-3);
	});

	test('pressing a piano key while the song renders does not disturb it', async ({ app }) => {
		await renderInBackground(app);
		await longSong(app, 150);
		await app.eval((w) => void w.playback.play());
		await expect.poll(() => done(app), { timeout: 20_000 }).toBeGreaterThan(0.05);
		await app.eval((w) => void w.playback.preview(64));
		await app.eval((w) => w.playback.pause());
		await expect.poll(() => app.eval((w) => w.playback.status), { timeout: 60_000 }).toBe('ready');
		const [, fresh, reused] =
			/Rendered (\d+), reused (\d+)/.exec(await app.eval((w) => w.playback.message)) ?? [];
		expect(Number(fresh) + Number(reused)).toBe(150);
		expect(await app.eval((w) => w.playback.unknownLyrics.size)).toBe(0);
	});

	test('with background rendering on, pausing keeps the render going and resuming continues from the same place', async ({
		app
	}) => {
		await renderInBackground(app);
		await longSong(app, 1500);
		await app.eval((w) => void w.playback.play());
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(600);
		await app.eval((w) => w.playback.pause());
		const at = await app.eval((w) => w.playback.positionMs);
		const before = await done(app);
		await expect.poll(() => done(app), { timeout: 20_000 }).toBeGreaterThan(before);
		expect(await app.eval((w) => w.playback.positionMs)).toBe(at);
		await app.eval((w) => void w.playback.play());
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(at + 300);
		await app.eval((w) => w.playback.stop());
	});

	test('editing a note starts a fresh render that reuses what was rendered', async ({ app }) => {
		await longSong(app, 60);
		await app.eval((w) => w.playback.render());
		expect(await app.eval((w) => w.playback.isStale)).toBe(false);
		await app.eval((w) => w.project.updateNote(w.project.notes[30].id, { pitch: 70 }));
		expect(await app.eval((w) => w.playback.isStale)).toBe(true);
		await app.eval((w) => w.playback.render());
		const message = await app.eval((w) => w.playback.message);
		const [, rendered] = /Rendered (\d+)/.exec(message) ?? [];
		// The edited note and its neighbour (its cross-fade changed); everything else is reused.
		expect(Number(rendered)).toBeLessThanOrEqual(3);
	});

	test('after running dry it waits for a lead of about two seconds before going on', async ({
		app
	}) => {
		await longSong(app, 400);
		await app.eval((w) => {
			const seen = { leads: [] as number[], was: false };
			(globalThis as Record<string, unknown>).lead = seen;
			setInterval(() => {
				const now = w.playback.buffering;
				if (seen.was && !now && w.playback.playing) {
					const at = w.playback.positionMs;
					seen.leads.push(w.playback.stream.readyUntil(at) - at);
				}
				seen.was = now;
			}, 5);
			w.playback.seekMs(60_000);
			void w.playback.play();
		});
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 30_000 })
			.toBeGreaterThan(61_500);
		const leads = await app.eval(
			() => ((globalThis as Record<string, unknown>).lead as { leads: number[] }).leads
		);
		expect(leads.length).toBeGreaterThan(0);
		// Playback did not go on the moment a single note was ready.
		for (const lead of leads) expect(lead).toBeGreaterThan(1900);
	});

	test('a mix that would clip is turned down on the fly, a normal one is left alone', async ({
		app
	}) => {
		const stack = (tracks: number) =>
			app.eval((w, count) => {
				w.project.load({ name: 'Loud', notes: [] });
				for (let i = 0; i < count; i++) {
					if (i > 0) w.project.addTrack();
					w.project.addNote({ tick: 0, length: 960, pitch: 60, lyric: 'a' });
				}
				w.project.clearSelection();
			}, tracks);
		const play = async () => {
			await app.eval((w) => {
				const seen = { min: 1 };
				(globalThis as Record<string, unknown>).gains = seen;
				setInterval(() => (seen.min = Math.min(seen.min, w.playback.limiterGain)), 5);
				void w.playback.play();
			});
			await expect
				.poll(() => app.eval((w) => w.playback.status), { timeout: 30_000 })
				.toBe('ready');
			await expect
				.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 30_000 })
				.toBeGreaterThan(300);
			await app.eval((w) => w.playback.pause());
			return app.eval(() => ((globalThis as Record<string, unknown>).gains as { min: number }).min);
		};
		const rawPeak = () =>
			app.eval((w) => {
				let peak = 0;
				for (const v of w.playback.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
				return peak;
			});

		await stack(1);
		const quiet = await play();
		expect(await rawPeak()).toBeLessThan(0.95);
		expect(quiet).toBe(1);

		await stack(12);
		await app.eval((w) => w.playback.stop());
		const loud = await play();
		expect(await rawPeak()).toBeGreaterThan(1);
		expect(loud).toBeLessThan(0.9);
	});

	test('changing a track under playback is heard without pausing', async ({ app }) => {
		await app.eval((w) => {
			w.project.load({ name: 'Edits', notes: [] });
			w.project.addNote({ tick: 0, length: 4800, pitch: 60, lyric: 'a' });
			w.project.addTrack();
			w.project.addNote({ tick: 0, length: 4800, pitch: 67, lyric: 'a' });
			w.project.clearSelection();
		});
		// Both tracks sing: remember how loud the mix is.
		const level = (from: number, ms: number) =>
			app.eval(
				(w, [a, b]) => {
					const pcm = w.playback.stream.buffer;
					const from = Math.floor((a / 1000) * 44100);
					const to = Math.floor(((a + b) / 1000) * 44100);
					let sum = 0;
					for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
					return Math.sqrt(sum / (to - from));
				},
				[from, ms]
			);
		await app.eval((w) => void w.playback.play());
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(500);
		const before = await level(1500, 500);
		expect(before).toBeGreaterThan(0.001);

		// Solo the first track while the song plays: no pause, the render follows.
		await app.eval((w) => w.project.updateTrack(w.project.tracks[0].id, { solo: true }));
		expect(await app.eval((w) => w.playback.playing)).toBe(true);
		await expect.poll(() => app.eval((w) => w.playback.isStale), { timeout: 5000 }).toBe(false);
		// The new render replaced what plays: the soloed track alone is quieter than both together.
		await expect.poll(() => level(1500, 500), { timeout: 20_000 }).toBeLessThan(before * 0.85);
		// And the transport carried on meanwhile.
		const at = await app.eval((w) => w.playback.positionMs);
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 10_000 })
			.toBeGreaterThan(at + 200);

		// Volume of a track: also taken up while playing.
		await app.eval((w) => w.project.updateTrack(w.project.tracks[0].id, { volume: 20 }));
		await expect.poll(() => level(2500, 500), { timeout: 20_000 }).toBeLessThan(before * 0.5);
		await app.eval((w) => w.playback.stop());
	});

	test('rendering stops with playback unless background rendering is on', async ({ app }) => {
		// Long enough that the render cannot finish within the test, even on a fast machine.
		await longSong(app, 1500);
		expect(await app.eval((w) => w.settings.data.backgroundRender)).toBe(false);
		await app.eval((w) => void w.playback.play());
		await expect.poll(() => done(app), { timeout: 20_000 }).toBeGreaterThan(0.02);
		await app.eval((w) => w.playback.pause());
		await app.page.waitForTimeout(600);
		const stopped = await done(app);
		await app.page.waitForTimeout(1500);
		expect(await done(app)).toBe(stopped);
		expect(await app.eval((w) => w.playback.busy)).toBe(false);
		// Playing again picks up from the cache and carries on.
		await app.eval((w) => void w.playback.play());
		await expect
			.poll(() => app.eval((w) => w.playback.positionMs), { timeout: 20_000 })
			.toBeGreaterThan(1000);
		await app.eval((w) => w.playback.pause());

		// With the option on, it goes on while paused. New pitches, so that nothing is in the cache.
		await longSong(app, 1500, 3);
		await app.eval((w) => (w.settings.data.backgroundRender = true));
		await app.eval((w) => void w.playback.play());
		await expect.poll(() => done(app), { timeout: 20_000 }).toBeGreaterThan(0.02);
		await app.eval((w) => w.playback.pause());
		const paused = await done(app);
		expect(paused).toBeLessThan(1);
		await expect.poll(() => done(app), { timeout: 20_000 }).toBeGreaterThan(paused);
		await app.eval((w) => w.playback.stop());
	});
});
