import { expect, test } from './fixtures';

test.describe('audio engine in the browser', () => {
	test.beforeEach(async ({ app }) => {
		await app.loadVoicebank();
	});

	test('loads the voicebank and defaults to fast DIO analysis', async ({ app }) => {
		expect(await app.eval((w) => w.voicebank.current.aliases.length)).toBe(25);
		expect(await app.eval((w) => w.settings.data.analysisQuality)).toBe('fast');
		expect(await app.eval((w) => w.voicebank.current.name)).toBe('Test Bank');
	});

	test('does not analyze the whole voicebank in the background by default', async ({ app }) => {
		expect(await app.eval((w) => w.settings.data.backgroundAnalysis)).toBe(false);
		expect(await app.eval((w) => w.voicebank.warmingUp)).toBe(false);
	});

	test('Play renders audible audio and re-renders only what changed', async ({ app, page }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'ka' },
			{ tick: 480, pitch: 62, lyric: 'sa' },
			{ tick: 960, pitch: 64, lyric: 'mi' }
		]);
		await app.press(page.getByRole('button', { name: 'Play' }));
		await expect.poll(() => app.eval((w) => w.playback.status), { timeout: 45_000 }).toBe('ready');
		const peak = await app.eval((w) => {
			let m = 0;
			for (const v of w.playback.buffer.getChannelData(0)) m = Math.max(m, Math.abs(v));
			return m;
		});
		expect(peak).toBeGreaterThan(0.1);
		expect(await app.eval((w) => w.playback.message)).toMatch(/Rendered 3/);

		await app.eval((w) => w.playback.stop());
		await app.eval((w) => w.project.updateNote(w.project.notes[1].id, { pitch: 69 }));
		await app.eval((w) => w.playback.render());
		expect(await app.eval((w) => w.playback.message)).toMatch(/Rendered 1, reused 2/);
	});

	test('lyrics that are not in the voicebank are flagged', async ({ app }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'ka' },
			{ tick: 480, pitch: 62, lyric: 'zzz' }
		]);
		await app.eval((w) => w.playback.render());
		expect(await app.eval((w) => w.playback.unknownLyrics.size)).toBe(1);
	});

	test('resampler flags (g, A, fry) render without breaking the sound', async ({ app }) => {
		await app.eval((w) => {
			w.project.load({ name: 'F', notes: [] });
			w.project.addNote({
				tick: 0,
				length: 960,
				pitch: 60,
				lyric: 'ka',
				flags: 'g40A30fe300fv12',
				pitchPoints: [
					{ id: 'p', x: 0, y: 0, shape: 'l' },
					{ id: 'q', x: 300, y: 150, shape: 's' }
				]
			});
		});
		await app.eval((w) => w.playback.render());
		expect(await app.eval((w) => w.playback.status)).toBe('ready');
		const peak = await app.eval((w) => {
			let m = 0;
			for (const v of w.playback.buffer.getChannelData(0)) m = Math.max(m, Math.abs(v));
			return m;
		});
		expect(peak).toBeGreaterThan(0.1);
	});

	test('muted tracks are left out, solo plays only the soloed one', async ({ app }) => {
		await app.eval((w) => {
			w.project.load({ name: 'T', notes: [] });
			w.project.addNote({ tick: 0, length: 480, pitch: 60, lyric: 'ka' });
			w.project.addTrack();
			w.project.addNote({ tick: 0, length: 480, pitch: 64, lyric: 'sa' });
			w.project.updateTrack(w.project.tracks[1].id, { mute: true });
		});
		await app.eval((w) => w.playback.render());
		expect(await app.eval((w) => w.playback.message)).toMatch(/Rendered 1/);

		await app.eval((w) => {
			w.project.updateTrack(w.project.tracks[1].id, { mute: false });
			w.project.updateTrack(w.project.tracks[0].id, { solo: true });
		});
		await app.eval((w) => w.playback.render());
		const m = (await app.eval((w) => w.playback.message)).match(/Rendered (\d+), reused (\d+)/)!;
		expect(Number(m[1]) + Number(m[2])).toBe(1);
	});

	test('pressing a piano key renders and caches a voice preview', async ({ app, page }) => {
		test.skip(app.isMobile, 'keys are pressed with a mouse in this test');
		const g = await app.geo();
		await page.mouse.move(g.left + 20, g.top + g.row60 + g.keyH / 2);
		await page.mouse.down();
		await page.mouse.up();
		await expect
			.poll(() => app.eval((w) => w.playback.previewCache.size), { timeout: 20_000 })
			.toBeGreaterThan(0);
	});

	test('"analyze everything" covers the whole voicebank on request', async ({ app }) => {
		await app.eval((w) => w.voicebank.analyzeAll());
		await expect.poll(() => app.eval((w) => w.voicebank.stats.ready), { timeout: 60_000 }).toBe(25);
	});
});
