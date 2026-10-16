import { clamp } from '#lib/core/music';

export type Tool = 'select' | 'draw' | 'pitch' | 'erase';

export const MIN_PX_PER_TICK = 0.02;
export const MAX_PX_PER_TICK = 1.2;
export const MIN_KEY_HEIGHT = 12;
export const MAX_KEY_HEIGHT = 44;

class ViewState {
	tool = $state<Tool>('select');
	/** Horizontal zoom: CSS pixels per tick. */
	pxPerTick = $state(0.2);
	/** Vertical zoom: CSS pixels per semitone row. */
	keyHeight = $state(
		typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 28 : 22
	);

	setTool(tool: Tool) {
		this.tool = tool;
	}

	zoomX(factor: number) {
		this.pxPerTick = clamp(this.pxPerTick * factor, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
	}

	zoomY(factor: number) {
		this.keyHeight = clamp(Math.round(this.keyHeight * factor), MIN_KEY_HEIGHT, MAX_KEY_HEIGHT);
	}
}

export const view = new ViewState();
