import { expect, test } from './fixtures';

const strokes = (app: { eval: Function }) =>
	app.eval((w: any) => w.project.tracks.map((t: any) => t.pitchCurve.length)) as Promise<number[]>;

test.describe('track pitch curve', () => {
	test.beforeEach(async ({ app }) => {
		await app.setNotes([
			{ tick: 0, length: 960, pitch: 60 },
			{ tick: 960, length: 960, pitch: 64 }
		]);
	});

	test('the track mode is the default and the pitch tool offers a switch', async ({
		app,
		page
	}) => {
		expect(await app.eval((w) => w.settings.data.pitchMode)).toBe('track');
		const chip = page.getByRole('button', { name: /Pitch mode/ });
		await expect(chip).toHaveCount(0);
		await app.selectTool('Pitch curve');
		await expect(chip).toHaveAccessibleName(/whole track/);
		await app.press(chip);
		expect(await app.eval((w) => w.settings.data.pitchMode)).toBe('note');
		await app.press(chip);
		expect(await app.eval((w) => w.settings.data.pitchMode)).toBe('track');
	});

	test('one drag across several notes draws a single curve for the track', async ({
		app,
		page,
		touch
	}) => {
		await app.selectTool('Pitch curve');
		const a = await app.point(200, 61);
		const b = await app.point(1700, 65);
		if (app.isMobile) {
			await touch.drag(a, b, 14);
		} else {
			await page.mouse.move(a.x, a.y);
			await page.mouse.down();
			await page.mouse.move(b.x, b.y, { steps: 14 });
			await page.mouse.up();
		}
		expect(await strokes(app)).toEqual([1]);
		// No per-note points are needed: the notes follow the track curve.
		expect(await app.eval((w) => w.project.notes.every((n) => n.pitchPoints.length === 0))).toBe(
			true
		);
		const bend = await app.eval((w) => {
			const stroke = w.project.tracks[0].pitchCurve[0];
			return { first: stroke[0], last: stroke[stroke.length - 1], n: stroke.length };
		});
		expect(bend.first.pitch).toBeCloseTo(61, 0);
		expect(bend.last.pitch).toBeCloseTo(65, 0);
		expect(bend.n).toBeLessThan(12);

		await page.keyboard.press('Control+z');
		expect(await strokes(app)).toEqual([0]);
	});

	test('a tap with the pitch tool draws nothing and still selects a note', async ({
		app,
		page
	}) => {
		test.skip(app.isMobile, 'mouse click');
		await app.selectTool('Pitch curve');
		const p = await app.point(400, 60);
		await page.mouse.click(p.x, p.y);
		expect(await strokes(app)).toEqual([0]);
		expect(await app.eval((w) => w.project.selection.size)).toBe(1);
	});

	test('each track keeps its own curve in its own colour', async ({ app, page, touch }) => {
		await app.eval((w) => {
			w.project.addTrack('Harmony');
		});
		const colors = await app.eval((w) => w.project.tracks.map((t) => t.color));
		expect(new Set(colors).size).toBe(2);
		await app.selectTool('Pitch curve');
		const a = await app.point(100, 63);
		const b = await app.point(900, 63);
		if (app.isMobile) await touch.drag(a, b, 10);
		else {
			await page.mouse.move(a.x, a.y);
			await page.mouse.down();
			await page.mouse.move(b.x, b.y, { steps: 10 });
			await page.mouse.up();
		}
		// The new track is the active one, so it got the stroke.
		expect(await strokes(app)).toEqual([0, 1]);
	});

	test('the eraser cuts the curve and note mode leaves the curve alone', async ({ app, page }) => {
		test.skip(app.isMobile, 'mouse drag');
		await app.eval((w) => {
			const t = w.project.tracks[0].id;
			w.project.addPitchStroke(t, [
				{ tick: 0, pitch: 62 },
				{ tick: 1920, pitch: 62 }
			]);
		});
		await app.selectTool('Eraser');
		const a = await app.point(800, 62);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(a.x + 40, a.y, { steps: 5 });
		await page.mouse.up();
		expect(await strokes(app)).toEqual([2]);
		expect(await app.notes).toHaveLength(2);

		await page.keyboard.press('Control+z');
		expect(await strokes(app)).toEqual([1]);
	});

	test('note mode still places points on a selected note', async ({ app, page }) => {
		test.skip(app.isMobile, 'mouse click');
		await app.eval((w) => {
			w.settings.data.pitchMode = 'note';
			w.project.select([w.project.notes[0].id]);
		});
		await app.selectTool('Pitch curve');
		const p = await app.point(300, 60.5);
		await page.mouse.click(p.x, p.y);
		expect(await app.eval((w) => w.project.notes[0].pitchPoints.length)).toBe(1);
		expect(await strokes(app)).toEqual([0]);
	});

	test('the curve is part of the project data and can be cleared', async ({ app }) => {
		await app.eval((w) => {
			w.project.addPitchStroke(w.project.tracks[0].id, [
				{ tick: 0, pitch: 62 },
				{ tick: 960, pitch: 63 }
			]);
		});
		expect(await app.eval((w) => w.project.toData().tracks[0].pitchCurve.length)).toBe(1);
		await app.eval((w) => w.project.clearPitchCurve(w.project.tracks[0].id));
		expect(await strokes(app)).toEqual([0]);
	});
});
