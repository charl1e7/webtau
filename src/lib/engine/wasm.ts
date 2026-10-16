import wasmUrl from './wasm/w-synth.wasm?url';

let compiled: Promise<WebAssembly.Module> | null = null;

/** Downloads and compiles the engine once; the result is shared with all workers. */
export function compileWasm(): Promise<WebAssembly.Module> {
	compiled ??= (async () => {
		try {
			return await WebAssembly.compileStreaming(fetch(wasmUrl));
		} catch {
			// Servers that do not send application/wasm.
			const response = await fetch(wasmUrl);
			return WebAssembly.compile(await response.arrayBuffer());
		}
	})();
	compiled.catch(() => (compiled = null));
	return compiled;
}
