import WSynthModule from './w-synth';
import type { ProjectInfo } from './types';

export interface IWasmApi {
    init: () => void;
    createEngine: () => number;
    destroyEngine: (enginePtr: number) => void;
    loadOto: (enginePtr: number, dataPtr: number, dataLen: number) => boolean;
    loadPrefixMap: (enginePtr: number, dataPtr: number, dataLen: number) => boolean;
    synthesizeProject: (enginePtr: number, jsonStrPtr: number) => number;
    freeBuffer: (bufferPtr: number) => void;
    analyzeWav: (dataPtr: number, dataLen: number) => number;
    cacheFeatures: (enginePtr: number, filename: string, dataPtr: number, dataLen: number) => boolean;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    allocateUTF8: (str: string) => number;
    getValue: (ptr: number, type: string) => any;
    HEAPU8: Uint8Array; 
}

export class WSynthEngineClient {
    private _module: Awaited<ReturnType<typeof WSynthModule>> | null = null;
    private _api: IWasmApi | null = null;

    private constructor() {}

    static async create(): Promise<WSynthEngineClient> {
        const client = new WSynthEngineClient();
        client._module = await WSynthModule();
        const Module = client._module as any;
        client._api = {
            init: Module.cwrap('wsynth_init', null, []),
            createEngine: Module.cwrap('wsynth_engine_create', 'number', []),
            destroyEngine: Module.cwrap('wsynth_engine_destroy', null, ['number']),
            loadOto: Module.cwrap('wsynth_engine_load_oto', 'boolean', ['number', 'number', 'number']),
            loadPrefixMap: Module.cwrap('wsynth_engine_load_prefix_map', 'boolean', ['number', 'number', 'number']),
            synthesizeProject: Module.cwrap('wsynth_engine_synthesize_project', 'number', ['number', 'number']),
            freeBuffer: Module.cwrap('wsynth_free_buffer', null, ['number']),
            analyzeWav: Module.cwrap('wsynth_analyze_wav', 'number', ['number', 'number']),
            cacheFeatures: Module.cwrap('wsynth_engine_cache_features', 'boolean', ['number', 'string', 'number', 'number']),
            _malloc: Module._malloc,
            _free: Module._free,
            allocateUTF8: Module.allocateUTF8,
            getValue: Module.getValue,
            get HEAPU8() { return Module.HEAPU8; },
        };
        client._api.init();
        return client;
    }

    createEngine(): number | null {
        if (!this._api) return null;
        const ptr = this._api.createEngine();
        return ptr === 0 ? null : ptr;
    }
    
    destroyEngine(enginePtr: number): void {
        this._api?.destroyEngine(enginePtr);
    }

    private async _loadData(
        loaderFunc: (enginePtr: number, dataPtr: number, dataLen: number) => boolean,
        enginePtr: number,
        data: Uint8Array
    ): Promise<boolean> {
        if (!this._api) return false;
        let bufferPtr = 0;
        try {
            bufferPtr = this._api._malloc(data.length);
            if (bufferPtr === 0) return false;
            this._api.HEAPU8.set(data, bufferPtr);
            return loaderFunc(enginePtr, bufferPtr, data.length);
        } finally {
            if (bufferPtr !== 0) this._api._free(bufferPtr);
        }
    }

    async loadOto(enginePtr: number, data: Uint8Array): Promise<boolean> {
        return this._loadData(this._api!.loadOto, enginePtr, data);
    }

    async loadPrefixMap(enginePtr: number, data: Uint8Array): Promise<boolean> {
        return this._loadData(this._api!.loadPrefixMap, enginePtr, data);
    }

    async cacheFeatures(enginePtr: number, filename: string, featuresData: Uint8Array): Promise<boolean> {
        if (!this._api) return false;
        let bufferPtr = 0;
        try {
            bufferPtr = this._api._malloc(featuresData.length);
            if (bufferPtr === 0) return false;
            this._api.HEAPU8.set(featuresData, bufferPtr);
            return this._api.cacheFeatures(enginePtr, filename, bufferPtr, featuresData.length);
        } finally {
            if (bufferPtr !== 0) this._api._free(bufferPtr);
        }
    }

    async synthesizeProject(enginePtr: number, project: ProjectInfo): Promise<Uint8Array | null> {
        if (!this._api) return null;
        const jsonStr = JSON.stringify(project);
        let jsonStrPtr = 0;
        let wasmBufferPtr = 0;
        try {
            jsonStrPtr = this._api.allocateUTF8(jsonStr);
            if (jsonStrPtr === 0) return null;

            wasmBufferPtr = this._api.synthesizeProject(enginePtr, jsonStrPtr);
            if (wasmBufferPtr === 0) return null;

            const audioDataPtr = this._api.getValue(wasmBufferPtr, 'i32');
            const audioDataLen = this._api.getValue(wasmBufferPtr + 4, 'i32');
            if (audioDataPtr === 0 || audioDataLen === 0) return null;

            const audioBytes = this._api.HEAPU8.slice(audioDataPtr, audioDataPtr + audioDataLen);
            return audioBytes;
        } finally {
            if (jsonStrPtr !== 0) this._api._free(jsonStrPtr);
            if (wasmBufferPtr !== 0) this._api.freeBuffer(wasmBufferPtr);
        }
    }
}