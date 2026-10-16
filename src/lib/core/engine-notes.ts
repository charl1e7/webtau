import type { EngineNote } from '#lib/engine/bridge';
import { compilePitch } from './pitch';
import type { TempoMap } from './tempo';
import type { Note } from './types';

/**
 * Converts editor notes into what the synthesis engine consumes: absolute
 * times in milliseconds and a flat pitch contour. `ids[i]` is the id of
 * `notes[i]`, so that reports from the engine can be mapped back.
 */
export function toEngineNotes(
	source: readonly Note[],
	tempoMap: TempoMap
): { notes: EngineNote[]; ids: string[] } {
	const sorted = [...source].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
	const notes = sorted.map((n) => {
		const start = tempoMap.tickToMs(n.tick);
		const duration = tempoMap.tickToMs(n.tick + n.length) - start;
		return {
			alias: n.lyric,
			pitch: n.pitch,
			start_time: start,
			duration,
			pitchbend: compilePitch(n, duration),
			flags: n.flags,
			velocity: n.velocity,
			volume: n.volume,
			modulation: n.modulation
		};
	});
	return { notes, ids: sorted.map((n) => n.id) };
}
