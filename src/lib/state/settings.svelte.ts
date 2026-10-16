import { browser } from '$app/env';

export type PlaybackStart = 'cursor' | 'start';
export type AnalysisQuality = 'accurate' | 'fast';

export interface SettingsData {
	defaultLyric: string;
	gridDivision: number;
	snap: boolean;
	playbackStart: PlaybackStart;
	followPlayhead: boolean;
	/** 0 = choose automatically. */
	analysisWorkers: number;
	analysisQuality: AnalysisQuality;
	backgroundAnalysis: boolean;
	showNoteNames: boolean;
	/** UI scale for touch targets: 'auto' picks by input device. */
	touchMode: 'auto' | 'on' | 'off';
	theme: 'auto' | 'dark' | 'light';
	/** Docked side panels of the desktop layout. */
	leftWidth: number;
	rightWidth: number;
	leftOpen: boolean;
	rightOpen: boolean;
	/** Bumped when a default changes so that stored settings can be migrated. */
	settingsVersion: number;
}

const DEFAULTS: SettingsData = {
	defaultLyric: 'a',
	gridDivision: 8,
	snap: true,
	playbackStart: 'cursor',
	followPlayhead: true,
	analysisWorkers: 0,
	analysisQuality: 'fast',
	backgroundAnalysis: true,
	showNoteNames: true,
	touchMode: 'auto',
	theme: 'dark',
	leftWidth: 308,
	rightWidth: 296,
	leftOpen: true,
	rightOpen: true,
	settingsVersion: 2
};

const STORAGE_KEY = 'webtau:settings';

function load(): SettingsData {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const stored = raw ? JSON.parse(raw) : {};
		const data: SettingsData = { ...DEFAULTS, ...stored };
		// v2: the fast DIO analyzer became the default; apply it to older stored settings once.
		if ((stored.settingsVersion ?? 1) < 2) data.analysisQuality = 'fast';
		data.settingsVersion = DEFAULTS.settingsVersion;
		return data;
	} catch {
		return { ...DEFAULTS };
	}
}

class Settings {
	data = $state<SettingsData>(load());

	constructor() {
		if (!browser) return;
		$effect.root(() => {
			$effect(() => {
				const json = JSON.stringify($state.snapshot(this.data));
				try {
					localStorage.setItem(STORAGE_KEY, json);
				} catch {
					/* private mode: settings just won't persist */
				}
			});
		});
	}

	reset() {
		Object.assign(this.data, DEFAULTS);
	}

	/** Number of analysis workers actually used. */
	get workerCount(): number {
		if (this.data.analysisWorkers > 0) return this.data.analysisWorkers;
		const cores = browser ? navigator.hardwareConcurrency || 4 : 4;
		const mobile = browser && matchMedia('(pointer: coarse)').matches;
		return Math.max(1, Math.min(cores - 1, mobile ? 3 : 6));
	}
}

export const settings = new Settings();
