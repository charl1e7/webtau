import { MAX_PITCH, MIN_PITCH, type Note, type TempoChange } from '#lib/core/types';
import { compilePitch } from '#lib/core/pitch';
import { isBlackKey, noteName } from '#lib/core/music';
import type { TempoMap } from '#lib/core/tempo';
import type { Tool } from '#lib/state/view.svelte';

export interface Theme {
	bg: string;
	rowWhite: string;
	rowBlack: string;
	rowC: string;
	lineMeasure: string;
	lineBeat: string;
	lineSub: string;
	keyWhite: string;
	keyBlack: string;
	keyText: string;
	note: string;
	noteEdge: string;
	noteSelected: string;
	noteText: string;
	pitch: string;
	playhead: string;
	error: string;
	accent: string;
	panel: string;
	border: string;
	muted: string;
	font: string;
}

export function readTheme(el: Element): Theme {
	const css = getComputedStyle(el);
	const v = (name: string) => css.getPropertyValue(name).trim();
	return {
		bg: v('--roll-bg'),
		rowWhite: v('--roll-row-white'),
		rowBlack: v('--roll-row-black'),
		rowC: v('--roll-row-c'),
		lineMeasure: v('--roll-line-measure'),
		lineBeat: v('--roll-line-beat'),
		lineSub: v('--roll-line-sub'),
		keyWhite: v('--roll-key-white'),
		keyBlack: v('--roll-key-black'),
		keyText: v('--roll-key-text'),
		note: v('--roll-note'),
		noteEdge: v('--roll-note-edge'),
		noteSelected: v('--roll-note-selected'),
		noteText: v('--roll-note-text'),
		pitch: v('--roll-pitch'),
		playhead: v('--roll-playhead'),
		error: v('--roll-error'),
		accent: v('--accent'),
		panel: v('--panel-2'),
		border: v('--border'),
		muted: v('--muted'),
		font: v('--font')
	};
}

export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface Frame {
	w: number;
	h: number;
	dpr: number;
	keysW: number;
	rulerH: number;
	scrollX: number;
	scrollY: number;
	ppt: number;
	keyH: number;
	notes: readonly Note[];
	selection: ReadonlySet<string>;
	playTick: number | null;
	tempoMap: TempoMap;
	tempos: readonly TempoChange[];
	measureTicks: number;
	beatTicks: number;
	gridTicks: number;
	showNames: boolean;
	unknown: ReadonlySet<string>;
	hoverId: string | null;
	tool: Tool;
	touch: boolean;
	selectedPoint: { noteId: string; pointId: string } | null;
	rubber: Rect | null;
	guideTick: number | null;
	editingLyricId: string | null;
	theme: Theme;
}

const pitchCache = new WeakMap<Note, { map: TempoMap; points: { x: number; y: number }[] }>();

/** Pitch contour of a note in (ms, cents), cached per note + tempo map. */
function contour(note: Note, map: TempoMap): { x: number; y: number }[] {
	const cached = pitchCache.get(note);
	if (cached && cached.map === map) return cached.points;
	const duration = map.tickToMs(note.tick + note.length) - map.tickToMs(note.tick);
	const raw = compilePitch(note, duration);
	const pts = raw.map((p) => ({ x: p.offset, y: p.value }));
	// The engine treats missing ends as "no deviation".
	if (pts.length) {
		if (pts[0].x > 0) pts.unshift({ x: 0, y: 0 });
		if (pts[pts.length - 1].x < duration) pts.push({ x: duration, y: 0 });
	}
	pitchCache.set(note, { map, points: pts });
	return pts;
}

export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame) {
	const { w, h, keysW, rulerH, theme: t } = f;
	ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = t.bg;
	ctx.fillRect(0, 0, w, h);

	drawRows(ctx, f);
	drawVerticalLines(ctx, f);
	drawNotes(ctx, f);
	drawPitch(ctx, f);
	drawGuide(ctx, f);
	drawPlayhead(ctx, f);
	drawRubber(ctx, f);
	drawKeys(ctx, f);
	drawRuler(ctx, f);

	// corner
	ctx.fillStyle = t.panel;
	ctx.fillRect(0, 0, keysW, rulerH);
	ctx.strokeStyle = t.border;
	ctx.beginPath();
	ctx.moveTo(keysW + 0.5, 0);
	ctx.lineTo(keysW + 0.5, h);
	ctx.moveTo(0, rulerH + 0.5);
	ctx.lineTo(w, rulerH + 0.5);
	ctx.stroke();
}

// ---- helpers (the geometry is duplicated from the controller on purpose: draw is pure) ----

const xAt = (f: Frame, tick: number) => f.keysW - f.scrollX + tick * f.ppt;
const rowTop = (f: Frame, pitch: number) => f.rulerH - f.scrollY + (MAX_PITCH - pitch) * f.keyH;

function visibleTicks(f: Frame): [number, number] {
	return [f.scrollX / f.ppt, (f.scrollX + f.w - f.keysW) / f.ppt];
}

function drawRows(ctx: CanvasRenderingContext2D, f: Frame) {
	const { theme: t } = f;
	ctx.save();
	ctx.beginPath();
	ctx.rect(f.keysW, f.rulerH, f.w - f.keysW, f.h - f.rulerH);
	ctx.clip();
	for (let p = MAX_PITCH; p >= MIN_PITCH; p--) {
		const y = rowTop(f, p);
		if (y > f.h || y + f.keyH < f.rulerH) continue;
		ctx.fillStyle = p % 12 === 0 ? t.rowC : isBlackKey(p) ? t.rowBlack : t.rowWhite;
		ctx.fillRect(f.keysW, y, f.w - f.keysW, f.keyH);
	}
	ctx.restore();
}

function drawVerticalLines(ctx: CanvasRenderingContext2D, f: Frame) {
	const { theme: t } = f;
	const [t0, t1] = visibleTicks(f);
	// Pick the finest subdivision whose lines are at least 7px apart.
	let step = f.gridTicks;
	while (step * f.ppt < 7 && step < f.measureTicks) step *= 2;
	const first = Math.floor(t0 / step) * step;

	ctx.save();
	ctx.beginPath();
	ctx.rect(f.keysW, f.rulerH, f.w - f.keysW, f.h - f.rulerH);
	ctx.clip();
	ctx.lineWidth = 1;
	for (let tick = first; tick <= t1; tick += step) {
		const x = Math.round(xAt(f, tick)) + 0.5;
		const isMeasure = tick % f.measureTicks === 0;
		const isBeat = tick % f.beatTicks === 0;
		ctx.strokeStyle = isMeasure ? t.lineMeasure : isBeat ? t.lineBeat : t.lineSub;
		ctx.beginPath();
		ctx.moveTo(x, f.rulerH);
		ctx.lineTo(x, f.h);
		ctx.stroke();
	}
	ctx.restore();
}

function noteBox(f: Frame, n: Note) {
	const x = xAt(f, n.tick);
	return { x, y: rowTop(f, n.pitch) + 1, w: Math.max(3, n.length * f.ppt), h: f.keyH - 2 };
}

function drawNotes(ctx: CanvasRenderingContext2D, f: Frame) {
	const { theme: t } = f;
	ctx.save();
	ctx.beginPath();
	ctx.rect(f.keysW, f.rulerH, f.w - f.keysW, f.h - f.rulerH);
	ctx.clip();
	const [t0, t1] = visibleTicks(f);
	const fontSize = Math.max(9, Math.min(14, f.keyH * 0.55));
	ctx.font = `600 ${fontSize}px ${t.font}`;
	ctx.textBaseline = 'middle';

	for (const n of f.notes) {
		if (n.tick > t1 || n.tick + n.length < t0) continue;
		const b = noteBox(f, n);
		if (b.y > f.h || b.y + b.h < f.rulerH) continue;
		const selected = f.selection.has(n.id);
		const isRest = n.lyric.toLowerCase() === 'r';

		ctx.globalAlpha = isRest ? 0.45 : 1;
		ctx.fillStyle = selected ? t.noteSelected : t.note;
		ctx.beginPath();
		ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(5, b.h / 3));
		ctx.fill();
		ctx.globalAlpha = 1;

		if (f.unknown.has(n.id)) {
			ctx.strokeStyle = t.error;
			ctx.lineWidth = 2;
			ctx.setLineDash([4, 3]);
		} else {
			ctx.strokeStyle = selected ? t.accent : t.noteEdge;
			ctx.lineWidth = selected ? 2 : 1;
			ctx.setLineDash([]);
		}
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.lineWidth = 1;

		if (f.hoverId === n.id && !selected) {
			ctx.fillStyle = 'rgba(255,255,255,0.12)';
			ctx.beginPath();
			ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(5, b.h / 3));
			ctx.fill();
		}

		if (b.w > 14 && n.id !== f.editingLyricId) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(b.x + 2, b.y, b.w - 4, b.h);
			ctx.clip();
			ctx.fillStyle = selected ? '#2a0f1a' : t.noteText;
			const label = f.showNames && b.w > 70 ? `${n.lyric}  ${noteName(n.pitch)}` : n.lyric;
			ctx.fillText(label, b.x + 6, b.y + b.h / 2 + 0.5);
			ctx.restore();
		}

		if (selected && b.w > 12) drawGrips(ctx, f, b);
	}
	ctx.restore();
}

function drawGrips(ctx: CanvasRenderingContext2D, f: Frame, b: { x: number; y: number; w: number; h: number }) {
	const { theme: t } = f;
	if (f.touch) {
		// Round, finger-sized handles on both ends.
		const r = Math.min(10, Math.max(7, f.keyH * 0.42));
		for (const cx of [b.x, b.x + b.w]) {
			ctx.beginPath();
			ctx.arc(cx, b.y + b.h / 2, r, 0, Math.PI * 2);
			ctx.fillStyle = t.noteText;
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = t.accent;
			ctx.stroke();
		}
		ctx.lineWidth = 1;
	} else {
		ctx.fillStyle = 'rgba(255,255,255,0.85)';
		const gh = Math.max(6, b.h - 8);
		ctx.fillRect(b.x + b.w - 4, b.y + (b.h - gh) / 2, 2, gh);
		ctx.fillRect(b.x + 2, b.y + (b.h - gh) / 2, 2, gh);
	}
}

function drawPitch(ctx: CanvasRenderingContext2D, f: Frame) {
	const { theme: t } = f;
	const [t0, t1] = visibleTicks(f);
	ctx.save();
	ctx.beginPath();
	ctx.rect(f.keysW, f.rulerH, f.w - f.keysW, f.h - f.rulerH);
	ctx.clip();
	const pitchTool = f.tool === 'pitch';

	for (const n of f.notes) {
		if (n.tick > t1 + 2000 || n.tick + n.length < t0 - 2000) continue;
		const hasCurve = n.pitchPoints.length > 0 || !!n.vibrato;
		const selected = f.selection.has(n.id);
		if (!hasCurve && !(pitchTool && selected)) continue;

		const startMs = f.tempoMap.tickToMs(n.tick);
		const cy = rowTop(f, n.pitch) + f.keyH / 2;
		const toX = (ms: number) => xAt(f, f.tempoMap.msToTick(startMs + ms));
		const toY = (cents: number) => cy - (cents / 100) * f.keyH;

		const pts = contour(n, f.tempoMap);
		if (pts.length) {
			ctx.beginPath();
			pts.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.y)) : ctx.moveTo(toX(p.x), toY(p.y))));
			ctx.strokeStyle = t.pitch;
			ctx.globalAlpha = selected || pitchTool ? 1 : 0.55;
			ctx.lineWidth = selected ? 2.5 : 1.8;
			ctx.stroke();
			ctx.globalAlpha = 1;
			ctx.lineWidth = 1;
		}

		if (pitchTool && selected) {
			// baseline
			ctx.strokeStyle = t.pitch;
			ctx.globalAlpha = 0.35;
			ctx.setLineDash([3, 4]);
			ctx.beginPath();
			ctx.moveTo(xAt(f, n.tick), cy);
			ctx.lineTo(xAt(f, n.tick + n.length), cy);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;

			const r = f.touch ? 8 : 5;
			for (const p of n.pitchPoints) {
				const px = toX(p.x);
				const py = toY(p.y);
				const active = f.selectedPoint?.pointId === p.id;
				ctx.beginPath();
				ctx.arc(px, py, active ? r + 2 : r, 0, Math.PI * 2);
				ctx.fillStyle = active ? t.accent : t.noteText;
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.strokeStyle = t.pitch;
				ctx.stroke();
				ctx.lineWidth = 1;
			}
		}
	}
	ctx.restore();
}

function drawGuide(ctx: CanvasRenderingContext2D, f: Frame) {
	if (f.guideTick === null) return;
	const x = Math.round(xAt(f, f.guideTick)) + 0.5;
	ctx.save();
	ctx.strokeStyle = f.theme.accent;
	ctx.globalAlpha = 0.8;
	ctx.setLineDash([5, 4]);
	ctx.beginPath();
	ctx.moveTo(x, f.rulerH);
	ctx.lineTo(x, f.h);
	ctx.stroke();
	ctx.restore();
}

function drawPlayhead(ctx: CanvasRenderingContext2D, f: Frame) {
	if (f.playTick === null) return;
	const x = Math.round(xAt(f, f.playTick)) + 0.5;
	if (x < f.keysW || x > f.w) return;
	ctx.save();
	ctx.strokeStyle = f.theme.playhead;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(x, 0);
	ctx.lineTo(x, f.h);
	ctx.stroke();
	ctx.restore();
}

function drawRubber(ctx: CanvasRenderingContext2D, f: Frame) {
	const r = f.rubber;
	if (!r) return;
	ctx.save();
	ctx.fillStyle = 'rgba(255,255,255,0.1)';
	ctx.strokeStyle = f.theme.accent;
	const x = Math.min(r.x0, r.x1);
	const y = Math.min(r.y0, r.y1);
	ctx.fillRect(x, y, Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
	ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
	ctx.restore();
}

function drawKeys(ctx: CanvasRenderingContext2D, f: Frame) {
	const { theme: t } = f;
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, f.rulerH, f.keysW, f.h - f.rulerH);
	ctx.clip();
	ctx.font = `600 ${Math.max(9, Math.min(11, f.keyH * 0.5))}px ${t.font}`;
	ctx.textBaseline = 'middle';
	for (let p = MAX_PITCH; p >= MIN_PITCH; p--) {
		const y = rowTop(f, p);
		if (y > f.h || y + f.keyH < f.rulerH) continue;
		const black = isBlackKey(p);
		ctx.fillStyle = black ? t.keyBlack : t.keyWhite;
		ctx.fillRect(0, y, f.keysW, f.keyH);
		ctx.fillStyle = t.border;
		ctx.fillRect(0, y + f.keyH - 1, f.keysW, 1);
		if (p % 12 === 0 || (f.keyH >= 20 && !black)) {
			ctx.fillStyle = black ? t.keyWhite : t.keyText;
			ctx.textAlign = 'right';
			ctx.fillText(noteName(p), f.keysW - 6, y + f.keyH / 2 + 0.5);
		}
	}
	ctx.restore();
}

function drawRuler(ctx: CanvasRenderingContext2D, f: Frame) {
	const { theme: t } = f;
	ctx.save();
	ctx.beginPath();
	ctx.rect(f.keysW, 0, f.w - f.keysW, f.rulerH);
	ctx.clip();
	ctx.fillStyle = t.panel;
	ctx.fillRect(f.keysW, 0, f.w - f.keysW, f.rulerH);

	const [t0, t1] = visibleTicks(f);
	const measure = f.measureTicks;
	// Label every n-th measure so the numbers never overlap.
	const labelEvery = Math.max(1, Math.ceil(46 / (measure * f.ppt)));
	ctx.font = `600 11px ${t.font}`;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	const firstMeasure = Math.floor(t0 / measure);
	for (let m = firstMeasure; m * measure <= t1; m++) {
		const x = Math.round(xAt(f, m * measure)) + 0.5;
		ctx.strokeStyle = t.lineMeasure;
		ctx.beginPath();
		ctx.moveTo(x, f.rulerH - 14);
		ctx.lineTo(x, f.rulerH);
		ctx.stroke();
		if (m % labelEvery === 0) {
			ctx.fillStyle = t.muted;
			ctx.fillText(String(m + 1), x + 4, f.rulerH - 18);
		}
		if (f.beatTicks * f.ppt >= 10) {
			for (let b = 1; b * f.beatTicks < measure; b++) {
				const bx = Math.round(xAt(f, m * measure + b * f.beatTicks)) + 0.5;
				ctx.strokeStyle = t.lineBeat;
				ctx.beginPath();
				ctx.moveTo(bx, f.rulerH - 6);
				ctx.lineTo(bx, f.rulerH);
				ctx.stroke();
			}
		}
	}

	// tempo markers
	ctx.textAlign = 'left';
	for (const change of f.tempos) {
		const x = xAt(f, change.tick);
		if (x < f.keysW - 60 || x > f.w) continue;
		const label = `♩${Math.round(change.bpm * 10) / 10}`;
		const lw = ctx.measureText(label).width + 8;
		ctx.fillStyle = t.accent;
		ctx.globalAlpha = 0.9;
		ctx.beginPath();
		ctx.roundRect(x, 2, lw, 13, 3);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.fillStyle = '#fff';
		ctx.fillText(label, x + 4, 9);
	}

	if (f.playTick !== null) {
		const x = xAt(f, f.playTick);
		ctx.fillStyle = t.playhead;
		ctx.beginPath();
		ctx.moveTo(x - 6, f.rulerH - 11);
		ctx.lineTo(x + 6, f.rulerH - 11);
		ctx.lineTo(x, f.rulerH - 1);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

