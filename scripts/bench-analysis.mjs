import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Usage: node scripts/bench-analysis.mjs <dir with w-synth.js> [seconds=3] [old|new]
const dir = process.argv[2] ?? 'src/lib/engine/wasm';
const Mod = (await import(pathToFileURL(resolve(dir, 'w-synth.js')).href)).default;
const m = await Mod();
const api = {
	analyze: m.cwrap('wsynth_analyze_wav', 'number', ['number', 'number', 'number']),
	free: m.cwrap('wsynth_free_buffer', null, ['number'])
};
function wav(/** @type {number} */ seconds) {
	const sr = 44100,
		n = Math.floor(seconds * sr);
	const buf = Buffer.alloc(44 + n * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write('WAVEfmt ', 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(sr, 24);
	buf.writeUInt32LE(sr * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(n * 2, 40);
	let seed = 1;
	for (let i = 0; i < n; i++) {
		const t = i / sr;
		let v = 0;
		const f0 = 220 + 10 * Math.sin(t * 5);
		for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
		seed = (seed * 1664525 + 1013904223) >>> 0;
		const noise = (seed >>> 16) / 32768 - 1;
		buf.writeInt16LE(Math.round((0.25 * v + 0.02 * noise) * 20000), 44 + i * 2);
	}
	return buf;
}
const secs = Number(process.argv[3] || 3);
const w = wav(secs);
const p = m._malloc(w.length);
m.HEAPU8.set(w, p);
const modes = process.argv[4] === 'old' ? [0] : [0, 1];
for (const mode of modes) {
	for (let rep = 0; rep < 3; rep++) {
		const t = performance.now();
		const r = api.analyze(p, w.length, mode);
		const dt = performance.now() - t;
		const len = m.getValue(r + 4, 'i32');
		console.log(`${secs}s mode ${mode}: ${dt.toFixed(0)} ms, ${len} bytes`);
		api.free(r);
	}
}
console.log('wasm heap after:', (m.HEAPU8.length / 1048576).toFixed(0), 'MB');
