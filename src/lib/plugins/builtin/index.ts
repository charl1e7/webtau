import type { Plugin } from '../api';
import { fuzzyPlugin } from './fuzzy';
import { japanesePlugin } from './japanese';
import { lyricToolsPlugin } from './lyric-tools';
import { searchPlugin } from './search';

/** Everything that ships with the app, in registration order. */
export const BUILTIN_PLUGINS: Plugin[] = [
	searchPlugin,
	japanesePlugin,
	fuzzyPlugin,
	lyricToolsPlugin
];
