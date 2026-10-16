import { expect, test } from './fixtures';

test.describe('lyric editor suggestions', () => {
	test.beforeEach(async ({ app }) => {
		await app.loadVoicebank();
		await app.setNotes([{ tick: 480, length: 960, pitch: 62, lyric: 'a' }]);
		await app.eval((w) => {
			w.ui.requestLyricEdit = w.project.notes[0].id;
		});
	});

	const lyric = (app: { notes: Promise<{ lyric: string }[]> }) => app.notes.then((n) => n[0].lyric);

	test('lists the voicebank aliases and keeps the input focused', async ({ page }) => {
		const options = page.getByRole('listbox').getByRole('option');
		await expect(options.first()).toBeVisible();
		expect(await options.count()).toBeGreaterThan(10);
		await expect(page.getByRole('textbox', { name: 'Lyric' }).first()).toBeFocused();
	});

	test('scrolling the list with a finger never picks an entry', async ({ app, touch, page }) => {
		test.skip(!app.isMobile, 'touch gesture');
		const list = page.getByRole('listbox');
		await expect(list).toBeVisible();
		const box = (await list.boundingBox())!;
		const x = box.x + box.width / 2;
		const before = await list.evaluate((el) => el.scrollTop);
		await touch.drag({ x, y: box.y + box.height - 20 }, { x, y: box.y + 30 }, 10);
		await page.waitForTimeout(400);
		expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
		await expect(list).toBeVisible();
		expect(await lyric(app)).toBe('a');
	});

	test('a tap on an entry picks it', async ({ app, page }) => {
		await app.press(page.getByRole('listbox').getByRole('option', { name: 'ka', exact: true }));
		expect(await lyric(app)).toBe('ka');
		await expect(page.getByRole('listbox')).toHaveCount(0);
	});

	test('mouse wheel over the list scrolls it without picking', async ({ app, page }) => {
		test.skip(app.isMobile, 'mouse only');
		const list = page.getByRole('listbox');
		await list.hover();
		await page.mouse.wheel(0, 300);
		await expect(list).toBeVisible();
		expect(await lyric(app)).toBe('a');
	});

	test('arrow keys + Enter pick, Escape cancels', async ({ app, page }) => {
		test.skip(app.isMobile, 'hardware keyboard');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		expect(await lyric(app)).not.toBe('a');

		await app.eval((w) => {
			w.ui.requestLyricEdit = w.project.notes[0].id;
		});
		await page.keyboard.type('zzz');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('listbox')).toHaveCount(0);
		expect(await lyric(app)).not.toBe('zzz');
	});

	test('typing filters the list', async ({ page }) => {
		await page.keyboard.press('Control+a');
		await page.keyboard.type('k');
		const names = await page.getByRole('listbox').getByRole('option').allTextContents();
		expect(names.length).toBeGreaterThan(0);
		expect(names.every((n) => n.includes('k'))).toBe(true);
	});
});
