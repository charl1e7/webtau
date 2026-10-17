import type { Page } from '@playwright/test';
import { expect, test, type App } from './fixtures';

/** Opens Edit ▸ Lyric tools ▸ item on both layouts. */
async function lyricTool(app: App, page: Page, item: string) {
	if (app.isMobile) {
		await app.press(page.getByRole('button', { name: 'Menu' }));
		await app.press(page.getByRole('menuitem', { name: 'Edit', exact: true }));
	} else {
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
	}
	await app.press(page.getByRole('menuitem', { name: 'Lyric tools', exact: true }));
	await app.press(page.getByRole('menuitem', { name: item, exact: true }));
}

const lyricsOf = (app: App) => app.eval((w) => w.project.notes.map((n) => n.lyric));
const resolution = (app: App, index: number) =>
	app.eval((w, i) => {
		const n = w.project.notes[i];
		const r = w.lyrics.resolutionOf(n.id);
		return r ? { status: r.status, alias: r.alias } : null;
	}, index);

test.describe('lyrics: scripts, special signs, plugins', () => {
	test.beforeEach(async ({ app }) => {
		await app.loadVoicebank(); // romaji aliases: a i u e o, ka ki ku ke ko, sa …, ta …, ma …
	});

	test('kana lyrics find the romaji alias and are not flagged', async ({ app }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'か' },
			{ tick: 480, pitch: 62, lyric: 'ミ' },
			{ tick: 960, pitch: 64, lyric: 'zzz' }
		]);
		expect(await resolution(app, 0)).toEqual({ status: 'mapped', alias: 'ka' });
		expect(await resolution(app, 1)).toEqual({ status: 'mapped', alias: 'mi' });
		expect((await resolution(app, 2))?.status).toBe('missing');
		// Only the real miss is marked.
		expect(await app.eval((w) => [...w.lyrics.missing].length)).toBe(1);
	});

	test('the engine gets the resolved alias: a kana lyric renders audibly', async ({ app }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'か' },
			{ tick: 480, pitch: 62, lyric: 'さ' }
		]);
		await app.eval((w) => w.playback.render());
		expect(await app.eval((w) => w.playback.status)).toBe('ready');
		expect(await app.eval((w) => w.playback.unknownLyrics.size)).toBe(0);
		const peak = await app.eval((w) => {
			let m = 0;
			for (const v of w.playback.buffer.getChannelData(0)) m = Math.max(m, Math.abs(v));
			return m;
		});
		expect(peak).toBeGreaterThan(0.05);
	});

	test('rests, continuations and hints', async ({ app }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'ka' },
			{ tick: 480, pitch: 60, lyric: '+' },
			{ tick: 960, pitch: 60, lyric: 'R' },
			{ tick: 1440, pitch: 60, lyric: 'nonsense[mi]' }
		]);
		expect(await resolution(app, 1)).toEqual({ status: 'mapped', alias: 'ka' });
		expect((await resolution(app, 2))?.status).toBe('rest');
		expect(await resolution(app, 3)).toEqual({ status: 'exact', alias: 'mi' });
		expect(await app.eval((w) => [...w.lyrics.missing].length)).toBe(0);
	});

	test('the lyric box suggests across scripts and shows the reading', async ({ app, page }) => {
		await app.setNotes([{ tick: 480, length: 960, pitch: 62, lyric: 'a' }]);
		await app.eval((w) => {
			w.ui.requestLyricEdit = w.project.notes[0].id;
		});
		const list = page.getByRole('listbox');
		await expect(list).toBeVisible();
		const box = page.getByRole('textbox', { name: 'Lyric' }).first();
		await box.fill('か');
		await expect(list.getByRole('option', { name: 'ka', exact: true })).toBeVisible();
		await box.fill('ka');
		const option = list.getByRole('option', { name: 'ka', exact: true });
		await expect(option).toContainText('か');
		await app.press(option);
		expect(await lyricsOf(app)).toEqual(['ka']);
	});

	test('the inspector says how a lyric is sung and offers the fix', async ({ app, page }) => {
		test.skip(app.isMobile, 'inspector is a sheet on phones');
		await app.setNotes([{ tick: 0, pitch: 60, lyric: 'か' }]);
		await app.eval((w) => w.project.select([w.project.notes[0].id]));
		await expect(page.getByText('Sung as “ka”.')).toBeVisible();
		await app.eval((w) => w.project.updateNote(w.project.notes[0].id, { lyric: 'kaa' }));
		await expect(page.getByText('Not found in the voicebank.')).toBeVisible();
		await page
			.getByLabel('Properties', { exact: true })
			.getByRole('button', { name: 'ka', exact: true })
			.click();
		expect(await lyricsOf(app)).toEqual(['ka']);
	});

	test('the lyric tools convert scripts and rewrite lyrics as aliases', async ({ app, page }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'か' },
			{ tick: 480, pitch: 62, lyric: 'sa' },
			{ tick: 960, pitch: 64, lyric: 'R' }
		]);
		await lyricTool(app, page, 'Lyrics → romaji');
		expect(await lyricsOf(app)).toEqual(['ka', 'sa', 'R']);
		await lyricTool(app, page, 'Lyrics → katakana');
		expect(await lyricsOf(app)).toEqual(['カ', 'サ', 'R']);
		await lyricTool(app, page, 'Rewrite lyrics as voicebank aliases');
		expect(await lyricsOf(app)).toEqual(['ka', 'sa', 'R']);
		await app.eval((w) => w.edit.undo());
		expect(await lyricsOf(app)).toEqual(['カ', 'サ', 'R']);
	});

	test('switching the Japanese plugin off in Settings stops the bridge', async ({ app, page }) => {
		await app.setNotes([{ tick: 0, pitch: 60, lyric: 'か' }]);
		expect((await resolution(app, 0))?.status).toBe('mapped');
		await app.eval((w) => w.ui.openDialog('settings'));
		await page.getByRole('checkbox', { name: /Japanese: kana/ }).uncheck();
		expect((await resolution(app, 0))?.status).toBe('missing');
		expect(await app.eval((w) => w.settings.data.disabledPlugins)).toContain('ja.script-bridge');
		await page.getByRole('checkbox', { name: /Japanese: kana/ }).check();
		expect((await resolution(app, 0))?.status).toBe('mapped');
	});

	test('importing a UST with unknown syllables opens the doctor with near matches', async ({
		app,
		page
	}) => {
		const ust = `[#VERSION]
UST Version1.2
[#SETTING]
Tempo=120.00
[#0000]
Length=480
Lyric=kaa
NoteNum=60
[#0001]
Length=480
Lyric=kaa
NoteNum=62
[#0002]
Length=480
Lyric=sha
NoteNum=64
[#0003]
Length=480
Lyric=ka
NoteNum=65
[#TRACKEND]
`;
		if (app.isMobile) {
			await app.press(page.getByRole('button', { name: 'Menu' }));
			await app.press(page.getByRole('menuitem', { name: 'File', exact: true }));
		} else {
			await page.getByRole('button', { name: 'File', exact: true }).click();
		}
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			app.press(page.getByRole('menuitem', { name: /^Import UST…/ }))
		]);
		await chooser.setFiles({ name: 'x.ust', mimeType: 'text/plain', buffer: Buffer.from(ust) });

		const dialog = page.getByRole('dialog', { name: 'Fix lyrics' });
		await expect(dialog).toBeVisible();
		// "kaa" is used twice, "sha" is the unknown Hepburn spelling; both get a near match, "ka" is fine.
		await expect(dialog.getByRole('combobox', { name: 'Replacement for kaa' })).toHaveValue('ka');
		await expect(dialog.getByRole('combobox', { name: 'Replacement for sha' })).toHaveValue('sa');
		await app.press(dialog.getByRole('button', { name: /^Replace 2 lyric/ }));
		await expect(dialog).toHaveCount(0);
		expect(await lyricsOf(app)).toEqual(['ka', 'ka', 'sa', 'ka']);
		await app.eval((w) => w.edit.undo());
		expect(await lyricsOf(app)).toEqual(['kaa', 'kaa', 'sha', 'ka']);
	});

	test('skipping the doctor leaves lyrics alone and the doctor can be turned off', async ({
		app
	}) => {
		await app.setNotes([{ tick: 0, pitch: 60, lyric: 'kaa' }]);
		await app.eval((w) => (w.settings.data.lyricDoctor = false));
		await app.eval((w) => w.lyrics.offerFix());
		expect(await app.eval((w) => w.ui.dialog)).toBeNull();
		await app.eval((w) => (w.settings.data.lyricDoctor = true));
		await app.eval((w) => w.lyrics.offerFix());
		expect(await app.eval((w) => w.ui.dialog)).toBe('lyric-doctor');
	});
});
