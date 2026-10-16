import { expect, test } from './fixtures';

test.skip(({ isMobile }) => !isMobile, 'touch interaction (mobile project)');

test.describe('piano roll with fingers', () => {
	test('pencil: dragging draws a note of the dragged length', async ({ app, touch }) => {
		await app.selectTool('Draw notes');
		const a = await app.point(240, 60);
		const b = await app.point(720, 60);
		await touch.drag(a, b);
		expect(await app.notes).toEqual([{ tick: 240, length: 480, pitch: 60, lyric: 'a' }]);
	});

	test('a finger on a note moves it, the end handle stretches it', async ({ app, touch }) => {
		await app.setNotes([{ tick: 480, length: 480, pitch: 62 }]);
		await app.selectTool('Select / move');
		const grab = await app.point(700, 62);
		const to = await app.point(940, 64);
		await touch.drag(grab, to);
		expect(await app.notes).toMatchObject([{ tick: 720, pitch: 64 }]);

		await app.settle();
		const end = await app.point(720 + 480, 64);
		const more = await app.point(720 + 480 + 240, 64);
		await touch.drag({ x: end.x + 6, y: end.y }, { x: more.x + 6, y: more.y });
		expect(await app.notes).toMatchObject([{ tick: 720, length: 720 }]);
	});

	test('a finger on empty space scrolls instead of selecting or drawing', async ({
		app,
		touch
	}) => {
		await app.setNotes([{ tick: 0, pitch: 60 }]);
		await app.selectTool('Select / move');
		const g = await app.geo();
		await touch.drag({ x: g.left + 300, y: g.top + 420 }, { x: g.left + 120, y: g.top + 420 }, 6);
		await app.page.waitForTimeout(1500);
		expect(await app.eval((w) => w.roll.current.scrollX)).toBeGreaterThan(50);
		expect(await app.notes).toHaveLength(1);
	});

	test('long-press opens the note menu without activating an item', async ({
		app,
		touch,
		page
	}) => {
		await app.setNotes([{ tick: 480, length: 720, pitch: 62 }]);
		const p = await app.point(700, 62);
		await touch.hold(p, 650);
		await expect(page.getByRole('menu')).toBeVisible();
		await page.waitForTimeout(500);
		await expect(page.getByRole('menu')).toBeVisible();
		await app.press(page.getByRole('menuitem', { name: 'Delete' }));
		expect(await app.notes).toHaveLength(0);
	});

	test('scrolling the long note menu does not trigger any item', async ({ app, touch, page }) => {
		await app.setNotes([{ tick: 480, length: 720, pitch: 62 }]);
		await touch.hold(await app.point(700, 62), 650);
		const menu = page.getByRole('menu');
		await expect(menu).toBeVisible();
		await page.waitForTimeout(500);
		const box = (await menu.boundingBox())!;
		const x = box.x + box.width / 2;
		await touch.drag({ x, y: box.y + box.height - 40 }, { x, y: box.y + 60 }, 10);
		await expect(menu).toBeVisible();
		expect(await app.notes).toHaveLength(1);
	});

	test('two fingers pinch-zoom without creating notes', async ({ app, touch }) => {
		await app.selectTool('Draw notes');
		const before = await app.eval((w) => w.view.pxPerTick);
		const g = await app.geo();
		await touch.pinch({ x: g.left + 200, y: g.top + 300 }, 80, 260);
		expect(await app.eval((w) => w.view.pxPerTick)).toBeGreaterThan(before * 1.5);
		expect(await app.notes).toHaveLength(0);
	});

	test('double-tap on empty space adds a note', async ({ app, touch }) => {
		await app.selectTool('Select / move');
		await app.settle(500);
		const p = await app.point(960, 64);
		await touch.tap(p.x, p.y);
		await app.page.waitForTimeout(120);
		await touch.tap(p.x, p.y);
		expect(await app.notes).toHaveLength(1);
	});
});
