import {
	clamp,
	cloneNote,
	createNote,
	createPitchPoint,
	gridTicks,
	noteEnd
} from '#lib/core/music';
import { moveNotes, notesInRange } from '#lib/core/ops';
import { curveAt, eraseRange } from '#lib/core/pitch-curve';
import { MAX_PITCH, MIN_NOTE_TICKS, MIN_PITCH, type CurvePoint, type Note } from '#lib/core/types';
import { emptyMenu, noteMenu, rulerMenu } from '#lib/state/menus';
import { playback } from '#lib/state/playback.svelte';
import { project } from '#lib/state/project.svelte';
import { settings } from '#lib/state/settings.svelte';
import { ui } from '#lib/state/ui.svelte';
import {
	MAX_KEY_HEIGHT,
	MAX_PX_PER_TICK,
	MIN_KEY_HEIGHT,
	MIN_PX_PER_TICK,
	view
} from '#lib/state/view.svelte';
import type { Rect } from './draw';

export const RULER_H = 30;
const LONG_PRESS_MS = 480;
const DOUBLE_TAP_MS = 340;

type Zone = 'body' | 'start' | 'end';

interface Pointer {
	x: number;
	y: number;
	type: string;
}

type Gesture =
	| {
			kind: 'move';
			ids: ReadonlySet<string>;
			origin: Note[];
			grabId: string;
			grabTick: number;
			grabPitch: number;
			moved: boolean;
	  }
	| {
			kind: 'resize';
			edge: 'start' | 'end';
			ids: ReadonlySet<string>;
			origin: Note[];
			grabId: string;
	  }
	| { kind: 'draw'; id: string; tick0: number }
	| { kind: 'erase'; erased: Set<string>; curveRecorded: boolean }
	| { kind: 'curve'; track: string; pts: CurvePoint[]; hit: Note | null }
	| { kind: 'rubber'; base: ReadonlySet<string> }
	| { kind: 'pan'; lastX: number; lastY: number; samples: { t: number; x: number; y: number }[] }
	| { kind: 'pending'; x: number; y: number; noteId: string | null; onNote: boolean }
	| { kind: 'seek' }
	| { kind: 'keys'; pitch: number }
	| { kind: 'tempo'; tick: number; startX: number; moved: boolean }
	| { kind: 'point'; noteId: string; pointId: string; origin: Note[] }
	| {
			kind: 'pinch';
			startDx: number;
			startDy: number;
			startPpt: number;
			startKey: number;
			anchorTick: number;
			anchorRow: number;
	  };

/** Owns the camera and all pointer interaction of the piano roll. */
export class RollController {
	canvas: HTMLCanvasElement | null = null;

	width = $state(800);
	height = $state(500);
	scrollX = $state(0);
	scrollY = $state(0);

	hoverId = $state<string | null>(null);
	cursor = $state('default');
	rubber = $state<Rect | null>(null);
	guideTick = $state<number | null>(null);
	/** Piano key currently held down (highlighted). */
	pressedKey = $state<number | null>(null);
	selectedPoint = $state<{ noteId: string; pointId: string } | null>(null);
	/** The pitch stroke being drawn (track pitch mode). */
	liveStroke = $state.raw<{ track: string; pts: CurvePoint[] } | null>(null);
	editingLyricId = $state<string | null>(null);

	keysW = $derived(ui.compact ? 44 : 56);

	private pointers = new Map<number, Pointer>();
	private gesture: Gesture | null = null;
	private longPress: ReturnType<typeof setTimeout> | undefined;
	private lastTap = { time: 0, x: 0, y: 0 };
	private inertia = 0;
	private autoScrollTimer: ReturnType<typeof setInterval> | undefined;
	private lastMove: { x: number; y: number; shift: boolean; alt: boolean } = {
		x: 0,
		y: 0,
		shift: false,
		alt: false
	};

	// ---- geometry ---------------------------------------------------------------

	get ppt() {
		return view.pxPerTick;
	}
	get keyH() {
		return view.keyHeight;
	}

	tickAtX = (x: number) => (x - this.keysW + this.scrollX) / this.ppt;
	xAtTick = (tick: number) => this.keysW - this.scrollX + tick * this.ppt;
	/** Fractional row coordinate: row `p` spans [p, p + 1), so floor() gives the pitch. */
	pitchAtY = (y: number) => MAX_PITCH + 1 - (y - RULER_H + this.scrollY) / this.keyH;
	rowTop = (pitch: number) => RULER_H - this.scrollY + (MAX_PITCH - pitch) * this.keyH;
	snapStep = () => gridTicks(settings.data.gridDivision);

	get contentWidth(): number {
		const end = Math.max(project.songEnd, playback.positionTick) + project.ticksPerMeasure() * 16;
		return Math.max(end * this.ppt, this.width - this.keysW);
	}
	get contentHeight(): number {
		return (MAX_PITCH - MIN_PITCH + 1) * this.keyH;
	}
	get maxScrollX() {
		return Math.max(0, this.contentWidth - (this.width - this.keysW));
	}
	get maxScrollY() {
		return Math.max(0, this.contentHeight - (this.height - RULER_H));
	}

	setScroll(x: number, y: number) {
		this.scrollX = clamp(x, 0, this.maxScrollX);
		this.scrollY = clamp(y, 0, this.maxScrollY);
	}

	scrollBy(dx: number, dy: number) {
		this.setScroll(this.scrollX + dx, this.scrollY + dy);
	}

	centerOnPitch(pitch: number) {
		this.setScroll(
			this.scrollX,
			(MAX_PITCH - pitch) * this.keyH - (this.height - RULER_H) / 2 + this.keyH / 2
		);
	}

	/** Brings the whole song into view (used after loading a project). */
	showSong() {
		const notes = project.notes;
		if (!notes.length) {
			this.setScroll(0, 0);
			this.centerOnPitch(60);
			return;
		}
		const pitches = notes.map((n) => n.pitch);
		this.centerOnPitch((Math.min(...pitches) + Math.max(...pitches)) / 2);
		this.setScroll(0, this.scrollY);
	}

	revealTick(tick: number, margin = 80) {
		const x = this.xAtTick(tick);
		const right = this.width - margin;
		if (x > right || x < this.keysW) this.setScroll(tick * this.ppt - margin - 40, this.scrollY);
	}

	/** Keeps the pixel under (px, py) fixed while the zoom changes. */
	zoomAround(px: number, py: number, fx: number, fy: number) {
		const tick = this.tickAtX(px);
		const row = this.pitchAtY(py);
		view.pxPerTick = clamp(view.pxPerTick * fx, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
		view.keyHeight = clamp(view.keyHeight * fy, MIN_KEY_HEIGHT, MAX_KEY_HEIGHT);
		this.setScroll(
			tick * this.ppt - (px - this.keysW),
			(MAX_PITCH + 1 - row) * this.keyH - (py - RULER_H)
		);
	}

	zoomCenter(fx: number, fy: number) {
		this.zoomAround(
			this.keysW + (this.width - this.keysW) / 2,
			RULER_H + (this.height - RULER_H) / 2,
			fx,
			fy
		);
	}

	// ---- hit testing ---------------------------------------------------------------

	private handleWidth(): number {
		return ui.touch ? 24 : 8;
	}

	hitTest(x: number, y: number): { note: Note; zone: Zone } | null {
		if (x < this.keysW || y < RULER_H) return null;
		const hw = this.handleWidth();
		const ext = ui.touch ? 14 : 4;
		const yTol = ui.touch ? 3 : 0;
		const notes = project.notes;
		for (let i = notes.length - 1; i >= 0; i--) {
			const n = notes[i];
			const top = this.rowTop(n.pitch);
			if (y < top - yTol || y > top + this.keyH + yTol) continue;
			const left = this.xAtTick(n.tick);
			const right = left + Math.max(3, n.length * this.ppt);
			const selected = project.selection.has(n.id);
			const outside = selected ? ext : 0;
			if (x < left - outside || x > right + outside) continue;
			const grip = Math.min(hw, (right - left) * 0.34);
			if (x >= right - grip) return { note: n, zone: 'end' };
			if (x <= left + grip) return { note: n, zone: 'start' };
			return { note: n, zone: 'body' };
		}
		return null;
	}

	private snap(tick: number, free: boolean, mode: 'nearest' | 'floor' = 'nearest'): number {
		if (free || !settings.data.snap) return Math.round(tick);
		const step = this.snapStep();
		// The epsilon keeps a pointer exactly on a grid line from rounding down a cell.
		return (mode === 'floor' ? Math.floor(tick / step + 1e-6) : Math.round(tick / step)) * step;
	}

	// ---- pointer events ----------------------------------------------------------------

	private local(e: PointerEvent | WheelEvent | MouseEvent) {
		const r = this.canvas!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	onPointerDown = (e: PointerEvent) => {
		if (!this.canvas) return;
		ui.closeMenu();
		const active = document.activeElement;
		if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
		this.canvas.setPointerCapture(e.pointerId);
		// A primary pointerdown means no other finger is down: forget any pointer
		// whose up/cancel event was lost, or it would be mistaken for a pinch.
		if (e.isPrimary) this.pointers.clear();
		const p = this.local(e);
		this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
		this.inertia++;
		this.lastMove = { ...p, shift: e.shiftKey, alt: e.altKey };
		this.moved = false;
		this.downAt = p;

		if (this.pointers.size === 2 && e.pointerType === 'touch') {
			this.cancelGesture();
			this.beginPinch();
			return;
		}
		if (this.pointers.size > 1) return;

		const isDouble = this.registerTap(e, p);

		// Ruler: seek / tempo menu.
		if (p.y < RULER_H && p.x >= this.keysW) {
			if (e.button === 2) {
				e.preventDefault();
				ui.openMenu({
					x: e.clientX,
					y: e.clientY,
					items: rulerMenu(Math.max(0, Math.round(this.tickAtX(p.x))))
				});
				return;
			}
			const marker = this.tempoMarkerAt(p.x, p.y);
			if (marker !== null) {
				this.gesture = { kind: 'tempo', tick: marker, startX: p.x, moved: false };
				return;
			}
			if (isDouble) {
				const tick = Math.max(0, this.snap(this.tickAtX(p.x), false));
				ui.openDialog('tempo', { tick });
				return;
			}
			this.gesture = { kind: 'seek' };
			playback.seekTick(this.snap(this.tickAtX(p.x), true));
			return;
		}

		if (p.x < this.keysW && p.y >= RULER_H && e.button === 0) {
			const pitch = clamp(Math.floor(this.pitchAtY(p.y)), MIN_PITCH, MAX_PITCH);
			this.gesture = { kind: 'keys', pitch };
			this.pressedKey = pitch;
			void playback.preview(pitch);
			return;
		}

		if (e.button === 1 || p.x < this.keysW) {
			this.gesture = { kind: 'pan', lastX: p.x, lastY: p.y, samples: [] };
			return;
		}

		const hit = this.hitTest(p.x, p.y);

		if (e.button === 2) {
			e.preventDefault();
			this.openContextMenu(e.clientX, e.clientY, p, hit?.note ?? null);
			return;
		}
		if (e.button !== 0 && e.pointerType === 'mouse') return;

		if (e.pointerType === 'touch') this.startLongPress(e, p, hit?.note ?? null);

		switch (view.tool) {
			case 'erase':
				this.beginErase(p);
				break;
			case 'pitch':
				this.downPitch(e, p, hit?.note ?? null, isDouble);
				break;
			case 'draw':
				if (hit) this.downNote(e, p, hit, isDouble);
				else this.beginDraw(p);
				break;
			default:
				if (hit) this.downNote(e, p, hit, isDouble);
				else this.downEmpty(e, p, isDouble);
		}
	};

	onPointerMove = (e: PointerEvent) => {
		const prev = this.pointers.get(e.pointerId);
		const p = this.local(e);
		if (prev) {
			prev.x = p.x;
			prev.y = p.y;
		}
		this.lastMove = { ...p, shift: e.shiftKey, alt: e.altKey };

		if (!this.gesture) {
			if (e.pointerType === 'mouse') this.updateHover(p);
			return;
		}
		if (this.gesture.kind === 'pinch') {
			this.updatePinch();
			return;
		}
		if (this.pointers.size > 1) return;
		if (!this.moved && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > (ui.touch ? 10 : 5)) {
			this.moved = true;
		}
		const g = this.gesture;
		if (g.kind === 'curve' && this.moved && e.getCoalescedEvents) {
			// Fast strokes arrive in batches; keep every sample so the line stays smooth.
			for (const q of e.getCoalescedEvents().slice(0, -1)) this.extendStroke(g, this.local(q));
		}
		this.applyMove(p, e.shiftKey, e.altKey);
		this.updateAutoScroll(p);
	};

	onPointerUp = (e: PointerEvent) => {
		const g = this.gesture;
		const p = this.local(e);
		this.pointers.delete(e.pointerId);
		clearTimeout(this.longPress);
		this.stopAutoScroll();

		if (g?.kind === 'pinch') {
			if (this.pointers.size < 2) this.gesture = null;
			return;
		}
		this.gesture = null;
		if (!g) return;

		switch (g.kind) {
			case 'move':
			case 'resize':
			case 'draw':
			case 'point':
				project.endGesture();
				break;
			case 'erase': {
				project.endGesture();
				project.select([...project.selection].filter((id) => !g.erased.has(id)));
				break;
			}
			case 'curve': {
				this.liveStroke = null;
				if (this.moved && g.pts.length > 1) {
					project.addPitchStroke(g.track, g.pts);
				} else if (g.hit) {
					project.select([g.hit.id]);
				} else if (!this.isDoubleTapPending) {
					project.clearSelection();
				}
				break;
			}
			case 'rubber':
				this.rubber = null;
				break;
			case 'keys':
				this.pressedKey = null;
				break;
			case 'tempo':
				if (!g.moved) ui.openDialog('tempo', { tick: g.tick });
				break;
			case 'pan':
				this.startInertia(g);
				break;
			case 'pending':
				// A tap on empty space (or on a note while panning-capable) without movement.
				if (g.onNote) break;
				if (!this.isDoubleTapPending) project.clearSelection();
				break;
		}
		this.guideTick = null;
		this.isDoubleTapPending = false;
		void p;
	};

	onPointerCancel = (e: PointerEvent) => {
		this.pointers.delete(e.pointerId);
		this.cancelGesture();
	};

	onPointerLeave = () => {
		if (!this.gesture) {
			this.hoverId = null;
			this.cursor = 'default';
		}
	};

	onContextMenu = (e: MouseEvent) => e.preventDefault();

	onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const p = this.local(e);
		const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
		const dx = e.deltaX * unit;
		const dy = e.deltaY * unit;
		if (e.ctrlKey || e.metaKey) {
			this.zoomAround(p.x, p.y, Math.exp(-dy * 0.0035), 1);
		} else if (e.altKey) {
			this.zoomAround(p.x, p.y, 1, Math.exp(-dy * 0.003));
		} else if (e.shiftKey) {
			this.scrollBy(dy || dx, 0);
		} else {
			this.scrollBy(dx, dy);
		}
	};

	// ---- gesture setup ---------------------------------------------------------------------

	private isDoubleTapPending = false;
	/** Whether the pointer travelled beyond the touch slop since it went down. */
	private moved = false;
	private downAt = { x: 0, y: 0 };

	private registerTap(e: PointerEvent, p: { x: number; y: number }): boolean {
		const now = performance.now();
		const double =
			now - this.lastTap.time < DOUBLE_TAP_MS &&
			Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 20 &&
			(e.button === 0 || e.pointerType === 'touch');
		this.lastTap = double ? { time: 0, x: 0, y: 0 } : { time: now, x: p.x, y: p.y };
		this.isDoubleTapPending = double;
		return double;
	}

	private startLongPress(e: PointerEvent, p: { x: number; y: number }, note: Note | null) {
		clearTimeout(this.longPress);
		this.longPress = setTimeout(() => {
			const g = this.gesture;
			if (!g) return;
			const stillDown = [...this.pointers.values()].some(
				(q) => Math.hypot(q.x - p.x, q.y - p.y) < 10
			);
			if (!stillDown) return;
			if (this.moved || g.kind === 'pan') return;
			// Abort whatever tentative edit has started and show the menu instead.
			if (['move', 'resize', 'draw', 'point'].includes(g.kind)) project.cancelGesture();
			this.gesture = null;
			this.liveStroke = null;
			navigator.vibrate?.(12);
			this.openContextMenu(e.clientX, e.clientY, p, note, true);
		}, LONG_PRESS_MS);
	}

	private openContextMenu(
		cx: number,
		cy: number,
		p: { x: number; y: number },
		note: Note | null,
		guard = false
	) {
		if (note) {
			if (!project.selection.has(note.id)) project.select([note.id]);
			ui.openMenu({ x: cx, y: cy, items: noteMenu(note.id), guard });
		} else {
			const tick = Math.max(0, this.snap(this.tickAtX(p.x), false, 'floor'));
			const pitch = clamp(Math.floor(this.pitchAtY(p.y)), MIN_PITCH, MAX_PITCH);
			ui.openMenu({ x: cx, y: cy, items: emptyMenu(tick, pitch), guard });
		}
	}

	private downNote(
		e: PointerEvent,
		p: { x: number; y: number },
		hit: { note: Note; zone: Zone },
		isDouble: boolean
	) {
		const { note, zone } = hit;
		if (isDouble) {
			project.select([note.id]);
			this.editingLyricId = note.id;
			return;
		}
		const additive = e.shiftKey || e.ctrlKey || e.metaKey;
		if (additive) project.toggleSelect(note.id);
		else if (!project.selection.has(note.id)) project.select([note.id]);

		this.selectedPoint = null;
		if (!project.selection.has(note.id)) return;

		if (zone !== 'body') {
			project.beginGesture();
			this.gesture = {
				kind: 'resize',
				edge: zone,
				ids: project.selection,
				origin: project.notes,
				grabId: note.id
			};
			return;
		}

		project.beginGesture();
		let origin = project.notes;
		let ids = project.selection;
		if (e.altKey && e.pointerType === 'mouse') {
			const clones = project.notes.filter((n) => ids.has(n.id)).map((n) => cloneNote(n));
			origin = [...project.notes, ...clones];
			project.preview(() => origin);
			ids = new Set(clones.map((c) => c.id));
			project.select(ids);
		}
		const grab = origin.find((n) => n.id === note.id) ?? note;
		this.gesture = {
			kind: 'move',
			ids,
			origin,
			grabId: ids.has(note.id) ? note.id : [...ids][0],
			grabTick: this.tickAtX(p.x) - grab.tick,
			grabPitch: Math.floor(this.pitchAtY(p.y)) - grab.pitch,
			moved: false
		};
	}

	private downEmpty(e: PointerEvent, p: { x: number; y: number }, isDouble: boolean) {
		if (isDouble) {
			this.createNoteAt(p);
			return;
		}
		if (e.pointerType === 'mouse') {
			const base = e.shiftKey || e.ctrlKey || e.metaKey ? project.selection : new Set<string>();
			if (!base.size) project.clearSelection();
			this.selectedPoint = null;
			this.gesture = { kind: 'rubber', base };
			this.rubber = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
		} else {
			// Touch: a finger on empty space scrolls; a tap deselects.
			this.gesture = { kind: 'pending', x: p.x, y: p.y, noteId: null, onNote: false };
		}
	}

	private createNoteAt(p: { x: number; y: number }) {
		const tick = Math.max(0, this.snap(this.tickAtX(p.x), false, 'floor'));
		const pitch = clamp(Math.floor(this.pitchAtY(p.y)), MIN_PITCH, MAX_PITCH);
		const note = createNote({
			track: project.activeTrack,
			tick,
			pitch,
			length: this.snapStep(),
			lyric: settings.data.defaultLyric || 'a'
		});
		project.edit((notes) => [...notes, note]);
		project.select([note.id]);
		this.gesture = null;
	}

	private beginDraw(p: { x: number; y: number }) {
		const tick = Math.max(0, this.snap(this.tickAtX(p.x), false, 'floor'));
		const pitch = clamp(Math.floor(this.pitchAtY(p.y)), MIN_PITCH, MAX_PITCH);
		const note = createNote({
			track: project.activeTrack,
			tick,
			pitch,
			length: this.snapStep(),
			lyric: settings.data.defaultLyric || 'a'
		});
		project.beginGesture();
		project.preview((notes) => [...notes, note]);
		project.select([note.id]);
		this.gesture = { kind: 'draw', id: note.id, tick0: tick };
	}

	private beginErase(p: { x: number; y: number }) {
		project.beginGesture();
		this.gesture = { kind: 'erase', erased: new Set(), curveRecorded: false };
		this.eraseAt(p);
	}

	private eraseAt(p: { x: number; y: number }) {
		const g = this.gesture;
		if (g?.kind !== 'erase') return;
		const hit = this.hitTest(p.x, p.y);
		if (hit) {
			if (!g.erased.has(hit.note.id)) {
				g.erased.add(hit.note.id);
				project.preview((notes) => notes.filter((n) => !g.erased.has(n.id)));
			}
			return;
		}
		if (settings.data.pitchMode === 'track') this.eraseCurveAt(p, g);
	}

	/** Cuts the drawn pitch curve out under the pointer (one undo step per drag). */
	private eraseCurveAt(p: { x: number; y: number }, g: Extract<Gesture, { kind: 'erase' }>) {
		const reach = Math.max(12, this.keyH);
		const t0 = this.tickAtX(p.x - 8);
		const t1 = this.tickAtX(p.x + 8);
		const tick = this.tickAtX(p.x);
		for (const track of project.tracks) {
			const value = curveAt(track.pitchCurve, tick);
			if (value === null) continue;
			if (Math.abs(this.yAtPitch(value) - p.y) > reach) continue;
			project.setPitchCurve(track.id, eraseRange(track.pitchCurve, t0, t1), !g.curveRecorded);
			g.curveRecorded = true;
		}
	}

	/** Canvas y of a (fractional) pitch, the middle of its row for whole numbers. */
	yAtPitch(pitch: number) {
		return this.rowTop(pitch) + this.keyH / 2;
	}

	private downPitch(
		e: PointerEvent,
		p: { x: number; y: number },
		hit: Note | null,
		isDouble: boolean
	) {
		if (settings.data.pitchMode === 'track') {
			this.liveStroke = null;
			this.gesture = { kind: 'curve', track: project.activeTrack, pts: [this.curvePoint(p)], hit };
			return;
		}
		const point = this.pointAt(p);
		if (point) {
			if (isDouble || e.button === 2) {
				this.deletePoint(point.noteId, point.pointId);
				return;
			}
			this.selectedPoint = point;
			project.beginGesture();
			this.gesture = { kind: 'point', ...point, origin: project.notes };
			return;
		}

		// Add a point on a selected note under (or near) the pointer.
		const target = this.noteForNewPoint(p, hit);
		if (target) {
			const offsetMs =
				project.tempoMap.tickToMs(this.tickAtX(p.x)) - project.tempoMap.tickToMs(target.tick);
			const cents = this.centsAt(target, p.y);
			const pt = createPitchPoint(Math.round(offsetMs), cents, 'l');
			project.beginGesture();
			project.preview((notes) =>
				notes.map((n) =>
					n.id === target.id
						? { ...n, pitchPoints: [...n.pitchPoints, pt].sort((a, b) => a.x - b.x) }
						: n
				)
			);
			this.selectedPoint = { noteId: target.id, pointId: pt.id };
			this.gesture = { kind: 'point', noteId: target.id, pointId: pt.id, origin: project.notes };
			return;
		}

		if (hit) {
			project.select([hit.id]);
			this.selectedPoint = null;
		} else if (e.pointerType === 'touch') {
			this.gesture = { kind: 'pending', x: p.x, y: p.y, noteId: null, onNote: false };
		} else {
			project.clearSelection();
			this.selectedPoint = null;
		}
	}

	/** Where on the roll the pointer is, as a point of a pitch curve. */
	private curvePoint(p: { x: number; y: number }): CurvePoint {
		return { tick: Math.max(0, this.tickAtX(p.x)), pitch: this.pitchAtY(p.y) - 0.5 };
	}

	private extendStroke(g: Extract<Gesture, { kind: 'curve' }>, p: { x: number; y: number }) {
		const pt = this.curvePoint(p);
		const last = g.pts[g.pts.length - 1];
		if (last && Math.abs(pt.tick - last.tick) < 0.5 / this.ppt && pt.pitch === last.pitch) return;
		g.pts.push(pt);
		this.liveStroke = { track: g.track, pts: g.pts };
	}

	/** Selected note whose time span (plus a margin) contains the pointer. */
	private noteForNewPoint(p: { x: number; y: number }, hit: Note | null): Note | null {
		const tick = this.tickAtX(p.x);
		const margin = 40 / this.ppt;
		const candidates = project.selectedNotes.filter(
			(n) => tick >= n.tick - margin && tick <= noteEnd(n) + margin
		);
		if (hit && project.selection.has(hit.id)) return hit;
		// Prefer the note whose vertical neighbourhood is closest.
		let best: Note | null = null;
		let bestDist = Infinity;
		for (const n of candidates) {
			const d = Math.abs(this.rowTop(n.pitch) + this.keyH / 2 - p.y);
			if (d < bestDist && d < this.keyH * 6) {
				best = n;
				bestDist = d;
			}
		}
		return best;
	}

	centsAt(note: Note, y: number): number {
		const center = this.rowTop(note.pitch) + this.keyH / 2;
		return Math.round(((center - y) / this.keyH) * 100);
	}

	private pointAt(p: { x: number; y: number }): { noteId: string; pointId: string } | null {
		const radius = ui.touch ? 18 : 9;
		const map = project.tempoMap;
		let best: { noteId: string; pointId: string } | null = null;
		let bestDist = radius;
		for (const n of project.selectedNotes) {
			const startMs = map.tickToMs(n.tick);
			const cy = this.rowTop(n.pitch) + this.keyH / 2;
			for (const pt of n.pitchPoints) {
				const px = this.xAtTick(map.msToTick(startMs + pt.x));
				const py = cy - (pt.y / 100) * this.keyH;
				const d = Math.hypot(px - p.x, py - p.y);
				if (d < bestDist) {
					bestDist = d;
					best = { noteId: n.id, pointId: pt.id };
				}
			}
		}
		return best;
	}

	deletePoint(noteId: string, pointId: string) {
		project.edit((notes) =>
			notes.map((n) =>
				n.id === noteId ? { ...n, pitchPoints: n.pitchPoints.filter((q) => q.id !== pointId) } : n
			)
		);
		if (this.selectedPoint?.pointId === pointId) this.selectedPoint = null;
	}

	// ---- gesture updates -----------------------------------------------------------------------

	private applyMove(p: { x: number; y: number }, shift: boolean, alt: boolean) {
		const g = this.gesture;
		if (!g) return;
		const slop = ui.touch ? 8 : 4;

		switch (g.kind) {
			case 'pending': {
				if (Math.hypot(p.x - g.x, p.y - g.y) > slop) {
					clearTimeout(this.longPress);
					this.gesture = { kind: 'pan', lastX: g.x, lastY: g.y, samples: [] };
					this.applyMove(p, shift, alt);
				}
				break;
			}
			case 'pan': {
				this.scrollBy(g.lastX - p.x, g.lastY - p.y);
				g.samples.push({ t: performance.now(), x: p.x, y: p.y });
				if (g.samples.length > 6) g.samples.shift();
				g.lastX = p.x;
				g.lastY = p.y;
				break;
			}
			case 'seek':
				playback.seekTick(this.snap(this.tickAtX(p.x), true));
				break;
			case 'keys': {
				const pitch = clamp(Math.floor(this.pitchAtY(p.y)), MIN_PITCH, MAX_PITCH);
				if (pitch !== g.pitch) {
					g.pitch = pitch;
					this.pressedKey = pitch;
					void playback.preview(pitch);
				}
				break;
			}
			case 'tempo': {
				if (!this.moved || g.tick === 0) break;
				const to = Math.max(1, this.snap(this.tickAtX(p.x), shift));
				if (!g.moved) {
					g.moved = true;
					project.beginTempoDrag();
				}
				if (to !== g.tick && !project.tempos.some((t) => t.tick === to)) {
					project.moveTempo(g.tick, to);
					g.tick = to;
				}
				break;
			}
			case 'rubber': {
				const r = this.rubber!;
				r.x1 = p.x;
				r.y1 = p.y;
				this.rubber = { ...r };
				const t0 = this.tickAtX(Math.min(r.x0, r.x1));
				const t1 = this.tickAtX(Math.max(r.x0, r.x1));
				const hi = Math.floor(this.pitchAtY(Math.min(r.y0, r.y1)));
				const lo = Math.floor(this.pitchAtY(Math.max(r.y0, r.y1)));
				const inside = notesInRange(project.notes, t0, t1, lo, hi).map((n) => n.id);
				project.select([...g.base, ...inside]);
				break;
			}
			case 'move': {
				const grabbed = g.origin.find((n) => n.id === g.grabId);
				if (!grabbed) return;
				const rawStart = this.tickAtX(p.x) - g.grabTick;
				const newStart = this.snap(rawStart, shift);
				const dTick = newStart - grabbed.tick;
				const dPitch = Math.floor(this.pitchAtY(p.y)) - g.grabPitch - grabbed.pitch;
				if (!g.moved && (dTick !== 0 || dPitch !== 0)) g.moved = true;
				if (g.moved) {
					project.preview(() => moveNotes(g.origin, g.ids, dTick, dPitch));
					this.guideTick = Math.max(0, newStart);
				}
				break;
			}
			case 'resize': {
				const grabbed = g.origin.find((n) => n.id === g.grabId);
				if (!grabbed) return;
				const t = this.snap(this.tickAtX(p.x), shift);
				if (g.edge === 'end') {
					const delta = t - noteEnd(grabbed);
					project.preview(() =>
						g.origin.map((n) =>
							g.ids.has(n.id) ? { ...n, length: Math.max(MIN_NOTE_TICKS, n.length + delta) } : n
						)
					);
					this.guideTick = Math.max(grabbed.tick + MIN_NOTE_TICKS, t);
				} else {
					const maxDelta = grabbed.length - MIN_NOTE_TICKS;
					const delta = clamp(t - grabbed.tick, -grabbed.tick, maxDelta);
					project.preview(() =>
						g.origin.map((n) =>
							g.ids.has(n.id)
								? {
										...n,
										tick: Math.max(0, n.tick + delta),
										length: Math.max(MIN_NOTE_TICKS, n.length - delta)
									}
								: n
						)
					);
					this.guideTick = grabbed.tick + delta;
				}
				break;
			}
			case 'draw': {
				const end = this.snap(this.tickAtX(p.x), shift, 'nearest');
				const length = Math.max(shift ? MIN_NOTE_TICKS : this.snapStep(), end - g.tick0);
				project.preview((notes) => notes.map((n) => (n.id === g.id ? { ...n, length } : n)));
				this.guideTick = g.tick0 + length;
				break;
			}
			case 'erase':
				this.eraseAt(p);
				break;
			case 'curve':
				if (this.moved) this.extendStroke(g, p);
				break;
			case 'point': {
				const note = g.origin.find((n) => n.id === g.noteId);
				if (!note) return;
				const map = project.tempoMap;
				const ms = Math.round(map.tickToMs(this.tickAtX(p.x)) - map.tickToMs(note.tick));
				let cents = this.centsAt(note, p.y);
				if (!shift) cents = Math.round(cents / 5) * 5;
				project.preview(() =>
					g.origin.map((n) =>
						n.id === g.noteId
							? {
									...n,
									pitchPoints: n.pitchPoints
										.map((q) => (q.id === g.pointId ? { ...q, x: ms, y: cents } : q))
										.sort((a, b) => a.x - b.x)
								}
							: n
					)
				);
				break;
			}
		}
		this.updateCursor(p);
	}

	/** Tick of the tempo marker under the pointer on the ruler, if any. */
	private tempoMarkerAt(x: number, y: number): number | null {
		if (y > 18) return null;
		for (const t of project.tempos) {
			const left = this.xAtTick(t.tick);
			if (x >= left - 2 && x <= left + 58) return t.tick;
		}
		return null;
	}

	private updateHover(p: { x: number; y: number }) {
		const hit = this.hitTest(p.x, p.y);
		this.hoverId = hit?.note.id ?? null;
		this.updateCursor(p, hit);
	}

	private updateCursor(p: { x: number; y: number }, hit = this.hitTest(p.x, p.y)) {
		const g = this.gesture;
		if (g?.kind === 'pan') this.cursor = 'grabbing';
		else if (g?.kind === 'resize' || (hit && hit.zone !== 'body' && view.tool !== 'pitch'))
			this.cursor = 'ew-resize';
		else if (g?.kind === 'move') this.cursor = 'grabbing';
		else if (p.y < RULER_H && p.x >= this.keysW) this.cursor = 'pointer';
		else if (view.tool === 'erase') this.cursor = hit ? 'not-allowed' : 'default';
		else if (view.tool === 'draw') this.cursor = hit ? 'grab' : 'crosshair';
		else if (view.tool === 'pitch')
			this.cursor = settings.data.pitchMode === 'note' && this.pointAt(p) ? 'grab' : 'crosshair';
		else this.cursor = hit ? 'grab' : 'default';
	}

	private cancelGesture() {
		clearTimeout(this.longPress);
		this.stopAutoScroll();
		const g = this.gesture;
		if (g && ['move', 'resize', 'draw', 'erase', 'point'].includes(g.kind)) project.cancelGesture();
		this.gesture = null;
		this.liveStroke = null;
		this.rubber = null;
		this.guideTick = null;
		this.pressedKey = null;
	}

	// ---- pinch (two-finger zoom + pan) ---------------------------------------------------------

	private beginPinch() {
		const [a, b] = [...this.pointers.values()];
		const cx = (a.x + b.x) / 2;
		const cy = (a.y + b.y) / 2;
		this.gesture = {
			kind: 'pinch',
			startDx: Math.abs(a.x - b.x),
			startDy: Math.abs(a.y - b.y),
			startPpt: view.pxPerTick,
			startKey: view.keyHeight,
			anchorTick: this.tickAtX(cx),
			anchorRow: this.pitchAtY(cy)
		};
	}

	private updatePinch() {
		const g = this.gesture;
		if (g?.kind !== 'pinch') return;
		const pts = [...this.pointers.values()];
		if (pts.length < 2) return;
		const [a, b] = pts;
		const cx = (a.x + b.x) / 2;
		const cy = (a.y + b.y) / 2;
		const dx = Math.abs(a.x - b.x);
		const dy = Math.abs(a.y - b.y);
		// Only zoom along an axis if the fingers are clearly spread along it.
		const fx = g.startDx > 36 ? dx / g.startDx : 1;
		const fy = g.startDy > 36 ? dy / g.startDy : 1;
		view.pxPerTick = clamp(g.startPpt * fx, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
		view.keyHeight = clamp(Math.round(g.startKey * fy), MIN_KEY_HEIGHT, MAX_KEY_HEIGHT);
		this.setScroll(
			g.anchorTick * this.ppt - (cx - this.keysW),
			(MAX_PITCH + 1 - g.anchorRow) * this.keyH - (cy - RULER_H)
		);
	}

	// ---- inertia & edge auto-scroll -----------------------------------------------------------

	private startInertia(g: Extract<Gesture, { kind: 'pan' }>) {
		const s = g.samples;
		if (s.length < 2 || performance.now() - s[s.length - 1].t > 80) return;
		const first = s[0];
		const last = s[s.length - 1];
		const dt = Math.max(1, last.t - first.t);
		let vx = ((first.x - last.x) / dt) * 16;
		let vy = ((first.y - last.y) / dt) * 16;
		const token = ++this.inertia;
		const step = () => {
			if (token !== this.inertia) return;
			vx *= 0.94;
			vy *= 0.94;
			if (Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) return;
			this.scrollBy(vx, vy);
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	private updateAutoScroll(p: { x: number; y: number }) {
		const g = this.gesture;
		if (!g || !['move', 'resize', 'draw', 'rubber', 'point', 'curve'].includes(g.kind)) return;
		const edge = 36;
		const near =
			p.x > this.width - edge ||
			(p.x < this.keysW + edge && this.scrollX > 0) ||
			p.y > this.height - edge ||
			(p.y < RULER_H + edge && this.scrollY > 0);
		if (!near) return this.stopAutoScroll();
		if (this.autoScrollTimer) return;
		this.autoScrollTimer = setInterval(() => {
			const { x, y, shift, alt } = this.lastMove;
			const speed = (d: number) => Math.min(24, Math.max(0, (edge - d) / 2));
			const dx = speed(this.width - x) - speed(x - this.keysW);
			const dy = speed(this.height - y) - speed(y - RULER_H);
			if (!dx && !dy) return;
			this.scrollBy(dx, dy);
			this.applyMove({ x, y }, shift, alt);
		}, 16);
	}

	private stopAutoScroll() {
		clearInterval(this.autoScrollTimer);
		this.autoScrollTimer = undefined;
	}
}

/** Gives code outside the piano roll (shortcuts, toolbar) access to the active controller. */
export const rollHandle: { current: RollController | null } = { current: null };
