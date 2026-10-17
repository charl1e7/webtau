import { expect, test } from './fixtures';

/** Geometry checks: things that stick out, overlap or are too small to hit. */

test.describe('top bar geometry', () => {
	test('everything in the top bar stays inside it (no pill taller than the bar)', async ({
		app,
		page
	}) => {
		void app;
		const problems = await page.evaluate(() => {
			const bar = document.querySelector('header.topbar')!.getBoundingClientRect();
			const bad: string[] = [];
			for (const el of document.querySelectorAll('header.topbar *')) {
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) continue;
				if (getComputedStyle(el).position === 'absolute') continue;
				if (r.top < bar.top - 0.5 || r.bottom > bar.bottom + 0.5) {
					const label = el.getAttribute('aria-label') ?? el.className ?? el.tagName;
					bad.push(
						`${label}: ${r.top.toFixed(1)}..${r.bottom.toFixed(1)} vs bar ${bar.top}..${bar.bottom}`
					);
				}
			}
			return bad;
		});
		expect(problems).toEqual([]);
	});

	test('the transport pill is centred and leaves room on both sides', async ({ app, page }) => {
		void app;
		const m = await page.evaluate(() => {
			const bar = document.querySelector('header.topbar')!.getBoundingClientRect();
			const pill = document.querySelector('.transport')!.getBoundingClientRect();
			const left = document.querySelector('header.topbar .left')!.getBoundingClientRect();
			const right = document.querySelector('header.topbar .right')!.getBoundingClientRect();
			return { bar: bar.width, pill, left, right };
		});
		expect(m.pill.left).toBeGreaterThanOrEqual(m.left.right - 0.5);
		expect(m.pill.right).toBeLessThanOrEqual(m.right.left + 0.5);
		expect(m.pill.left).toBeGreaterThanOrEqual(0);
		expect(m.pill.right).toBeLessThanOrEqual(m.bar + 0.5);
	});
});

test.describe('roll toolbar', () => {
	test('tool buttons are hit-sized and none is hidden under another control', async ({
		app,
		page
	}) => {
		const tools = await page.evaluate(() =>
			[...document.querySelectorAll('[role=toolbar] button')].map((b) => {
				const r = b.getBoundingClientRect();
				return { name: b.getAttribute('aria-label'), w: r.width, h: r.height };
			})
		);
		expect(tools.length).toBeGreaterThanOrEqual(6);
		const min = app.isMobile ? 36 : 30;
		for (const t of tools) {
			expect(t.w, t.name ?? '').toBeGreaterThanOrEqual(min);
			expect(t.h, t.name ?? '').toBeGreaterThanOrEqual(min);
		}
	});

	test('the four tools are reachable and switch with their shortcuts', async ({ app, page }) => {
		test.skip(app.isMobile, 'keyboard shortcuts');
		for (const [key, tool] of [
			['b', 'draw'],
			['p', 'pitch'],
			['e', 'erase'],
			['v', 'select']
		] as const) {
			await page.keyboard.press(key);
			expect(await app.eval((w) => w.view.tool)).toBe(tool);
		}
	});
});

test.describe('flyouts and menus close in every way', () => {
	test('the pitch flyout closes with Escape and with a tap outside', async ({ app, page }) => {
		const button = page.getByRole('button', { name: 'Pitch curve', exact: true });
		const box = (await button.boundingBox())!;
		const open = async () => {
			if (app.isMobile) {
				await page.touchscreen.tap(0, 0); // make sure nothing is pending
				await page.evaluate(
					([x, y]) => {
						const el = document.elementFromPoint(x, y)!;
						el.dispatchEvent(
							new MouseEvent('contextmenu', {
								bubbles: true,
								cancelable: true,
								clientX: x,
								clientY: y
							})
						);
					},
					[box.x + box.width / 2, box.y + box.height / 2]
				);
			} else {
				await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
			}
			await expect(page.getByRole('menu')).toBeVisible();
		};
		await open();
		if (!app.isMobile) {
			await page.keyboard.press('Escape');
			await expect(page.getByRole('menu')).toHaveCount(0);
			await open();
		}
		// Tap on the piano roll, away from the menu.
		const roll = (await page.locator('#piano-roll').boundingBox())!;
		const at = { x: roll.x + roll.width / 2, y: roll.y + roll.height / 2 };
		if (app.isMobile) await page.touchscreen.tap(at.x, at.y);
		else await page.mouse.click(at.x, at.y);
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('a plain tap on a flyout button only selects the tool', async ({ app, page }) => {
		await app.press(page.getByRole('button', { name: 'Eraser', exact: true }));
		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await app.eval((w) => w.view.tool)).toBe('erase');
		await app.press(page.getByRole('button', { name: 'Pitch curve', exact: true }));
		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await app.eval((w) => w.view.tool)).toBe('pitch');
	});
});
