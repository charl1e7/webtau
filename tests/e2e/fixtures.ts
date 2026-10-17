/* eslint-disable @typescript-eslint/no-explicit-any */
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { VOICEBANK_ZIP } from './global-setup';

export { expect };

// The debug handle is deliberately loosely typed: tests poke at internals.
type WebTau = any;

/** Convenience wrapper around the running app (opened with `?debug`). */
export class App {
	constructor(
		readonly page: Page,
		readonly isMobile: boolean
	) {}

	async open() {
		await this.page.goto('/?debug&fresh');
		await this.page.waitForSelector('canvas');
	}

	/** Runs `fn` in the page with the `window.webtau` debug handle. */
	eval<R, A = undefined>(fn: (w: WebTau, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
		return this.page.evaluate(
			([src, a]) => new Function('w', 'a', `return (${src})(w, a)`)((window as any).webtau, a),
			[fn.toString(), arg] as const
		) as Promise<R>;
	}

	async loadVoicebank() {
		// On a phone the voicebank panel lives in a sheet.
		if (this.isMobile) await this.page.getByRole('button', { name: 'Voicebank' }).tap();
		await this.page.setInputFiles('input[type=file][accept*=zip]', VOICEBANK_ZIP);
		await this.page.waitForFunction(() => (window as any).webtau.voicebank.current);
		if (this.isMobile) {
			await this.page.touchscreen.tap(190, 60);
			await this.page.getByRole('dialog').waitFor({ state: 'detached' });
		}
	}

	/** Replaces the project with the given notes. */
	async setNotes(notes: { tick: number; length?: number; pitch: number; lyric?: string }[]) {
		await this.eval((w, list) => {
			w.project.load({ name: 'Test', notes: [] });
			for (const n of list) w.project.addNote({ length: 480, lyric: 'a', ...n });
			w.project.clearSelection();
		}, notes);
	}

	get notes() {
		return this.eval((w) =>
			w.project.notes.map((n) => ({
				tick: n.tick,
				length: n.length,
				pitch: n.pitch,
				lyric: n.lyric
			}))
		);
	}

	/** Canvas geometry in page coordinates. */
	async geo() {
		return this.eval((w) => {
			const r = w.roll.current;
			const b = r.canvas.getBoundingClientRect();
			return {
				left: b.left,
				top: b.top,
				width: b.width,
				height: b.height,
				keysW: r.keysW,
				ppt: r.ppt,
				keyH: r.keyH,
				scrollX: r.scrollX,
				scrollY: r.scrollY,
				row60: r.rowTop(60),
				x0: r.xAtTick(0)
			};
		});
	}

	/** Page x of a tick, page y of the centre of a pitch row. */
	async point(tick: number, pitch: number) {
		const g = await this.geo();
		return {
			x: g.left + g.x0 + tick * g.ppt,
			y: g.top + g.row60 + (60 - pitch) * g.keyH + g.keyH / 2
		};
	}

	async selectTool(name: 'Select / move' | 'Draw notes' | 'Pitch curve' | 'Eraser') {
		const b = this.page.getByRole('button', { name, exact: true });
		await (this.isMobile ? b.tap() : b.click());
	}

	/** Click/tap respecting the device type. */
	async press(target: Locator) {
		await (this.isMobile ? target.tap() : target.click());
	}

	/** Waits out the double-tap window so consecutive gestures are independent. */
	settle(ms = 400) {
		return this.page.waitForTimeout(ms);
	}
}

/** Raw touch input through CDP (Chromium only). */
export class Touch {
	constructor(
		private readonly cdp: Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>,
		private readonly page: Page
	) {}

	private send(type: string, pts: { x: number; y: number }[]) {
		return this.cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i }))
		});
	}

	async tap(x: number, y: number) {
		await this.send('touchStart', [{ x, y }]);
		await this.page.waitForTimeout(40);
		await this.send('touchEnd', []);
	}

	async drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
		await this.send('touchStart', [from]);
		for (let i = 1; i <= steps; i++) {
			await this.send('touchMove', [
				{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }
			]);
			await this.page.waitForTimeout(16);
		}
		await this.send('touchEnd', []);
	}

	async hold(at: { x: number; y: number }, ms: number) {
		await this.send('touchStart', [at]);
		await this.page.waitForTimeout(ms);
		await this.send('touchEnd', []);
	}

	async pinch(center: { x: number; y: number }, from: number, to: number) {
		const pts = (d: number) => [
			{ x: center.x - d / 2, y: center.y },
			{ x: center.x + d / 2, y: center.y }
		];
		await this.send('touchStart', pts(from));
		for (let i = 1; i <= 8; i++) {
			await this.send('touchMove', pts(from + ((to - from) * i) / 8));
			await this.page.waitForTimeout(16);
		}
		await this.send('touchEnd', []);
	}
}

export const test = base.extend<{ app: App; touch: Touch }>({
	// Every test fails on uncaught exceptions and console errors: that alone
	// would have caught handlers that throw (e.g. a lost `this`).
	app: async ({ page, isMobile }, use) => {
		const problems: string[] = [];
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
		page.on('console', (m) => {
			if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()))
				problems.push(`console.error: ${m.text()}`);
		});
		const app = new App(page, isMobile);
		await app.open();
		await use(app);
		expect(problems, 'the page must not throw or log errors').toEqual([]);
	},
	touch: async ({ page, context }, use) => {
		await use(new Touch(await context.newCDPSession(page), page));
	}
});
