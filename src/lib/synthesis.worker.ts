import { WSynthEngineClient } from './wsynth-client.svelte';
import type { ProjectInfo } from './types';

let client: WSynthEngineClient | null = null;
let enginePtr: number | null = null;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        switch (type) {
            case 'init':
                if (!client) {
                    client = await WSynthEngineClient.create();
                    enginePtr = client.createEngine();
                    if (!enginePtr) throw new Error("Failed to create engine in worker.");
                    self.postMessage({ type: 'init_done' });
                }
                break;

            case 'load_oto':
                if (!client || !enginePtr) throw new Error("Engine is not initialized in worker.");
                const otoSuccess = await client.loadOto(enginePtr, payload.data);
                if (!otoSuccess) throw new Error("Failed to load OTO in worker.");
                break;
            
            case 'load_prefix_map':
                if (!client || !enginePtr || !payload.data) break;
                await client.loadPrefixMap(enginePtr, payload.data);
                break;

            case 'cache_features':
                if (!client || !enginePtr) throw new Error("Engine is not initialized in worker.");
                await client.cacheFeatures(enginePtr, payload.filename, payload.featuresData);
                break;
            
            case 'synthesize':
                if (!client || !enginePtr) throw new Error("Engine is not initialized in worker.");
                self.postMessage({ type: 'synthesis_started' });
                const wavBytes = await client.synthesizeProject(enginePtr, payload.projectData);
                if (!wavBytes) throw new Error("Synthesis did not return data in worker.");
                self.postMessage({ type: 'synthesis_done', payload: { wavBytes } }, [wavBytes.buffer]);
                break;
        }
    } catch (error) {
        self.postMessage({ type: 'error', payload: { message: (error as Error).message } });
    }
};