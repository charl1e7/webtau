let counter = 0;

/** Short unique id; stable enough for UI keys and selection sets. */
export function uid(): string {
	counter = (counter + 1) % 0xffffff;
	const rand =
		typeof crypto !== 'undefined' && 'getRandomValues' in crypto
			? crypto.getRandomValues(new Uint32Array(1))[0]
			: Math.floor(Math.random() * 0xffffffff);
	return rand.toString(36) + counter.toString(36);
}
