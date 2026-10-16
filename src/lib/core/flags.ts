/** Helpers for UTAU flag strings such as "g-5B30t100". */

export function getFlag(flags: string, name: string): number | undefined {
	const m = new RegExp(`${name}(-?\\d+(?:\\.\\d+)?)`).exec(flags);
	return m ? Number(m[1]) : undefined;
}

/** Sets (or removes, when `value` is undefined) a numeric flag, keeping the others. */
export function setFlag(flags: string, name: string, value: number | undefined): string {
	const re = new RegExp(`${name}-?\\d+(?:\\.\\d+)?`, 'g');
	const rest = flags.replace(re, '');
	return value === undefined ? rest : rest + `${name}${Math.round(value * 100) / 100}`;
}
