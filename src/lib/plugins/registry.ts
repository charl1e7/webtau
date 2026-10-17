import { parseLyric } from '#lib/core/lyric-syntax';
import { syllableKey } from '#lib/core/kana';
import { lastVowel } from '#lib/voicebank/alias-index';
import type {
	Candidate,
	Plugin,
	PluginCommand,
	ResolveContext,
	Resolution,
	SuggestContext,
	Suggestion
} from './api';

/** Holds the plugins and runs their hooks. Pure: no application state in here. */
export class PluginRegistry {
	private readonly plugins = new Map<string, Plugin>();
	/** Ids that are switched off (the app keeps this in its settings). */
	disabled: ReadonlySet<string> = new Set();
	/** Bumped when the set of active plugins changes, so that cached results can be dropped. */
	version = 0;

	register(plugin: Plugin): this {
		this.plugins.set(plugin.id, plugin);
		this.version++;
		return this;
	}

	unregister(id: string) {
		if (this.plugins.delete(id)) this.version++;
	}

	setDisabled(ids: Iterable<string>) {
		this.disabled = new Set(ids);
		this.version++;
	}

	all(): Plugin[] {
		return [...this.plugins.values()].sort(
			(a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name)
		);
	}

	active(): Plugin[] {
		return this.all().filter((p) => !this.disabled.has(p.id));
	}

	candidates(lyric: string, ctx: ResolveContext): Candidate[] {
		const out: Candidate[] = [];
		for (const p of this.active()) {
			try {
				if (p.candidates) out.push(...p.candidates(lyric, ctx));
			} catch (error) {
				console.warn(`[plugin ${p.id}] candidates failed`, error);
			}
		}
		// Best first; stable for equal scores (plugin order).
		return out
			.map((c, i) => ({ c, i }))
			.sort((a, b) => b.c.score - a.c.score || a.i - b.i)
			.map((x) => x.c);
	}

	suggest(query: string, ctx: SuggestContext): Suggestion[] {
		const best = new Map<string, Suggestion>();
		for (const p of this.active()) {
			try {
				for (const s of p.suggest?.(query, ctx) ?? []) {
					const had = best.get(s.alias);
					if (!had || s.rank < had.rank) best.set(s.alias, { ...had, ...s });
					else if (s.hint && !had.hint) had.hint = s.hint;
				}
			} catch (error) {
				console.warn(`[plugin ${p.id}] suggest failed`, error);
			}
		}
		return [...best.values()]
			.sort(
				(a, b) =>
					a.rank - b.rank || a.alias.length - b.alias.length || a.alias.localeCompare(b.alias)
			)
			.slice(0, ctx.limit);
	}

	commands(): (PluginCommand & { plugin: string })[] {
		return this.active().flatMap((p) => (p.commands ?? []).map((c) => ({ ...c, plugin: p.id })));
	}
}

/**
 * Turns a note's lyric into the alias to sing. Order: the lyric grammar (rest,
 * continuation, [hint]), the lyric exactly as typed, then what the plugins
 * propose. Only candidates that really exist in the voicebank are applied.
 */
export function resolveLyric(
	lyric: string,
	ctx: ResolveContext,
	registry: PluginRegistry
): Resolution {
	const parsed = parseLyric(lyric);
	if (parsed.kind === 'rest') return { status: 'rest', alias: 'R' };
	if (parsed.kind === 'extend') {
		return ctx.prev
			? { status: 'mapped', alias: ctx.prev.alias, why: 'continues the previous note' }
			: { status: 'missing', alias: '', suggestions: [] };
	}

	if (parsed.hint) {
		const hit = ctx.index.find(parsed.hint, ctx.pitch);
		if (hit) return { status: 'exact', alias: parsed.hint };
	}
	const text = parsed.text || parsed.hint || '';
	if (!text) return { status: 'missing', alias: '', suggestions: [] };

	// In a plain bank a lyric that exists is used as it is. A VCV bank wants the alias that
	// starts with the previous vowel even when a bare syllable exists, so plugins decide first.
	const bare = ctx.index.has(text, ctx.pitch);
	if (bare && ctx.index.style !== 'vcv') return { status: 'exact', alias: text };

	const candidates = registry.candidates(text, ctx);
	const seen = new Set<string>();
	const usable: Candidate[] = [];
	for (const c of candidates) {
		if (seen.has(c.alias) || !ctx.index.has(c.alias, ctx.pitch)) continue;
		seen.add(c.alias);
		usable.push(c);
	}
	const auto = usable.find((c) => c.auto !== false);
	if (auto) {
		const same = auto.alias.toLowerCase() === text.toLowerCase();
		return {
			status: same ? 'exact' : 'mapped',
			alias: auto.alias,
			why: same ? undefined : auto.why
		};
	}
	if (bare) return { status: 'exact', alias: text };
	return { status: 'missing', alias: text, suggestions: usable.slice(0, 6) };
}

/** What the next note of a track needs to know about this one. */
export function continuity(resolution: Resolution): ResolveContext['prev'] {
	if (resolution.status === 'rest' || resolution.status === 'missing' || !resolution.alias)
		return null;
	const core = resolution.alias.replace(/^\S{1,2} (?=\S)/, '');
	const key = syllableKey(core);
	return { alias: resolution.alias, key, vowel: lastVowel(key) };
}
