// src/lib/wav-analyzer.worker.ts
import WSynthModule from './w-synth';

let wasmApi: {
    analyzeWav: (dataPtr: number, dataLen: number) => number;
    freeBuffer: (bufferPtr: number) => void;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    getValue: (ptr: number, type: string) => any;
    HEAPU8: Uint8Array;
} | null = null;

let sharedWasmModule: WebAssembly.Module | null = null;

async function initWasm(wasmModule?: WebAssembly.Module) {
    if (wasmApi) return;
    const moduleToUse = wasmModule || sharedWasmModule;

    const Module = await WSynthModule(moduleToUse ? { wasmModule: moduleToUse } : {});

    wasmApi = {
        analyzeWav: Module.cwrap('wsynth_analyze_wav', 'number', ['number', 'number']),
        freeBuffer: Module.cwrap('wsynth_free_buffer', null, ['number']),
        _malloc: Module._malloc,
        _free: Module._free,
        getValue: Module.getValue,
        get HEAPU8() { return Module.HEAPU8; },
    };
}

self.onmessage = async (event: MessageEvent) => {
    const { type, filename, wavData, wasmModule } = event.data;

    if (type === 'init_wasm' || wasmModule) {
        if (wasmModule) sharedWasmModule = wasmModule;
        await initWasm(sharedWasmModule!);
        if (type === 'init_wasm') return;
    }

    try {
        if (!wasmApi) {
            await initWasm();
        }
        if (!wasmApi) throw new Error("WASM API not available in worker.");

        const dataPtr = wasmApi._malloc(wavData.length);
        wasmApi.HEAPU8.set(wavData, dataPtr);
        const resultBufferPtr = wasmApi.analyzeWav(dataPtr, wavData.length);
        wasmApi._free(dataPtr);

        if (resultBufferPtr === 0) {
            throw new Error(`[Worker] Analysis failed for ${filename}`);
        }
        const featuresPtr = wasmApi.getValue(resultBufferPtr, 'i32');
        const featuresLen = wasmApi.getValue(resultBufferPtr + 4, 'i32');
        const featuresData = wasmApi.HEAPU8.slice(featuresPtr, featuresPtr + featuresLen);
        wasmApi.freeBuffer(resultBufferPtr);

        self.postMessage({
            status: 'success',
            filename,
            featuresData,
        }, [featuresData.buffer]);

    } catch (error) {
        console.error(`[Worker] Error processing ${filename}:`, error);
        self.postMessage({
            status: 'error',
            filename,
            error: (error as Error).message,
        });
    }
};