/** Linear undo/redo stack over immutable snapshots. */
export class History<T> {
	private past: T[] = [];
	private future: T[] = [];

	constructor(private readonly limit = 200) {}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	/** Records `previous` as the state to return to on undo. */
	record(previous: T): void {
		this.past.push(previous);
		if (this.past.length > this.limit) this.past.shift();
		this.future = [];
	}

	undo(current: T): T | undefined {
		const prev = this.past.pop();
		if (prev === undefined) return undefined;
		this.future.push(current);
		return prev;
	}

	redo(current: T): T | undefined {
		const next = this.future.pop();
		if (next === undefined) return undefined;
		this.past.push(current);
		return next;
	}

	clear(): void {
		this.past = [];
		this.future = [];
	}
}
