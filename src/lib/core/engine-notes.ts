import type { EngineNote } from '#lib/engine/bridge';
import { compilePitch } from './pitch';
import { overlayFor, strokesToMs, type MsStroke } from './pitch-curve';
import type { TempoMap } from './tempo';
import type { Note, Track } from './types';

/** Whether the notes of `track` are heard, given every track's mute / solo state. */
export function isAudible(track: Track | undefined, tracks: readonly Track[]): boolean {
	if (!track) return true;
	return tracks.some((t) => t.solo) ? track.solo : !track.mute;
}

/**
 * Converts editor notes into what the synthesis engine consumes: absolute
 * times in milliseconds and a flat pitch contour. Muted tracks are left out.
 * `ids[i]` is the id of `notes[i]`, so that reports from the engine can be
 * mapped back.
 */
export function toEngineNotes(
	source: readonly Note[],
	tempoMap: TempoMap,
	tracks: readonly Track[] = [],
	/** The alias to sing for a note; defaults to its lyric. */
	aliasOf: (note: Note) => string = (n) => n.lyric
): { notes: EngineNote[]; ids: string[] } {
	const byId = new Map(tracks.map((t, i) => [t.id, { track: t, index: i }]));
	const audible = source.filter((n) => isAudible(byId.get(n.track)?.track, tracks));
	const sorted = [...audible].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
	const curves = new Map<string, MsStroke[]>();
	for (const t of tracks)
		if (t.pitchCurve?.length) curves.set(t.id, strokesToMs(t.pitchCurve, tempoMap));
	const previous = new Map<string, Note>();
	const notes = sorted.map((n) => {
		const start = tempoMap.tickToMs(n.tick);
		const duration = tempoMap.tickToMs(n.tick + n.length) - start;
		const info = byId.get(n.track);
		// Where the sound begins before the note, it is the previous note's pitch that is sounding.
		const before = previous.get(n.track);
		previous.set(n.track, n);
		const entry =
			before && before.pitch !== n.pitch
				? {
						cents: (before.pitch - n.pitch) * 100,
						until: Math.min(0, tempoMap.tickToMs(before.tick + before.length) - start)
					}
				: null;
		return {
			alias: aliasOf(n),
			pitch: n.pitch,
			start_time: start,
			duration,
			pitchbend: compilePitch(
				n,
				duration,
				curves.has(n.track) ? overlayFor(curves.get(n.track)!, start, duration, n.pitch) : null,
				entry
			),
			flags: n.flags,
			velocity: n.velocity,
			volume: (n.volume * (info?.track.volume ?? 100)) / 100,
			modulation: n.modulation,
			track: info?.index ?? 0
		};
	});
	return { notes, ids: sorted.map((n) => n.id) };
}
