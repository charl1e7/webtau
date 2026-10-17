import { syllableKey } from '#lib/core/kana';
import type { Plugin } from '../api';

/** Near misses ("kya" for "kyo"): offered in the lyric doctor, never applied on their own. */
export const fuzzyPlugin: Plugin = {
	id: 'core.near-match',
	name: 'Near matches',
	description:
		'Proposes the closest alias (one letter off) for lyrics the voicebank does not have. Only suggested, never applied silently.',
	priority: 100,

	candidates(lyric, { index }) {
		const key = syllableKey(lyric.replace(/^\S{1,2} (?=\S)/, ''));
		if (key.length < 2) return [];
		return index
			.nearest(key, 1)
			.slice(0, 4)
			.map(({ entry, distance }) => ({
				alias: entry.base,
				score: 0.5 - 0.1 * distance,
				why: 'similar',
				auto: false
			}));
	}
};
