export type PlaybackStartMode = 'from_start' | 'resume' | 'from_marker';


export interface ProjectSettings {
	analysisCoreCount: number;
}

export interface PianoRollSettings {
	defaultLyric: string;
	playbackStartMode: PlaybackStartMode;
	reRenderOnPlay: boolean;
}

export interface SettingsState {
	project: ProjectSettings;
	pianoRoll: PianoRollSettings;
}
export interface PitchbendPointInfo {
	offset: number;
	value: number;
}
export interface NoteInfo {
	alias: string;
	pitch: number;
	start_time: number;
	duration: number;
	pitchbend: PitchbendPointInfo[];
	flags: string;
    velocity: number;
    volume: number;
    modulation: number;
}
export interface ProjectInfo {
    notes: NoteInfo[];
    tempo: number;
}
export interface PitchbendPoint {
	id: string; 
	offset: number; 
	value: number; 
}
export interface Note {
	id: string;
	alias: string;
	midiPitch: number;
	startBeat: number;
	durationBeat: number;
	pitchbend: PitchbendPoint[];
	velocity?: number;
	flags?: string;
	volume?: number;
	modulation?: number;
}
export interface VoicebankInfo {
	id: string;
	name: string;
	image?: string | null;
	characterInfo?: Map<string, string>;
}
export interface PlaybackState {
	isPlaying: boolean;
	currentTime: number;
	masterAudioBuffer: AudioBuffer | null;
}
export interface SynthesisState {
	isSynthesizing: boolean;
	progress: number;
	statusMessage: string;
}
export type EditorMode = 'select' | 'pitchbend';
export interface AppState {
	status: string;
	currentVoicebank: VoicebankInfo | null;
	notes: Note[];
	selectedNoteIds: Set<string>;
	playback: PlaybackState;
	playbackMarkerTime: number;
	synthesis: SynthesisState;
	tempo: number;
	gridDivision: number;
	editorMode: EditorMode;
	isNoteEditorOpen: boolean;
	editingNoteId: string | null;
	isSettingsModalOpen: boolean;
}