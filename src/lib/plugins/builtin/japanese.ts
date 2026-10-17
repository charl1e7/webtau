import { hasKana, syllableKey } from '#lib/core/kana';
import type { Candidate, Plugin } from '../api';

/**
 * Japanese script bridge. A lyric written in one script finds the alias that
 * the voicebank writes in another (ra → ら, ラ → ra, si → shi), and in VCV banks
 * the alias that starts with the vowel of the previous note ("a ら").
 */
export const japanesePlugin: Plugin = {
	id: 'ja.script-bridge',
	name: 'Japanese: kana ⇄ romaji, CV / VCV',
	description:
		'Lets "ra", "ら" and "ラ" all find the voicebank’s alias however it is written, and picks the right VCV alias ("a ら") from the previous note.',
	priority: 0,

	candidates(lyric, { index, prev }) {
		const text = lyric.trim();
		const out: Candidate[] = [];
		const add = (alias: string, score: number, why: string) => out.push({ alias, score, why });

		// "a ra" typed for a plain bank: drop the lead and look for the syllable.
		let core = text;
		let typedLead: string | null = null;
		const lead = /^(\S{1,2}) (\S+)$/.exec(text);
		if (lead && /^[aiueon-]$/.test(syllableKey(lead[1]))) {
			typedLead = syllableKey(lead[1]);
			core = lead[2];
		}

		const key = syllableKey(core);
		const entries = index.byKey(key);
		if (!entries.length) return out;

		const want = prev?.vowel ?? '-';
		const rankOf = (lead: string | null) => {
			if (index.style === 'vcv') {
				const goal = typedLead ?? want;
				if (lead === goal) return 3;
				if (lead === '-') return 2;
				if (lead === null) return 2;
				return 1;
			}
			return lead === null ? 3 : 1;
		};
		const script = hasKana(text) !== hasKana(entries[0].core) ? 'script' : 'spelling';
		for (const e of [...entries].sort((a, b) => rankOf(b.lead) - rankOf(a.lead))) {
			const score = 0.9 + rankOf(e.lead) * 0.02 - (typedLead && e.lead !== typedLead ? 0.03 : 0);
			add(e.base, score, script === 'script' ? 'kana ⇄ romaji' : 'same sound');
			if (e.base !== e.alias)
				add(e.alias, score - 0.005, script === 'script' ? 'kana ⇄ romaji' : 'same sound');
		}
		return out;
	}
};
