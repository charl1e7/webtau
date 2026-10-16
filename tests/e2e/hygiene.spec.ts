import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/** Generic UI checks that catch whole classes of small bugs on every layout. */

async function accessibleProblems(page: Page) {
	return page.evaluate(() => {
		const visible = (el: Element) => {
			const r = el.getBoundingClientRect();
			const s = getComputedStyle(el);
			return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
		};
		const name = (el: Element) =>
			(
				el.getAttribute('aria-label') ||
				el.getAttribute('title') ||
				(el as HTMLElement).innerText ||
				''
			).trim() ||
			(el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
			el.closest('label')?.textContent?.trim() ||
			'';
		const bad: string[] = [];
		for (const el of document.querySelectorAll(
			'button, input:not([type=hidden]), select, textarea, [role=button]'
		)) {
			if (!visible(el) || (el as HTMLElement).hidden) continue;
			if (!name(el) && !el.getAttribute('aria-labelledby')) bad.push(el.outerHTML.slice(0, 120));
		}
		return bad;
	});
}

test.describe('layout and accessibility hygiene', () => {
	test('every visible control has an accessible name', async ({ app, page }) => {
		expect(await accessibleProblems(page)).toEqual([]);
		if (app.isMobile) {
			await app.press(page.getByRole('button', { name: 'Note properties' }));
			expect(await accessibleProblems(page)).toEqual([]);
		}
	});

	test('the page never scrolls sideways', async ({ page }) => {
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test('toolbar and top bar buttons are fully inside the viewport', async ({ page }) => {
		const clipped = await page.evaluate(() => {
			const out: string[] = [];
			for (const el of document.querySelectorAll(
				'header button, [role=toolbar] button, [role=toolbar] select'
			)) {
				const r = el.getBoundingClientRect();
				if (r.width === 0) continue;
				if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
					out.push(
						`${el.getAttribute('aria-label') ?? el.textContent?.trim()} (${Math.round(r.left)}..${Math.round(r.right)})`
					);
				}
			}
			return out;
		});
		expect(clipped).toEqual([]);
	});

	test('touch targets are big enough on touch screens', async ({ app, page }) => {
		test.skip(!app.isMobile, 'touch layout');
		await app.press(page.getByRole('button', { name: 'Note properties' }));
		const small = await page.evaluate(() => {
			const out: string[] = [];
			for (const el of document.querySelectorAll('button, [role=menuitem], select')) {
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) continue;
				if (r.height < 34 || r.width < 30) {
					out.push(
						`${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`
					);
				}
			}
			return out;
		});
		expect(small).toEqual([]);
	});

	test('app boots without errors and shows the empty-state hint', async ({ app, page }) => {
		void app;
		await expect(page.getByText(/pencil/).first()).toBeVisible();
	});
});
