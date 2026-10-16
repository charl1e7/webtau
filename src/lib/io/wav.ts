/** Encodes mono float PCM as 16-bit WAV with triangular dither. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
	const dataSize = samples.length * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	const ascii = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	ascii(8, 'WAVEfmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii(36, 'data');
	view.setUint32(40, dataSize, true);

	for (let i = 0; i < samples.length; i++) {
		const dither = Math.random() - Math.random(); // TPDF, +-1 LSB
		const v = Math.round(samples[i] * 32767 + dither);
		view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, v)), true);
	}
	return new Uint8Array(buffer);
}
