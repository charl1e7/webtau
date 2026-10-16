/// <reference lib="webworker" />
import { WasmBridge } from './bridge';
import type { AnalyzerReply, AnalyzerRequest } from './protocol';

let bridge: WasmBridge | null = null;

const reply = (msg: AnalyzerReply, transfer: Transferable[] = []) =>
	self.postMessage(msg, transfer);

self.onmessage = async (event: MessageEvent<AnalyzerRequest>) => {
	const msg = event.data;
	if (msg.type === 'init') {
		bridge ??= await WasmBridge.create(msg.module);
		reply({ type: 'ready' });
		return;
	}
	try {
		bridge ??= await WasmBridge.create();
		const features = bridge.analyze(msg.wav, msg.mode);
		reply(
			{ type: 'result', id: msg.id, features, error: features ? undefined : 'Analysis failed' },
			features ? [features.buffer] : []
		);
	} catch (error) {
		reply({
			type: 'result',
			id: msg.id,
			features: null,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
