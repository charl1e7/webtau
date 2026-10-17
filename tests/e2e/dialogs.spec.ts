import { expect, test } from './fixtures';

const DIALOGS = ['settings', 'about', 'shortcuts', 'tempo', 'lyrics'] as const;
const FOOTER: Record<string, string | undefined> = {
	settings: 'Done',
	lyrics: 'Cancel',
	tempo: 'Cancel'
};

test.describe('dialogs and menus can always be closed', () => {
	for (const name of DIALOGS) {
		test(`${name}: X button, footer button, backdrop and Escape`, async ({ app, page }) => {
			const open = () => app.eval((w, n) => w.ui.openDialog(n), name);
			const closed = () => expect.poll(() => app.eval((w) => w.ui.dialog)).toBeNull();

			await open();
			await app.press(page.getByRole('button', { name: 'Close' }).last());
			await closed();

			if (FOOTER[name]) {
				await open();
				await app.press(page.getByRole('button', { name: FOOTER[name], exact: true }));
				await closed();
			}

			await open();
			await (app.isMobile ? page.touchscreen.tap(4, 4) : page.mouse.click(4, 4));
			await closed();

			await open();
			await page.keyboard.press('Escape');
			await closed();
		});
	}

	test('the main menu closes when the piano roll is touched, and opens Settings', async ({
		app,
		page
	}) => {
		const opener = app.isMobile
			? page.getByRole('button', { name: 'Menu' })
			: page.getByRole('button', { name: 'File' });
		await app.press(opener);
		await expect(page.getByRole('menu')).toBeVisible();
		const box = (await page.locator('canvas').boundingBox())!;
		await (app.isMobile
			? page.touchscreen.tap(box.x + 150, box.y + 200)
			: page.mouse.click(box.x + 300, box.y + 300));
		await expect(page.getByRole('menu')).toHaveCount(0);

		if (app.isMobile) {
			await app.press(opener);
			await app.press(page.getByRole('menuitem', { name: /Settings/ }));
		} else {
			await app.press(page.getByRole('button', { name: 'Settings' }));
		}
		await app.press(page.getByRole('button', { name: 'Done' }));
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('the side sheets of the phone layout close on the backdrop', async ({ app, page }) => {
		test.skip(!app.isMobile, 'phone layout only');
		await app.press(page.getByRole('button', { name: 'Voicebank' }));
		await expect(page.getByRole('dialog', { name: 'Voicebank' })).toBeVisible();
		await page.touchscreen.tap(190, 60);
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await app.press(page.getByRole('button', { name: 'Note properties' }));
		await app.press(page.getByRole('button', { name: 'Close' }));
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
});
