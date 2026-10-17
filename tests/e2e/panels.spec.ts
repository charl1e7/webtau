import { expect, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'docked panels exist on the desktop layout only');

test.describe('resizable side panels', () => {
	const width = (page: import('@playwright/test').Page, sel: string) =>
		page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().width ?? 0, sel);

	test('drag to resize, collapse when too small, reopen, double-click resets', async ({
		app,
		page
	}) => {
		const handle = page.getByRole('separator', { name: 'Resize left panel' });
		expect(Math.abs((await width(page, 'aside.left')) - 308)).toBeLessThan(2);

		let b = (await handle.boundingBox())!;
		const y = b.y + b.height / 2;
		await page.mouse.move(b.x + 6, y);
		await page.mouse.down();
		await page.mouse.move(b.x + 6 + 120, y, { steps: 6 });
		await page.mouse.up();
		expect(Math.abs((await width(page, 'aside.left')) - 428)).toBeLessThan(3);

		b = (await handle.boundingBox())!;
		await page.mouse.move(b.x + 6, y);
		await page.mouse.down();
		await page.mouse.move(b.x - 500, y, { steps: 8 });
		await page.mouse.up();
		expect(await width(page, 'aside.left')).toBe(0);
		expect(await app.eval((w) => w.settings.data.leftOpen)).toBe(false);

		await page.getByRole('button', { name: 'Show left panel' }).click();
		expect(await width(page, 'aside.left')).toBeGreaterThan(200);

		await handle.dblclick();
		expect(Math.abs((await width(page, 'aside.left')) - 308)).toBeLessThan(2);
	});

	test('the top-bar buttons toggle the panels and the right panel collapses too', async ({
		app,
		page
	}) => {
		await page.getByRole('button', { name: 'Toggle voicebank panel' }).click();
		expect(await width(page, 'aside.left')).toBe(0);
		await page.getByRole('button', { name: 'Toggle voicebank panel' }).click();
		expect(await width(page, 'aside.left')).toBeGreaterThan(200);

		const right = page.getByRole('separator', { name: 'Resize right panel' });
		const b = (await right.boundingBox())!;
		await page.mouse.move(b.x + 6, b.y + 300);
		await page.mouse.down();
		await page.mouse.move(b.x + 6 + 400, b.y + 300, { steps: 6 });
		await page.mouse.up();
		expect(await width(page, 'aside.right')).toBe(0);
		expect(await app.eval((w) => w.settings.data.rightOpen)).toBe(false);
	});

	test('panel sizes survive a reload', async ({ app, page }) => {
		const b = (await page.getByRole('separator', { name: 'Resize left panel' }).boundingBox())!;
		await page.mouse.move(b.x + 6, b.y + 200);
		await page.mouse.down();
		await page.mouse.move(b.x + 6 + 80, b.y + 200, { steps: 4 });
		await page.mouse.up();
		await page.reload();
		await page.waitForSelector('canvas');
		expect(Math.abs((await width(page, 'aside.left')) - 388)).toBeLessThan(3);
		void app;
	});
});
