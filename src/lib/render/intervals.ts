/** Half-open stretches of time in milliseconds: [start, end). */
export interface Interval {
	start: number;
	end: number;
}

/** Sorted, non-overlapping, non-touching version of the intervals (empty ones dropped). */
export function union(intervals: readonly Interval[]): Interval[] {
	const sorted = intervals
		.filter((i) => i.end > i.start)
		.map((i) => ({ ...i }))
		.sort((a, b) => a.start - b.start);
	const out: Interval[] = [];
	for (const i of sorted) {
		const last = out[out.length - 1];
		if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
		else out.push(i);
	}
	return out;
}

/** What is left of [from, to) after removing `busy`. */
export function complement(busy: readonly Interval[], from: number, to: number): Interval[] {
	const out: Interval[] = [];
	let cursor = from;
	for (const b of union(busy)) {
		if (b.end <= cursor) continue;
		if (b.start >= to) break;
		if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, to) });
		cursor = Math.max(cursor, b.end);
		if (cursor >= to) break;
	}
	if (cursor < to) out.push({ start: cursor, end: to });
	return out;
}

/** The parts of `a` that are not in `b`. */
export function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
	const out: Interval[] = [];
	for (const i of union(a)) out.push(...complement(b, i.start, i.end));
	return out;
}

/** The end of the interval that contains `at` (or `at` itself when none does). Intervals must be a `union`. */
export function endOfRunAt(intervals: readonly Interval[], at: number): number {
	// Binary search: the last interval starting at or before `at`.
	let lo = 0;
	let hi = intervals.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (intervals[mid].start <= at) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found >= 0 && intervals[found].end > at ? intervals[found].end : at;
}
