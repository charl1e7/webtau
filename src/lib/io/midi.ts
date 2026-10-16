import { PPQ, type Note, type TempoChange } from '#lib/core/types';
import { createNote } from '#lib/core/music';
import { sortNotes } from '#lib/core/ops';
import { decodeText } from './text';

export interface MidiTrackInfo {
	index: number;
	name: string;
	noteCount: number;
}

export interface MidiFile {
	ppq: number;
	tempos: TempoChange[];
	tracks: (MidiTrackInfo & { notes: Note[] })[];
}

class Reader {
	pos = 0;
	constructor(readonly b: Uint8Array) {}
	u8() {
		return this.b[this.pos++];
	}
	u16() {
		return (this.u8() << 8) | this.u8();
	}
	u32() {
		return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
	}
	str(n: number) {
		const s = String.fromCharCode(...this.b.subarray(this.pos, this.pos + n));
		this.pos += n;
		return s;
	}
	vlq() {
		let v = 0;
		for (;;) {
			const byte = this.u8();
			v = (v << 7) | (byte & 0x7f);
			if (!(byte & 0x80)) return v;
		}
	}
}

/** Parses a Standard MIDI File (format 0 or 1). */
export function parseMidi(bytes: Uint8Array): MidiFile {
	const r = new Reader(bytes);
	if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file.');
	r.u32();
	r.u16(); // format
	const trackCount = r.u16();
	const division = r.u16();
	if (division & 0x8000) throw new Error('SMPTE time division is not supported.');
	const scale = PPQ / division;
	const toTick = (t: number) => Math.round(t * scale);

	const tempos: TempoChange[] = [];
	const tracks: MidiFile['tracks'] = [];

	for (let t = 0; t < trackCount && r.pos < bytes.length; t++) {
		if (r.str(4) !== 'MTrk') throw new Error('Corrupt MIDI track.');
		const len = r.u32();
		const end = r.pos + len;
		let time = 0;
		let running = 0;
		let name = '';
		const open = new Map<string, { start: number; vel: number }>();
		const notes: Note[] = [];
		const lyrics: { tick: number; text: string }[] = [];

		while (r.pos < end) {
			time += r.vlq();
			let status = r.u8();
			if (status < 0x80) {
				r.pos--;
				status = running;
			} else if (status < 0xf0) {
				running = status;
			}
			if (status === 0xff) {
				const type = r.u8();
				const size = r.vlq();
				const data = bytes.subarray(r.pos, r.pos + size);
				r.pos += size;
				if (type === 0x51 && size === 3) {
					const mpqn = (data[0] << 16) | (data[1] << 8) | data[2];
					tempos.push({ tick: toTick(time), bpm: Math.round((60000000 / mpqn) * 100) / 100 });
				} else if (type === 0x03) name = decodeText(data);
				else if (type === 0x05) lyrics.push({ tick: toTick(time), text: decodeText(data) });
			} else if (status === 0xf0 || status === 0xf7) {
				r.pos += r.vlq();
			} else {
				const kind = status & 0xf0;
				const channel = status & 0x0f;
				const d1 = r.u8();
				const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : r.u8();
				const key = `${channel}:${d1}`;
				if (kind === 0x90 && d2 > 0) {
					open.set(key, { start: time, vel: d2 });
				} else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
					const on = open.get(key);
					if (on) {
						open.delete(key);
						const tick = toTick(on.start);
						notes.push(
							createNote({
								tick,
								length: Math.max(1, toTick(time) - tick),
								pitch: d1,
								lyric: 'a'
							})
						);
					}
				}
			}
			if (r.pos > end) break;
		}
		r.pos = end;

		const sorted = sortNotes(notes);
		for (const l of lyrics) {
			const target = sorted.find((n) => n.tick >= l.tick);
			if (target && target.tick - l.tick < PPQ / 8) {
				target.lyric = l.text.replace(/^[-/\\]/, '').trim() || target.lyric;
			}
		}
		tracks.push({ index: t, name: name || `Track ${t + 1}`, noteCount: sorted.length, notes: sorted });
	}

	if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 });
	return { ppq: division, tempos, tracks };
}

function vlq(n: number): number[] {
	const out = [n & 0x7f];
	while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
	return out;
}

const be = (n: number, bytes: number): number[] =>
	Array.from({ length: bytes }, (_, i) => (n >> (8 * (bytes - 1 - i))) & 0xff);

/** Writes a format-0 MIDI file containing the notes, lyrics and tempo map. */
export function serializeMidi(notes: readonly Note[], tempos: readonly TempoChange[], name: string) {
	type Ev = { tick: number; order: number; bytes: number[] };
	const events: Ev[] = [];
	const text = (type: number, s: string, tick: number) => {
		const data = Array.from(new TextEncoder().encode(s));
		events.push({ tick, order: 0, bytes: [0xff, type, ...vlq(data.length), ...data] });
	};
	text(0x03, name, 0);
	for (const t of tempos) {
		const mpqn = Math.round(60000000 / t.bpm);
		events.push({ tick: t.tick, order: 0, bytes: [0xff, 0x51, 3, ...be(mpqn, 3)] });
	}
	for (const n of notes) {
		if (n.lyric) text(0x05, n.lyric, n.tick);
		events.push({ tick: n.tick, order: 2, bytes: [0x90, n.pitch & 0x7f, 100] });
		events.push({ tick: n.tick + n.length, order: 1, bytes: [0x80, n.pitch & 0x7f, 0] });
	}
	events.sort((a, b) => a.tick - b.tick || a.order - b.order);

	const body: number[] = [];
	let last = 0;
	for (const e of events) {
		body.push(...vlq(e.tick - last), ...e.bytes);
		last = e.tick;
	}
	body.push(0, 0xff, 0x2f, 0);

	return new Uint8Array([
		...Array.from('MThd', (c) => c.charCodeAt(0)),
		...be(6, 4),
		...be(0, 2),
		...be(1, 2),
		...be(PPQ, 2),
		...Array.from('MTrk', (c) => c.charCodeAt(0)),
		...be(body.length, 4),
		...body
	]);
}
