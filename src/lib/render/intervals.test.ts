import { describe, expect, it } from 'vitest';
import { complement, endOfRunAt, subtract, union } from './intervals';

const iv = (...pairs: [number, number][]) => pairs.map(([start, end]) => ({ start, end }));

describe('intervals', () => {
	it('merges overlapping and touching intervals and drops empty ones', () => {
		expect(union(iv([5, 8], [0, 2], [2, 4], [7, 10], [20, 20]))).toEqual(iv([0, 4], [5, 10]));
	});

	it('gives what is not covered', () => {
		expect(complement(iv([2, 4], [6, 8]), 0, 10)).toEqual(iv([0, 2], [4, 6], [8, 10]));
		expect(complement(iv([-5, 3], [9, 20]), 0, 10)).toEqual(iv([3, 9]));
		expect(complement([], 0, 10)).toEqual(iv([0, 10]));
		expect(complement(iv([0, 10]), 0, 10)).toEqual([]);
	});

	it('subtracts one set from another', () => {
		expect(subtract(iv([0, 10]), iv([2, 3], [5, 7]))).toEqual(iv([0, 2], [3, 5], [7, 10]));
		expect(subtract(iv([0, 4], [6, 9]), iv([3, 7]))).toEqual(iv([0, 3], [7, 9]));
		expect(subtract(iv([1, 2]), iv([0, 5]))).toEqual([]);
	});

	it('finds how far a stretch of ready time reaches from a point', () => {
		const ready = iv([0, 100], [200, 350]);
		expect(endOfRunAt(ready, 10)).toBe(100);
		expect(endOfRunAt(ready, 100)).toBe(100); // the end is exclusive: nothing ready from there
		expect(endOfRunAt(ready, 150)).toBe(150);
		expect(endOfRunAt(ready, 250)).toBe(350);
		expect(endOfRunAt(ready, 400)).toBe(400);
		expect(endOfRunAt([], 5)).toBe(5);
	});
});
