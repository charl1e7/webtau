/** Ticks per quarter note. Same resolution as UST files. */
export const PPQ = 480;

/** Shape of the curve leaving a pitch point (UST: PBM). */
export type PitchShape = 'l' | 's' | 'r' | 'j';

export interface PitchPoint {
	id: string;
	/** Milliseconds from the start of the note. May be negative. */
	x: number;
	/** Cents relative to the note pitch. */
	y: number;
	/** Interpolation towards the next point: linear, sine, ease-out, ease-in. */
	shape: PitchShape;
}

export interface Vibrato {
	/** Share of the note (counted from its end) that vibrates, percent. */
	length: number;
	/** Period in milliseconds. */
	period: number;
	/** Peak deviation in cents. */
	depth: number;
	/** Fade-in / fade-out as percent of the vibrato length. */
	fadeIn: number;
	fadeOut: number;
	/** Start phase, percent of a period. */
	phase: number;
}

export interface Note {
	id: string;
	/** Start position in ticks. */
	tick: number;
	/** Duration in ticks. */
	length: number;
	/** MIDI note number. */
	pitch: number;
	lyric: string;
	/** UTAU velocity (consonant speed), 100 is neutral. */
	velocity: number;
	/** Volume in percent. */
	volume: number;
	modulation: number;
	/** UTAU resampler flags, e.g. "g-5B30". */
	flags: string;
	pitchPoints: PitchPoint[];
	vibrato: Vibrato | null;
}

export interface TempoChange {
	tick: number;
	bpm: number;
}

export interface TimeSignature {
	numerator: number;
	denominator: number;
}

/** Everything that is saved in a project file and takes part in undo/redo. */
export interface ProjectData {
	name: string;
	notes: Note[];
	tempos: TempoChange[];
	timeSignature: TimeSignature;
	/** Name of the voicebank used when the project was saved (informational). */
	voicebank: string;
}

export const MIN_PITCH = 12; // C0
export const MAX_PITCH = 119; // B8
export const MIN_NOTE_TICKS = 15;
