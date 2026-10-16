import { expect, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'mouse interaction (desktop project)');

test.describe('piano roll with a mouse', () => {
	test('draw tool creates a note whose length follows the drag', async ({ app, page }) => {
		await app.selectTool('Draw notes');
		const a = await app.point(480, 62);
		const b = await app.point(1000, 62);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 6 });
		await page.mouse.up();
		expect(await app.notes).toEqual([{ tick: 480, length: 480, pitch: 62, lyric: 'a' }]);
	});

	test('drag moves, edge handles stretch, undo/redo walk back and forth', async ({ app, page }) => {
		await app.setNotes([{ tick: 480, length: 480, pitch: 62 }]);
		const body = await app.point(580, 62);
		const dest = await app.point(1060, 65);
		await page.mouse.move(body.x, body.y);
		await page.mouse.down();
		await page.mouse.move(dest.x, dest.y, { steps: 8 });
		await page.mouse.up();
		expect(await app.notes).toMatchObject([{ tick: 960, pitch: 65 }]);

		await app.settle();
		const end = await app.point(960 + 480, 65);
		const wider = await app.point(960 + 960, 65);
		await page.mouse.move(end.x - 3, end.y);
		await page.mouse.down();
		await page.mouse.move(wider.x - 3, wider.y, { steps: 6 });
		await page.mouse.up();
		expect(await app.notes).toMatchObject([{ tick: 960, length: 960 }]);

		await app.settle();
		const start = await app.point(960, 65);
		const earlier = await app.point(720, 65);
		await page.mouse.move(start.x + 3, start.y);
		await page.mouse.down();
		await page.mouse.move(earlier.x + 3, earlier.y, { steps: 6 });
		await page.mouse.up();
		expect(await app.notes).toMatchObject([{ tick: 720, length: 1200 }]);

		await page.keyboard.press('Control+z');
		await page.keyboard.press('Control+z');
		expect(await app.notes).toMatchObject([{ tick: 960, length: 480 }]);
		await page.keyboard.press('Control+Shift+z');
		expect(await app.notes).toMatchObject([{ length: 960 }]);
	});

	test('keyboard: arrows move, Ctrl+D duplicates, Delete removes', async ({ app, page }) => {
		await app.setNotes([{ tick: 0, length: 480, pitch: 60 }]);
		const p = await app.point(100, 60);
		await page.mouse.click(p.x, p.y);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowRight');
		expect(await app.notes).toMatchObject([{ pitch: 61, tick: 240 }]);
		await page.keyboard.press('Control+d');
		expect(await app.notes).toHaveLength(2);
		await page.keyboard.press('Delete');
		expect(await app.notes).toHaveLength(1);
	});

	test('right-click opens the note menu; Delete removes the note', async ({ app, page }) => {
		await app.setNotes([{ tick: 0, length: 960, pitch: 60 }]);
		const p = await app.point(400, 60);
		await page.mouse.click(p.x, p.y, { button: 'right' });
		await expect(page.getByRole('menu')).toBeVisible();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		expect(await app.notes).toHaveLength(0);
	});

	test('eraser deletes everything under a stroke as one undo step', async ({ app, page }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60 },
			{ tick: 480, pitch: 62 },
			{ tick: 960, pitch: 64 }
		]);
		await app.selectTool('Eraser');
		const a = await app.point(100, 60);
		const b = await app.point(1100, 64);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 12 });
		await page.mouse.move(b.x, b.y, { steps: 12 });
		await page.mouse.up();
		expect((await app.notes).length).toBeLessThan(3);
		await page.keyboard.press('Control+z');
		expect(await app.notes).toHaveLength(3);
	});

	test('rubber-band selects the notes it touches', async ({ app, page }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60 },
			{ tick: 480, pitch: 61 },
			{ tick: 960, pitch: 62 }
		]);
		const a = await app.point(-120, 66);
		const b = await app.point(1500, 58);
		await page.mouse.move(Math.max(a.x, (await app.geo()).left + (await app.geo()).keysW + 2), a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 8 });
		await page.mouse.up();
		expect(await app.eval((w) => w.project.selection.size)).toBe(3);
	});

	test('pitch tool adds a point on click and removes it on double-click', async ({ app, page }) => {
		await app.setNotes([{ tick: 0, length: 960, pitch: 60 }]);
		const n = await app.point(100, 60);
		await page.mouse.click(n.x, n.y);
		await app.selectTool('Pitch curve');
		const at = { x: n.x + 60, y: n.y - 14 };
		await app.settle();
		await page.mouse.click(at.x, at.y);
		expect(await app.eval((w) => w.project.notes[0].pitchPoints.length)).toBe(1);
		await app.settle();
		await page.mouse.dblclick(at.x, at.y);
		expect(await app.eval((w) => w.project.notes[0].pitchPoints.length)).toBe(0);
	});

	test('double-click edits the lyric inline', async ({ app, page }) => {
		await app.setNotes([{ tick: 0, length: 960, pitch: 60, lyric: 'a' }]);
		const p = await app.point(300, 60);
		await page.mouse.dblclick(p.x, p.y);
		const input = page.getByLabel('Lyric', { exact: true }).first();
		await expect(input).toBeFocused();
		await page.keyboard.type('ka');
		await page.keyboard.press('Enter');
		expect((await app.notes)[0].lyric).toBe('ka');
	});

	test('piano keys highlight while pressed', async ({ app, page }) => {
		const g = await app.geo();
		const y = g.top + g.row60 + g.keyH / 2;
		await page.mouse.move(g.left + 20, y);
		await page.mouse.down();
		expect(await app.eval((w) => w.roll.current.pressedKey)).toBe(60);
		await page.mouse.up();
		expect(await app.eval((w) => w.roll.current.pressedKey)).toBeNull();
	});
});
