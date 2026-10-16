import { browser } from '$app/env';
import { settings } from './settings.svelte';

export type Panel = 'voicebank' | 'inspector' | null;
export type DialogName = 'settings' | 'lyrics' | 'midi' | 'about' | 'tempo' | 'shortcuts' | null;

export interface Toast {
	id: number;
	text: string;
	kind: 'info' | 'error' | 'success';
}

export interface MenuItem {
	label?: string;
	hint?: string;
	icon?: string;
	danger?: boolean;
	disabled?: boolean;
	separator?: boolean;
	checked?: boolean;
	action?: () => void;
	children?: MenuItem[];
}

export interface MenuRequest {
	x: number;
	y: number;
	items: MenuItem[];
}

class UiState {
	/** Narrow screens use drawers/sheets instead of docked panels. */
	compact = $state(false);
	coarsePointer = $state(false);
	panel = $state<Panel>(null);
	/** Docked side panels on wide screens. */
	get leftOpen() {
		return settings.data.leftOpen;
	}
	set leftOpen(v: boolean) {
		settings.data.leftOpen = v;
	}
	get rightOpen() {
		return settings.data.rightOpen;
	}
	set rightOpen(v: boolean) {
		settings.data.rightOpen = v;
	}
	dialog = $state<DialogName>(null);
	menu = $state<MenuRequest | null>(null);
	toasts = $state<Toast[]>([]);
	/** Last status line shown in the footer. */
	status = $state('Ready');
	/** Payload for dialogs that need one (e.g. the MIDI track picker). */
	dialogData = $state<unknown>(null);
	/** Set by menus to ask the piano roll to start editing a note's lyric. */
	requestLyricEdit = $state<string | null>(null);

	/** Large hit areas and bigger controls. */
	touch = $derived(
		settings.data.touchMode === 'on' || (settings.data.touchMode === 'auto' && this.coarsePointer)
	);

	private toastId = 0;

	constructor() {
		if (!browser) return;
		const narrow = matchMedia('(max-width: 820px), (max-height: 520px)');
		const coarse = matchMedia('(pointer: coarse)');
		const sync = () => {
			this.compact = narrow.matches;
			this.coarsePointer = coarse.matches;
		};
		sync();
		narrow.addEventListener('change', sync);
		coarse.addEventListener('change', sync);
	}

	togglePanel(panel: Exclude<Panel, null>) {
		this.panel = this.panel === panel ? null : panel;
	}

	openDialog(name: Exclude<DialogName, null>, data: unknown = null) {
		this.dialogData = data;
		this.dialog = name;
	}

	closeDialog() {
		this.dialog = null;
		this.dialogData = null;
	}

	openMenu(request: MenuRequest) {
		this.menu = request;
	}

	closeMenu() {
		this.menu = null;
	}

	toast(text: string, kind: Toast['kind'] = 'info', ms = 3600) {
		const id = ++this.toastId;
		this.toasts = [...this.toasts.slice(-3), { id, text, kind }];
		this.status = text;
		setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), ms);
	}

	error(text: string) {
		this.toast(text, 'error', 6000);
	}

	setStatus(text: string) {
		this.status = text;
	}
}

export const ui = new UiState();
