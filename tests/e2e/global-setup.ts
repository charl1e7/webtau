import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';

export const VOICEBANK_ZIP = path.resolve('tests/.tmp/testbank.zip');
const SR = 44100;

/** 16-bit mono WAV of a vowel-like tone (harmonics shaped by two formants). */
function wav(seconds: number, formants: [number, number][], noisyAttack: boolean): Buffer {
	const n = Math.floor(seconds * SR);
	const buf = Buffer.alloc(44 + n * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write('WAVEfmt ', 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(SR, 24);
	buf.writeUInt32LE(SR * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(n * 2, 40);
	let seed = 1;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const f0 = 220 * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * t));
		let v = 0;
		for (let h = 1; h <= 24; h++) {
			const hf = h * f0;
			if (hf > SR / 2 - 1000) break;
			const gain = formants.reduce((s, [fm, bw]) => s + Math.exp(-(((hf - fm) / bw) ** 2)), 0);
			v += (gain * Math.sin(2 * Math.PI * hf * t)) / h ** 0.3;
		}
		const env = Math.min(1, t / 0.03) * Math.min(1, (seconds - t) / 0.05);
		let s = 0.2 * v * env;
		if (noisyAttack && t < 0.07) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			s += 0.15 * ((seed >>> 16) / 32768 - 1) * (1 - t / 0.07);
		}
		buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 30000), 44 + i * 2);
	}
	return buf;
}

/** Builds a small synthetic UTAU voicebank (25 samples) once for all tests. */
export default async function globalSetup() {
	const vowels: Record<string, [number, number][]> = {
		a: [
			[800, 200],
			[1200, 200]
		],
		i: [
			[300, 100],
			[2300, 200]
		],
		u: [
			[350, 100],
			[900, 150]
		],
		e: [
			[500, 120],
			[1800, 200]
		],
		o: [
			[500, 120],
			[900, 150]
		]
	};
	const zip = new JSZip();
	const oto: string[] = [];
	for (const [v, f] of Object.entries(vowels)) {
		zip.file(`testbank/${v}.wav`, wav(1.0, f, false));
		oto.push(`${v}.wav=${v},0,0,0,0,0`);
		for (const c of ['k', 's', 't', 'm']) {
			zip.file(`testbank/${c}${v}.wav`, wav(0.8, f, true));
			oto.push(`${c}${v}.wav=${c}${v},0,90,-120,40,20`);
		}
	}
	zip.file('testbank/oto.ini', oto.join('\n'));
	zip.file('testbank/character.txt', 'name=Test Bank\nauthor=Tests\n');
	fs.mkdirSync(path.dirname(VOICEBANK_ZIP), { recursive: true });
	fs.writeFileSync(
		VOICEBANK_ZIP,
		await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
	);
}
