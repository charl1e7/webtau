import { hasKana, kanaToRomaji, romajiToKana, toHiragana, toKatakana } from '#lib/core/kana';
import { isSpecialLyric } from '#lib/core/lyric-syntax';
import type { Plugin, PluginCommand, PluginHost } from '../api';

function convert(host: PluginHost, label: string, fn: (lyric: string) => string | null) {
	const changes = new Map<string, string>();
	for (const n of host.targets) {
		if (isSpecialLyric(n.lyric)) continue;
		const next = fn(n.lyric.trim());
		if (next && next !== n.lyric) changes.set(n.id, next);
	}
	if (!changes.size) return host.toast(`Nothing to convert to ${label}.`);
	host.setLyrics(changes);
	host.toast(`${changes.size} lyric(s) converted to ${label}.`, 'success');
}

const commands: PluginCommand[] = [
	{
		id: 'lyrics.fix',
		label: 'Fix lyrics the voicebank does not have…',
		icon: 'wand',
		enabled: (h) => !!h.index,
		run: (h) => h.openLyricDoctor()
	},
	{
		id: 'lyrics.rewrite',
		label: 'Rewrite lyrics as voicebank aliases',
		icon: 'wand',
		enabled: (h) => !!h.index,
		run: (h) => {
			const changes = new Map<string, string>();
			for (const n of h.targets) {
				const r = h.resolve(n);
				if (r?.status === 'mapped' && r.alias !== n.lyric && !isSpecialLyric(n.lyric))
					changes.set(n.id, r.alias);
			}
			if (!changes.size) return h.toast('Every lyric already matches the voicebank.');
			h.setLyrics(changes);
			h.toast(`${changes.size} lyric(s) rewritten.`, 'success');
		}
	},
	{
		id: 'lyrics.hiragana',
		label: 'Lyrics → hiragana',
		run: (h) =>
			convert(h, 'hiragana', (l) => (hasKana(l) ? toHiragana(l) : (romajiToKana(l) ?? null)))
	},
	{
		id: 'lyrics.katakana',
		label: 'Lyrics → katakana',
		run: (h) =>
			convert(h, 'katakana', (l) => {
				const k = hasKana(l) ? l : romajiToKana(l);
				return k ? toKatakana(k) : null;
			})
	},
	{
		id: 'lyrics.romaji',
		label: 'Lyrics → romaji',
		run: (h) => convert(h, 'romaji', (l) => (hasKana(l) ? kanaToRomaji(l) : null))
	}
];

export const lyricToolsPlugin: Plugin = {
	id: 'core.lyric-tools',
	name: 'Lyric tools',
	description:
		'Edit ▸ Lyrics: fix unknown lyrics, rewrite lyrics as voicebank aliases, convert between hiragana, katakana and romaji.',
	priority: 200,
	commands
};
