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

/** A point of a hand-drawn pitch curve that belongs to a whole track. */
export interface CurvePoint {
	tick: number;
	/** Absolute pitch in (fractional) semitones, same scale as MIDI note numbers. */
	pitch: number;
}

/** One continuous stroke of the pitch pen: points sorted by tick, at least two. */
export type PitchStroke = CurvePoint[];

export interface Track {
	id: string;
	name: string;
	/** CSS colour used for the notes of this track. */
	color: string;
	mute: boolean;
	solo: boolean;
	/** Mix level in percent. */
	volume: number;
	/**
	 * Pitch drawn across the whole track (the "track" pitch mode). Where a stroke
	 * covers a note, the note follows the stroke instead of its own pitch.
	 */
	pitchCurve: PitchStroke[];
}

export const DEFAULT_TRACK_ID = 'track-1';

export interface Note {
	id: string;
	/** Id of the track the note belongs to. */
	track: string;
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
	tracks: Track[];
	tempos: TempoChange[];
	timeSignature: TimeSignature;
	/** Name of the voicebank used when the project was saved (informational). */
	voicebank: string;
}

export const MIN_PITCH = 12; // C0
export const MAX_PITCH = 119; // B8
export const MIN_NOTE_TICKS = 15;
