import { otherScript, syllableKey } from '#lib/core/kana';
import type { Plugin, Suggestion } from '../api';

/** The lyric box list: matches by spelling, and across scripts (typing "ra" finds ら). */
export const searchPlugin: Plugin = {
	id: 'core.search',
	name: 'Lyric search',
	description:
		'Suggestions while typing a lyric: by spelling first, then by sound, so "ra" also finds ら and ラ.',
	priority: -100,

	suggest(query, { index, limit }) {
		const q = query.trim();
		const out: Suggestion[] = [];
		const lq = q.toLowerCase();
		const qkey = q ? syllableKey(q) : '';
		for (const e of index.entries) {
			let rank: number;
			if (!q) rank = 5;
			else if (e.alias.toLowerCase().startsWith(lq)) rank = 0;
			else if (qkey && e.key.startsWith(qkey)) rank = e.key === qkey ? 0.5 : 1;
			else if (e.alias.toLowerCase().includes(lq)) rank = 2;
			else if (qkey.length > 1 && e.key.includes(qkey)) rank = 3;
			else continue;
			const reading = otherScript(e.core);
			out.push({
				alias: e.alias,
				rank,
				hint: reading ? (e.lead ? `${e.lead} ${reading}` : reading) : undefined
			});
			if (!q && out.length >= limit) break;
		}
		return out;
	}
};
