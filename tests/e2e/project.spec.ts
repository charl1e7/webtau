import { expect, test, type App } from './fixtures';
import type { Page } from '@playwright/test';

/** Opens a File-menu entry on both layouts. */
async function fileMenu(app: App, page: Page, item: string | RegExp) {
	if (app.isMobile) {
		await app.press(page.getByRole('button', { name: 'Menu' }));
		await app.press(page.getByRole('menuitem', { name: 'File' }));
	} else {
		await page.getByRole('button', { name: 'File' }).click();
	}
	await app.press(page.getByRole('menuitem', { name: item }));
}

const UST = `[#VERSION]
UST Version1.2
[#SETTING]
Tempo=140.00
ProjectName=Sample
VoiceDir=%VOICE%Teto
[#0000]
Length=480
Lyric=ka
NoteNum=60
[#0001]
Length=480
Lyric=sa
NoteNum=62
PBS=-30;0
PBW=30,60
PBY=2,0
[#TRACKEND]
`;

test.describe('importing and exporting', () => {
	test('import UST through the file picker', async ({ app, page }) => {
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			fileMenu(app, page, /^Import UST…/)
		]);
		await chooser.setFiles({ name: 'song.ust', mimeType: 'text/plain', buffer: Buffer.from(UST) });
		await expect.poll(() => app.notes).toHaveLength(2);
		expect(await app.eval((w) => w.project.tempos[0].bpm)).toBe(140);
		expect(await app.eval((w) => w.project.notes[1].pitchPoints.length)).toBe(3);
	});

	test('export UST / MIDI / project produce downloads that import back', async ({ app, page }) => {
		await app.setNotes([
			{ tick: 0, pitch: 60, lyric: 'ka' },
			{ tick: 480, pitch: 64, lyric: 'sa' }
		]);

		const [ust] = await Promise.all([
			page.waitForEvent('download'),
			fileMenu(app, page, /^Export UST$/)
		]);
		const ustText = await (await import('node:fs/promises')).readFile((await ust.path())!, 'utf8');
		expect(ustText).toContain('Lyric=ka');
		expect(ustText).toContain('[#TRACKEND]');

		const [mid] = await Promise.all([
			page.waitForEvent('download'),
			fileMenu(app, page, 'Export MIDI')
		]);
		const midBytes = await (await import('node:fs/promises')).readFile((await mid.path())!);
		expect(midBytes.subarray(0, 4).toString()).toBe('MThd');

		const [proj] = await Promise.all([
			page.waitForEvent('download'),
			fileMenu(app, page, 'Save project')
		]);
		const projPath = (await proj.path())!;
		await app.setNotes([]);
		expect(await app.notes).toHaveLength(0);
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			fileMenu(app, page, 'Open project')
		]);
		await chooser.setFiles(projPath);
		await expect.poll(() => app.notes).toHaveLength(2);
	});

	test('VSQX import creates one project track per VOCALOID track', async ({ app }) => {
		await app.eval(async (w) => {
			await w.file.applyVsqx(
				`<vsq4><masterTrack><resolution>480</resolution><preMeasure>0</preMeasure><tempo><posTick>0</posTick><bpm>10000</bpm></tempo></masterTrack>
				<vsTrack><name>A</name><musicalPart><posTick>0</posTick><note><posTick>0</posTick><durTick>480</durTick><noteNum>60</noteNum><lyric><![CDATA[ka]]></lyric></note></musicalPart></vsTrack>
				<vsTrack><name>B</name><musicalPart><posTick>0</posTick><note><posTick>480</posTick><durTick>480</durTick><noteNum>62</noteNum><lyric><![CDATA[sa]]></lyric></note></musicalPart></vsTrack></vsq4>`,
				'x.vsqx'
			);
		});
		expect(
			await app.eval((w) => w.project.tracks.map((t: { name: string }) => t.name).join())
		).toBe('A,B');
		expect(await app.notes).toHaveLength(2);
	});
});

test.describe('tracks and tempo', () => {
	test('the track menu switches, adds and mutes tracks', async ({ app, page }) => {
		test.skip(app.isMobile, 'toolbar chip is on the desktop layout; the phone uses the main menu');
		await app.setNotes([{ tick: 0, pitch: 60 }]);
		await page.locator('.track-chip').click();
		await page.getByRole('menuitem', { name: 'Add track' }).click();
		expect(await app.eval((w) => w.project.tracks.length)).toBe(2);
		await page.locator('.track-chip').click();
		await page.getByRole('menuitem', { name: 'Mute active track' }).click();
		expect(await app.eval((w) => w.project.tracks[1].mute)).toBe(true);
	});

	test('the inspector lists tracks with mute / solo controls (works on a phone too)', async ({
		app,
		page
	}) => {
		if (app.isMobile) await app.press(page.getByRole('button', { name: 'Note properties' }));
		await app.press(page.getByRole('button', { name: 'Add track' }));
		await app.press(page.getByRole('button', { name: 'Mute Track 2' }));
		expect(await app.eval((w) => w.project.tracks[1].mute)).toBe(true);
		await app.press(page.getByRole('button', { name: 'Solo Track 1' }));
		expect(await app.eval((w) => w.project.tracks[0].solo)).toBe(true);
	});

	test('tempo dialog adds a tempo change; markers are draggable', async ({ app, page }) => {
		test.skip(app.isMobile, 'ruler dragging with a mouse');
		await app.setNotes([{ tick: 0, pitch: 60 }]);
		const g = await app.geo();
		const x = g.left + (await app.eval((w) => w.roll.current.xAtTick(1920)));
		await page.mouse.dblclick(x + 5, g.top + 24);
		await expect(page.getByRole('dialog', { name: 'Tempo change' })).toBeVisible();
		await page.locator('#t-bpm').fill('90');
		await page.getByRole('button', { name: 'Apply' }).click();
		expect(await app.eval((w) => w.project.tempos.map((t: { bpm: number }) => t.bpm))).toEqual([
			120, 90
		]);

		await app.settle();
		const tick = await app.eval((w) => w.project.tempos[1].tick);
		const mx = g.left + (await app.eval((w) => w.roll.current.xAtTick(w.project.tempos[1].tick)));
		await page.mouse.move(mx + 10, g.top + 9);
		await page.mouse.down();
		await page.mouse.move(mx + 130, g.top + 9, { steps: 6 });
		await page.mouse.up();
		expect(await app.eval((w) => w.project.tempos[1].tick)).toBeGreaterThan(tick);
		await page.keyboard.press('Control+z');
		expect(await app.eval((w) => w.project.tempos[1].tick)).toBe(tick);
	});

	test('the track pitch curve is baked into the UST and survives save / open', async ({
		app,
		page
	}) => {
		await app.setNotes([{ tick: 0, length: 960, pitch: 60, lyric: 'ka' }]);
		await app.eval((w) =>
			w.project.setPitchCurve(w.project.tracks[0].id, [
				[
					{ tick: 100, pitch: 60 },
					{ tick: 500, pitch: 62 },
					{ tick: 900, pitch: 60 }
				]
			])
		);
		const [ust] = await Promise.all([
			page.waitForEvent('download'),
			fileMenu(app, page, /^Export UST$/)
		]);
		const text = await (await import('node:fs/promises')).readFile((await ust.path())!, 'utf8');
		const pby = /PBY=(.*)/.exec(text)?.[1].split(',').map(Number) ?? [];
		// 62 over a note on 60 is +200 cents = 20 in UST units (sampled every 10 ms).
		expect(Math.max(...pby)).toBeGreaterThan(19);
		expect(Math.max(...pby)).toBeLessThan(20.5);

		const [proj] = await Promise.all([
			page.waitForEvent('download'),
			fileMenu(app, page, 'Save project')
		]);
		const path = (await proj.path())!;
		await app.eval((w) => w.project.clearPitchCurve(w.project.tracks[0].id));
		page.once('dialog', (d) => void d.accept()); // "discard unsaved changes?"
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			fileMenu(app, page, 'Open project')
		]);
		await chooser.setFiles(path);
		await expect.poll(() => app.eval((w) => w.project.tracks[0].pitchCurve.flat().length)).toBe(3);
	});

	test('the autosave brings the curve back', async ({ app, page }) => {
		await app.setNotes([{ tick: 0, length: 960, pitch: 60 }]);
		await app.eval((w) =>
			w.project.setPitchCurve(w.project.tracks[0].id, [
				[
					{ tick: 100, pitch: 61 },
					{ tick: 800, pitch: 62 }
				]
			])
		);
		await page.waitForTimeout(1600);
		await app.eval((w) => w.project.reset());
		expect(await app.eval((w) => w.project.tracks[0].pitchCurve.length)).toBe(0);
		expect(await app.eval((w) => w.project.restoreAutosave())).toBe(true);
		expect(await app.eval((w) => w.project.tracks[0].pitchCurve.flat().length)).toBe(2);
	});

	test('import USTX through the picker, drop it, and export it back for OpenUtau', async ({
		app,
		page
	}) => {
		const USTX = `name: Demo
ustx_version: "0.6"
tempos:
- position: 0
  bpm: 130
time_signatures:
- bar_position: 0
  beat_per_bar: 4
  beat_unit: 4
tracks:
- track_name: Lead
  track_color: Blue
  singer: Test Bank
- track_name: Backing
  track_color: Pink
voice_parts:
- duration: 1920
  track_no: 0
  position: 0
  notes:
  - position: 0
    duration: 480
    tone: 60
    lyric: ka
    pitch:
      data:
      - {x: -25, y: 0, shape: io}
      - {x: 25, y: 0, shape: io}
      snap_first: true
    vibrato: {length: 0, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}
    phoneme_expressions:
    - {index: 0, abbr: vel, value: 110}
  - position: 480
    duration: 480
    tone: 62
    lyric: sa
    vibrato: {length: 40, period: 180, depth: 30, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}
  curves:
  - abbr: pitd
    xs: [-5, 0, 100, 105]
    ys: [0, 50, 50, 0]
- duration: 960
  track_no: 1
  position: 0
  notes:
  - {position: 0, duration: 960, tone: 55, lyric: a}
`;
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			fileMenu(app, page, /^Import USTX/)
		]);
		await chooser.setFiles({ name: 'demo.ustx', mimeType: 'text/yaml', buffer: Buffer.from(USTX) });
		await expect.poll(() => app.notes).toHaveLength(3);
		expect(await app.eval((w) => w.project.tempos[0].bpm)).toBe(130);
		expect(await app.eval((w) => w.project.tracks.map((t) => t.name))).toEqual(['Lead', 'Backing']);
		expect(
			await app.eval(
				(w) => w.project.notes.filter((n) => n.track === w.project.tracks[0].id)[0].velocity
			)
		).toBe(110);
		expect(await app.eval((w) => w.project.tracks[0].pitchCurve.length)).toBeGreaterThan(0);
		expect(await app.eval((w) => w.project.voicebankName)).toBe('Test Bank');

		const [down] = await Promise.all([
			page.waitForEvent('download'),
			fileMenu(app, page, /^Export USTX/)
		]);
		expect(down.suggestedFilename()).toMatch(/\.ustx$/);
		const text = await (await import('node:fs/promises')).readFile((await down.path())!, 'utf8');
		expect(text).toContain('ustx_version: "0.6"');
		expect(text).toContain('track_name: Backing');
		expect(text).toContain('abbr: pitd');
		expect(text).toContain('lyric: sa');

		// And the export opens again.
		await app.eval((w) => w.project.reset());
		const [again] = await Promise.all([
			page.waitForEvent('filechooser'),
			fileMenu(app, page, /^Import USTX/)
		]);
		await again.setFiles({ name: 'back.ustx', mimeType: 'text/yaml', buffer: Buffer.from(text) });
		await expect.poll(() => app.notes).toHaveLength(3);
		expect(await app.eval((w) => w.project.tracks[0].pitchCurve.length)).toBeGreaterThan(0);
	});

	test('a dropped .ustx file opens', async ({ app, page }) => {
		test.skip(app.isMobile, 'drag and drop');
		const text = `name: Dropped
tracks:
- track_name: T
voice_parts:
- track_no: 0
  position: 0
  notes:
  - {position: 0, duration: 480, tone: 67, lyric: ka}
`;
		const data = await page.evaluateHandle((t) => {
			const dt = new DataTransfer();
			dt.items.add(new File([t], 'dropped.ustx', { type: 'text/yaml' }));
			return dt;
		}, text);
		await page.dispatchEvent('body', 'drop', { dataTransfer: data });
		await expect.poll(() => app.notes).toHaveLength(1);
		expect((await app.notes)[0].pitch).toBe(67);
	});
});
