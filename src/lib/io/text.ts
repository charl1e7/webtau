/**
 * Decodes text that may be UTF-8 or a legacy Japanese code page (Shift-JIS),
 * which is what most UTAU files use.
 */
export function decodeText(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
	} catch {
		return new TextDecoder('shift-jis').decode(bytes);
	}
}

export function encodeText(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}
