import { syllableKey } from '#lib/core/kana';

/**
 * Read-only view of what a voicebank can sing, independent of how it is stored.
 * Plugins that turn lyrics into aliases work against this, not against oto.ini
 * details, so that another kind of voicebank only has to provide an index.
 */

/** One alias, split into the parts that matter for matching lyrics. */
export interface AliasEntry {
	/** The alias exactly as the voicebank spells it. */
	alias: string;
	/** The alias without the prefix/suffix that prefix.map adds for some pitches. */
	base: string;
	/** For VCV banks ("a ら"): the previous vowel ("a") or "-" at a phrase start; otherwise null. */
	lead: string | null;
	/** The syllable itself ("ら"). */
	core: string;
	/** Canonical key of the syllable (see syllableKey). */
	key: string;
}

export interface PitchAffix {
	prefix: string;
	suffix: string;
}

export type AliasStyle = 'plain' | 'vcv';

const VOWEL_LEADS = new Set(['a', 'i', 'u', 'e', 'o', 'n', '-', 'r']);

/** "C4" / "C#4" / "Db4" / "60" → MIDI note number (C4 = 60), like the engine reads prefix.map. */
export function parsePitchName(name: string): number | null {
	const s = name.trim();
	if (/^-?\d+$/.test(s)) return Number(s);
	const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s);
	if (!m) return null;
	const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as 'c'];
	return (Number(m[3]) + 1) * 12 + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** `C4=prefix<TAB>suffix` lines; a value without a tab is a suffix. */
export function parsePrefixMap(text: string): Map<number, PitchAffix> {
	const map = new Map<number, PitchAffix>();
	for (const line of text.split(/\r?\n/)) {
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const pitch = parsePitchName(line.slice(0, eq));
		if (pitch === null) continue;
		const value = line.slice(eq + 1);
		const tab = value.indexOf('\t');
		map.set(
			pitch,
			tab >= 0
				? { prefix: value.slice(0, tab), suffix: value.slice(tab + 1) }
				: { prefix: '', suffix: value }
		);
	}
	return map;
}

const fold = (s: string) => s.trim().toLowerCase();

export function lastVowel(key: string): string | null {
	const c = key[key.length - 1];
	if (c && 'aiueo'.includes(c)) return c;
	return c === 'n' ? 'n' : null;
}

export function editDistance(a: string, b: string, limit = 3): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			const v = Math.min(
				prev[j] + 1,
				row[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
			row.push(v);
			best = Math.min(best, v);
		}
		if (best > limit) return limit + 1;
		prev = row;
	}
	return prev[b.length];
}

export class AliasIndex {
	readonly aliases: readonly string[];
	readonly entries: readonly AliasEntry[];
	readonly style: AliasStyle;
	private readonly set: Map<string, string>;
	private readonly affixes: [number, PitchAffix][];
	private readonly keys = new Map<string, AliasEntry[]>();

	constructor(aliases: Iterable<string>, prefixMap: string | null = null) {
		this.aliases = [...new Set(aliases)];
		this.set = new Map(this.aliases.map((a) => [fold(a), a]));
		this.affixes = prefixMap ? [...parsePrefixMap(prefixMap)].sort((a, b) => a[0] - b[0]) : [];

		const affixList = this.affixes
			.map(([, a]) => a)
			.filter((a) => a.prefix || a.suffix)
			.sort((a, b) => b.prefix.length + b.suffix.length - (a.prefix.length + a.suffix.length));

		// VCV banks write most aliases as "<vowel> <syllable>".
		const vcvLike = this.aliases.filter((a) => {
			const m = /^(\S{1,2}) (\S+)$/.exec(a);
			return m && VOWEL_LEADS.has(syllableKey(m[1]));
		}).length;
		this.style = this.aliases.length && vcvLike / this.aliases.length >= 0.2 ? 'vcv' : 'plain';

		this.entries = this.aliases.map((alias) => {
			let base = alias;
			for (const a of affixList) {
				if (
					alias.startsWith(a.prefix) &&
					alias.endsWith(a.suffix) &&
					alias.length > a.prefix.length + a.suffix.length
				) {
					base = alias.slice(a.prefix.length, alias.length - a.suffix.length);
					break;
				}
			}
			let lead: string | null = null;
			let core = base;
			if (this.style === 'vcv') {
				const m = /^(\S{1,2}) (\S+)$/.exec(base);
				if (m && VOWEL_LEADS.has(syllableKey(m[1]))) {
					lead = syllableKey(m[1]);
					core = m[2];
				}
			}
			const entry: AliasEntry = { alias, base, lead, core, key: syllableKey(core) };
			const list = this.keys.get(entry.key);
			if (list) list.push(entry);
			else this.keys.set(entry.key, [entry]);
			return entry;
		});
	}

	affixAt(pitch: number): PitchAffix | null {
		let found: PitchAffix | null = null;
		for (const [from, affix] of this.affixes) {
			if (from <= pitch) found = affix;
			else break;
		}
		return found;
	}

	/**
	 * The alias the engine would actually play for `alias` on `pitch` (prefix.map
	 * applied the way the engine does it), or null when the voicebank has none.
	 */
	find(alias: string, pitch = 60): string | null {
		const affix = this.affixAt(pitch);
		if (affix) {
			const hit = this.set.get(fold(`${affix.prefix}${alias}${affix.suffix}`));
			if (hit) return hit;
		}
		return this.set.get(fold(alias)) ?? null;
	}

	has(alias: string, pitch = 60): boolean {
		return this.find(alias, pitch) !== null;
	}

	byKey(key: string): readonly AliasEntry[] {
		return this.keys.get(key) ?? [];
	}

	/** Entries whose key is within `maxDistance` edits of `key`, nearest first. */
	nearest(key: string, maxDistance = 1): { entry: AliasEntry; distance: number }[] {
		const found: { entry: AliasEntry; distance: number }[] = [];
		for (const [k, list] of this.keys) {
			if (k === key) continue;
			const distance = editDistance(key, k, maxDistance);
			if (distance <= maxDistance) for (const entry of list) found.push({ entry, distance });
		}
		return found.sort(
			(a, b) => a.distance - b.distance || a.entry.alias.length - b.entry.alias.length
		);
	}
}

export const EMPTY_INDEX = new AliasIndex([]);
