import type { Page } from '@playwright/test';
import { expect, test, type App, type Touch } from './fixtures';

/** Opens the flyout of a tool button: right-click with a mouse, long-press with a finger. */
async function openFlyout(app: App, page: Page, touch: Touch, name: string) {
	const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
	const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	if (app.isMobile) await touch.hold(at, 700);
	else await page.mouse.click(at.x, at.y, { button: 'right' });
	await expect(page.getByRole('menu')).toBeVisible();
	// A menu opened by a long-press ignores taps for a moment (the lifting finger).
	await page.waitForTimeout(500);
}

const strokes = (app: App) => app.eval((w) => w.project.tracks.map((t) => t.pitchCurve.length));

test.describe('track pitch curve', () => {
	test.beforeEach(async ({ app }) => {
		await app.setNotes([
			{ tick: 0, length: 960, pitch: 60 },
			{ tick: 960, length: 960, pitch: 64 }
		]);
	});

	test('whole-track freehand is the default; the pitch button has a flyout', async ({
		app,
		page,
		touch
	}) => {
		expect(await app.eval((w) => w.settings.data.pitchMode)).toBe('track');
		expect(await app.eval((w) => w.settings.data.pitchStyle)).toBe('freehand');
		await openFlyout(app, page, touch, 'Pitch curve');
		const menu = page.getByRole('menu');
		await expect(menu.getByRole('menuitem')).toHaveCount(4);
		await expect(menu.getByRole('menuitem', { name: /Freehand · whole track/ })).toHaveClass(
			/active/
		);
		await menu.getByRole('menuitem', { name: /Points · single notes/ }).click({ force: true });
		expect(await app.eval((w) => w.settings.data.pitchMode)).toBe('note');
		expect(await app.eval((w) => w.settings.data.pitchStyle)).toBe('points');
		expect(await app.eval((w) => w.view.tool)).toBe('pitch');
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
			w.settings.data.pitchStyle = 'points';
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

test.describe('placing pitch points on the track curve', () => {
	test.beforeEach(async ({ app }) => {
		await app.setNotes([
			{ tick: 0, length: 960, pitch: 60 },
			{ tick: 960, length: 960, pitch: 64 }
		]);
		await app.eval((w) => (w.settings.data.pitchStyle = 'points'));
		await app.selectTool('Pitch curve');
	});

	const tap = async (app: App, page: Page, touch: Touch, x: number, y: number) => {
		if (app.isMobile) await touch.tap(x, y);
		else await page.mouse.click(x, y);
		await app.settle(400);
	};
	const points = (app: App) =>
		app.eval((w) => w.project.tracks[0].pitchCurve.map((s) => s.map((p) => p.pitch)));

	test('clicks build one curve, a far click starts another', async ({ app, page, touch }) => {
		for (const [tick, pitch] of [
			[200, 61],
			[700, 63],
			[1200, 62]
		]) {
			const p = await app.point(tick, pitch);
			await tap(app, page, touch, p.x, p.y);
		}
		expect((await points(app)).map((s) => s.length)).toEqual([3]);
		// The curve already bends the notes: points are enough, no stroke needed.
		const bend = await app.eval((w) => {
			const stroke = w.project.tracks[0].pitchCurve[0];
			return stroke.map((p) => Math.round(p.pitch));
		});
		expect(bend).toEqual([61, 63, 62]);

		// Zoom out so that a point more than a measure away is on screen on a phone as well.
		await app.eval((w) => (w.view.pxPerTick = 0.05));
		await app.settle(200);
		const far = await app.point(1920 * 3, 66);
		await tap(app, page, touch, far.x, far.y);
		expect((await points(app)).map((s) => s.length)).toEqual([3, 1]);
		await page.keyboard.press('Control+z');
		expect((await points(app)).map((s) => s.length)).toEqual([3]);
	});

	test('a point can be dragged and removed with a double-click', async ({ app, page, touch }) => {
		test.skip(app.isMobile, 'double-click removal is covered with a mouse');
		for (const [tick, pitch] of [
			[200, 61],
			[700, 63]
		]) {
			const p = await app.point(tick, pitch);
			await tap(app, page, touch, p.x, p.y);
		}
		const from = await app.point(700, 63);
		const to = await app.point(700, 66);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 6 });
		await page.mouse.up();
		const moved = (await points(app))[0];
		expect(moved[1]).toBeCloseTo(66, 0);
		expect(moved).toHaveLength(2);

		await app.settle(500);
		await page.mouse.dblclick(to.x, to.y);
		expect((await points(app))[0]).toHaveLength(1);
	});

	test('a point of a freehand stroke can be grabbed and moved too', async ({
		app,
		page,
		touch
	}) => {
		test.skip(app.isMobile, 'mouse drag');
		await app.eval((w) => (w.settings.data.pitchStyle = 'freehand'));
		const a = await app.point(100, 62);
		const b = await app.point(1700, 66);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 12 });
		await page.mouse.up();
		const before = (await points(app))[0];
		expect(before.length).toBeGreaterThan(1);

		await app.settle(500);
		const last = await app.eval((w) => {
			const stroke = w.project.tracks[0].pitchCurve[0];
			return stroke[stroke.length - 1];
		});
		const at = await app.point(last.tick, last.pitch);
		const up = await app.point(last.tick, last.pitch + 3);
		await page.mouse.move(at.x, at.y);
		await page.mouse.down();
		await page.mouse.move(up.x, up.y, { steps: 6 });
		await page.mouse.up();
		const after = (await points(app))[0];
		expect(after).toHaveLength(before.length);
		expect(after[after.length - 1]).toBeCloseTo(before[before.length - 1] + 3, 0);
		void touch;
	});
});

test.describe('freehand drawing in the single-note mode', () => {
	test('a stroke over two notes lands in their own pitch points', async ({ app, page, touch }) => {
		await app.setNotes([
			{ tick: 0, length: 960, pitch: 60 },
			{ tick: 960, length: 960, pitch: 64 }
		]);
		await app.eval((w) => (w.settings.data.pitchMode = 'note'));
		await app.selectTool('Pitch curve');
		const a = await app.point(100, 61);
		const b = await app.point(1700, 65);
		if (app.isMobile) await touch.drag(a, b, 14);
		else {
			await page.mouse.move(a.x, a.y);
			await page.mouse.down();
			await page.mouse.move(b.x, b.y, { steps: 14 });
			await page.mouse.up();
		}
		expect(await app.eval((w) => w.project.notes.map((n) => n.pitchPoints.length > 1))).toEqual([
			true,
			true
		]);
		expect(await app.eval((w) => w.project.tracks[0].pitchCurve.length)).toBe(0);
		await page.keyboard.press('Control+z');
		expect(await app.eval((w) => w.project.notes.map((n) => n.pitchPoints.length))).toEqual([0, 0]);
	});
});

test.describe('eraser flyout', () => {
	test.beforeEach(async ({ app }) => {
		await app.setNotes([{ tick: 0, length: 960, pitch: 60 }]);
		await app.eval((w) => {
			w.project.addPitchStroke(w.project.tracks[0].id, [
				{ tick: 1200, pitch: 62 },
				{ tick: 2400, pitch: 62 }
			]);
			w.project.updateNote(w.project.notes[0].id, {
				pitchPoints: [{ id: 'p1', x: 100, y: 50, shape: 'l' }]
			});
		});
	});

	const scrub = async (app: App, page: Page, touch: Touch, tick: number, pitch: number) => {
		const a = await app.point(tick, pitch);
		const b = await app.point(tick + 100, pitch);
		if (app.isMobile) await touch.drag(a, b, 6);
		else {
			await page.mouse.move(a.x, a.y);
			await page.mouse.down();
			await page.mouse.move(b.x, b.y, { steps: 6 });
			await page.mouse.up();
		}
	};

	test('long-press / right-click offers notes only and pitch only; all is the default', async ({
		app,
		page,
		touch
	}) => {
		expect(await app.eval((w) => w.settings.data.eraserMode)).toBe('all');
		await openFlyout(app, page, touch, 'Eraser');
		const menu = page.getByRole('menu');
		await expect(menu.getByRole('menuitem')).toHaveCount(3);
		await expect(menu.getByRole('menuitem', { name: 'Erase notes and pitch' })).toHaveClass(
			/active/
		);
		await menu.getByRole('menuitem', { name: 'Erase pitch only' }).click({ force: true });
		expect(await app.eval((w) => w.settings.data.eraserMode)).toBe('pitch');
		expect(await app.eval((w) => w.view.tool)).toBe('erase');
	});

	test('pitch only keeps the notes and removes what was drawn', async ({ app, page, touch }) => {
		await app.eval((w) => (w.settings.data.eraserMode = 'pitch'));
		await app.selectTool('Eraser');
		await scrub(app, page, touch, 100, 60);
		expect(await app.notes).toHaveLength(1);
		expect(await app.eval((w) => w.project.notes[0].pitchPoints.length)).toBe(0);
		await app.settle(500);
		await scrub(app, page, touch, 1500, 62);
		expect(await strokes(app)).toEqual([2]);
		expect(await app.notes).toHaveLength(1);
	});

	test('notes only leaves the drawn pitch alone', async ({ app, page, touch }) => {
		await app.eval((w) => (w.settings.data.eraserMode = 'notes'));
		await app.selectTool('Eraser');
		await scrub(app, page, touch, 1500, 62);
		expect(await strokes(app)).toEqual([1]);
		await app.settle(500);
		await scrub(app, page, touch, 100, 60);
		expect(await app.notes).toHaveLength(0);
		expect(await strokes(app)).toEqual([1]);
	});

	test('the default eraser takes notes and pitch', async ({ app, page, touch }) => {
		await app.selectTool('Eraser');
		await scrub(app, page, touch, 1500, 62);
		expect(await strokes(app)).toEqual([2]);
		await app.settle(500);
		await scrub(app, page, touch, 100, 60);
		expect(await app.notes).toHaveLength(0);
	});
});

test.describe('the drawn pitch follows its notes', () => {
	const strokesOf = (app: App) =>
		app.eval((w) => w.project.tracks[0].pitchCurve.map((st) => st.map((p) => [p.tick, p.pitch])));
	/** Curve value at `tick` (linear between points), null where nothing is drawn. */
	const at = (list: number[][][], tick: number) => {
		for (const st of list) {
			if (tick < st[0][0] || tick > st[st.length - 1][0]) continue;
			for (let i = 1; i < st.length; i++) {
				if (tick <= st[i][0]) {
					const [t0, v0] = st[i - 1];
					const [t1, v1] = st[i];
					return t1 === t0 ? v1 : v0 + ((v1 - v0) * (tick - t0)) / (t1 - t0);
				}
			}
		}
		return null;
	};

	test.beforeEach(async ({ app }) => {
		await app.setNotes([
			{ tick: 0, length: 960, pitch: 60 },
			{ tick: 960, length: 960, pitch: 64 }
		]);
		await app.eval((w) =>
			w.project.setPitchCurve(w.project.tracks[0].id, [
				[
					{ tick: 100, pitch: 60.5 },
					{ tick: 800, pitch: 61 },
					{ tick: 1200, pitch: 64.5 },
					{ tick: 1800, pitch: 63 }
				]
			])
		);
	});

	test('transposing a note carries its part of the curve; undo brings it back', async ({
		app,
		page
	}) => {
		test.skip(app.isMobile, 'keyboard');
		const before = await strokesOf(app);
		const p = await app.point(300, 60);
		await page.mouse.click(p.x, p.y);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		const after = await strokesOf(app);
		// First note: two semitones up; second note: untouched.
		for (const tick of [100, 400, 800]) {
			expect(at(after, tick)!).toBeCloseTo(at(before, tick)! + 2, 3);
		}
		for (const tick of [1100, 1200, 1500, 1800]) {
			expect(at(after, tick)!).toBeCloseTo(at(before, tick)!, 3);
		}

		// Quick nudges may share one undo step: undo until the note is back, no further.
		for (let i = 0; i < 2 && (await app.eval((w) => w.project.notes[0].pitch)) !== 60; i++) {
			await page.keyboard.press('Control+z');
		}
		expect(await app.eval((w) => w.project.notes[0].pitch)).toBe(60);
		expect(at(await strokesOf(app), 400)!).toBeCloseTo(at(before, 400)!, 3);
	});

	test('dragging a note up carries the curve along', async ({ app, page, touch }) => {
		const before = await strokesOf(app);
		const second = await app.point(1400, 64);
		const up = await app.point(1400, 67);
		if (app.isMobile) await touch.drag(second, up, 10);
		else {
			await page.mouse.move(second.x, second.y);
			await page.mouse.down();
			await page.mouse.move(up.x, up.y, { steps: 10 });
			await page.mouse.up();
		}
		expect(await app.eval((w) => w.project.notes[1].pitch)).toBe(67);
		const after = await strokesOf(app);
		for (const tick of [1000, 1200, 1500, 1800]) {
			expect(at(after, tick)!).toBeCloseTo(at(before, tick)! + 3, 3);
		}
		expect(at(after, 400)!).toBeCloseTo(at(before, 400)!, 3);
	});

	test('dragging a note back to where it was restores the curve exactly', async ({ app, page }) => {
		test.skip(app.isMobile, 'mouse drag');
		const before = await strokesOf(app);
		const a = await app.point(1400, 64);
		const b = await app.point(1400, 68);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 8 });
		await page.mouse.move(a.x, a.y, { steps: 8 });
		await page.mouse.up();
		expect(await app.eval((w) => w.project.notes[1].pitch)).toBe(64);
		expect(at(await strokesOf(app), 1500)!).toBeCloseTo(at(before, 1500)!, 3);
	});
});

test.describe('history and gestures of the curve', () => {
	test.beforeEach(async ({ app }) => {
		await app.setNotes([{ tick: 0, length: 1920, pitch: 60 }]);
	});
	const count = (app: App) => app.eval((w) => w.project.tracks[0].pitchCurve.map((s) => s.length));

	test('each stroke is one undo step and redo brings it back', async ({ app, page, touch }) => {
		await app.selectTool('Pitch curve');
		const draw = async (y: number) => {
			const a = await app.point(100, y);
			const b = await app.point(1500, y + 3);
			if (app.isMobile) await touch.drag(a, b, 12);
			else {
				await page.mouse.move(a.x, a.y);
				await page.mouse.down();
				await page.mouse.move(b.x, b.y, { steps: 12 });
				await page.mouse.up();
			}
			await app.settle(300);
		};
		await draw(61);
		await draw(64);
		// The second stroke is drawn over the first, so the middle of the curve is now the second one.
		const middle = () =>
			app.eval((w) => {
				const st = w.project.tracks[0].pitchCurve.find(
					(q) => q[0].tick <= 800 && q[q.length - 1].tick >= 800
				)!;
				const i = st.findIndex((p) => p.tick >= 800);
				return Math.round(i > 0 ? (st[i - 1].pitch + st[i].pitch) / 2 : st[0].pitch);
			});
		expect(await middle()).toBeGreaterThanOrEqual(64);
		await app.eval((w) => w.edit.undo());
		expect(await middle()).toBeLessThan(64);
		await app.eval((w) => w.edit.undo());
		expect(await count(app)).toEqual([]);
		await app.eval((w) => w.edit.redo());
		await app.eval((w) => w.edit.redo());
		expect(await middle()).toBeGreaterThanOrEqual(64);
	});

	test('placing, dragging and removing points are undoable', async ({ app, page, touch }) => {
		test.skip(app.isMobile, 'mouse');
		await app.eval((w) => (w.settings.data.pitchStyle = 'points'));
		await app.selectTool('Pitch curve');
		for (const [tick, pitch] of [
			[200, 61],
			[900, 63]
		]) {
			const p = await app.point(tick, pitch);
			await page.mouse.click(p.x, p.y);
			await app.settle(400);
		}
		expect(await count(app)).toEqual([2]);
		const from = await app.point(900, 63);
		const to = await app.point(900, 66);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 6 });
		await page.mouse.up();
		await app.settle(400);
		// A double-click on a point removes it.
		await page.mouse.dblclick(to.x, to.y);
		expect(await count(app)).toEqual([1]);
		await app.eval((w) => w.edit.undo());
		expect(await count(app)).toEqual([2]);
		await app.eval((w) => w.edit.undo());
		expect(await app.eval((w) => Math.round(w.project.tracks[0].pitchCurve[0][1].pitch))).toBe(63);
		await app.eval((w) => w.edit.undo());
		expect(await count(app)).toEqual([1]);
		void touch;
	});

	test('a long press on empty space with the points style opens the menu and leaves no point', async ({
		app,
		touch,
		page
	}) => {
		test.skip(!app.isMobile, 'touch gesture');
		await app.eval((w) => (w.settings.data.pitchStyle = 'points'));
		await app.selectTool('Pitch curve');
		const p = await app.point(1000, 66);
		await touch.hold(p, 800);
		await expect(page.getByRole('menu')).toBeVisible();
		expect(await count(app)).toEqual([]);
	});

	test('the track menu clears the curve of the active track only', async ({ app, page }) => {
		await app.eval((w) => {
			w.project.setPitchCurve(w.project.tracks[0].id, [
				[
					{ tick: 0, pitch: 60 },
					{ tick: 400, pitch: 61 }
				]
			]);
			w.project.addTrack('Two');
			w.project.setPitchCurve(w.project.tracks[1].id, [
				[
					{ tick: 0, pitch: 62 },
					{ tick: 400, pitch: 63 }
				]
			]);
		});
		await app.eval((w) => w.project.clearPitchCurve(w.project.tracks[1].id));
		expect(await app.eval((w) => w.project.tracks.map((t) => t.pitchCurve.length))).toEqual([1, 0]);
		await app.eval((w) => w.edit.undo());
		expect(await app.eval((w) => w.project.tracks.map((t) => t.pitchCurve.length))).toEqual([1, 1]);
		void page;
	});

	test('removing a track removes its curve and notes follow only their own track', async ({
		app
	}) => {
		await app.eval((w) => {
			w.project.addTrack('Two');
			const second = w.project.tracks[1].id;
			w.project.addNote({ tick: 0, length: 960, pitch: 60, track: second });
			w.project.setPitchCurve(w.project.tracks[0].id, [
				[
					{ tick: 0, pitch: 62 },
					{ tick: 400, pitch: 62 }
				]
			]);
		});
		// The curve of track 1 must not bend the note of track 2.
		const bend = await app.eval((w) => {
			const n = w.project.notes.find((q) => q.track === w.project.tracks[1].id)!;
			return n.pitchPoints.length;
		});
		expect(bend).toBe(0);
		await app.eval((w) => w.project.removeTrack(w.project.tracks[1].id));
		expect(await app.eval((w) => w.project.tracks[0].pitchCurve.length)).toBe(1);
	});

	test('the settings dialog changes the pitch and eraser options and they are remembered', async ({
		app,
		page
	}) => {
		await app.eval((w) => w.ui.openDialog('settings'));
		await page.getByLabel('Pitch editing').selectOption('note');
		await page.getByLabel('Drawing').selectOption('points');
		await page.locator('#s-eraser').selectOption('pitch');
		expect(
			await app.eval((w) => [
				w.settings.data.pitchMode,
				w.settings.data.pitchStyle,
				w.settings.data.eraserMode
			])
		).toEqual(['note', 'points', 'pitch']);
		await page.waitForTimeout(300);
		const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('webtau:settings')!));
		expect(stored).toMatchObject({ pitchMode: 'note', pitchStyle: 'points', eraserMode: 'pitch' });
	});
});
