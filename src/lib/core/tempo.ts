import { PPQ, type TempoChange } from './types';

/**
 * Converts between musical time (ticks) and wall-clock time (ms) for a
 * piecewise-constant tempo curve.
 */
export class TempoMap {
	readonly changes: readonly TempoChange[];
	private readonly msAt: number[];

	constructor(changes: readonly TempoChange[]) {
		const sorted = [...changes]
			.filter((c) => Number.isFinite(c.bpm) && c.bpm > 0)
			.sort((a, b) => a.tick - b.tick);
		// One change per tick, the last one wins; the map always starts at tick 0.
		const unique: TempoChange[] = [];
		for (const c of sorted) {
			if (unique.length && unique[unique.length - 1].tick === c.tick) unique.pop();
			unique.push({ tick: Math.max(0, c.tick), bpm: c.bpm });
		}
		if (!unique.length) unique.push({ tick: 0, bpm: 120 });
		if (unique[0].tick > 0) unique.unshift({ tick: 0, bpm: unique[0].bpm });
		this.changes = unique;

		this.msAt = [0];
		for (let i = 1; i < unique.length; i++) {
			const prev = unique[i - 1];
			this.msAt.push(this.msAt[i - 1] + ((unique[i].tick - prev.tick) * 60000) / (prev.bpm * PPQ));
		}
	}

	get firstBpm(): number {
		return this.changes[0].bpm;
	}

	private indexForTick(tick: number): number {
		let lo = 0;
		let hi = this.changes.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.changes[mid].tick <= tick) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	bpmAt(tick: number): number {
		return this.changes[this.indexForTick(tick)].bpm;
	}

	tickToMs(tick: number): number {
		const i = this.indexForTick(tick);
		const c = this.changes[i];
		return this.msAt[i] + ((tick - c.tick) * 60000) / (c.bpm * PPQ);
	}

	msToTick(ms: number): number {
		let lo = 0;
		let hi = this.msAt.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.msAt[mid] <= ms) lo = mid;
			else hi = mid - 1;
		}
		const c = this.changes[lo];
		return c.tick + ((ms - this.msAt[lo]) * c.bpm * PPQ) / 60000;
	}
}
