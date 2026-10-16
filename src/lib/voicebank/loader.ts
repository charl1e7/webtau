import JSZip from 'jszip';
import { decodeText, encodeText } from '#lib/io/text';
import { sampleKey, type SampleFile, type Voicebank } from './types';

/** A file found while scanning a folder or archive. */
interface Entry {
	path: string;
	size: number;
	read(): Promise<Uint8Array<ArrayBuffer>>;
	blob(): Promise<Blob>;
}

export type StatusFn = (message: string) => void;

/** cyrb53: fast, well distributed 53-bit string hash. */
export function hashString(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function parseKeyValues(text: string): Map<string, string> {
	const info = new Map<string, string>();
	for (const line of text.split(/\r?\n/)) {
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (key && value) info.set(key, value);
	}
	return info;
}

const endsWith = (path: string, suffix: string) => path.toLowerCase().endsWith(suffix);
const baseName = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path;
const dirName = (path: string) => {
	const p = path.replace(/\\/g, '/');
	return p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
};

export async function buildVoicebank(
	entries: Entry[],
	fallbackName: string,
	fingerprintSeed: string,
	status: StatusFn
): Promise<Voicebank> {
	const wavs = entries.filter((e) => endsWith(e.path, '.wav'));
	if (!wavs.length) throw new Error('No .wav files were found in the selected folder or archive.');

	// --- oto.ini -------------------------------------------------------
	const otoEntries = entries.filter((e) => baseName(e.path).toLowerCase() === 'oto.ini');
	let generatedOto = false;
	let otoText: string;
	if (otoEntries.length) {
		status('Reading oto.ini…');
		const parts = await Promise.all(otoEntries.map(async (e) => decodeText(await e.read())));
		otoText = parts.join('\n');
	} else {
		status('oto.ini not found: generating a default configuration…');
		generatedOto = true;
		const seen = new Set<string>();
		const lines: string[] = [];
		for (const wav of wavs) {
			const file = baseName(wav.path);
			if (seen.has(file.toLowerCase())) continue;
			seen.add(file.toLowerCase());
			lines.push(`${file}=${file.replace(/\.wav$/i, '')},0,0,0,0,0`);
		}
		otoText = lines.join('\n');
	}

	// --- prefix.map ----------------------------------------------------
	const prefixEntry = entries.find((e) => baseName(e.path).toLowerCase() === 'prefix.map');
	const prefixMap = prefixEntry ? encodeText(decodeText(await prefixEntry.read())) : null;

	// --- character.txt + icon -------------------------------------------
	let name = fallbackName;
	let image: string | null = null;
	let character = new Map<string, string>();
	const charEntry = entries.find((e) => baseName(e.path).toLowerCase() === 'character.txt');
	if (charEntry) {
		character = parseKeyValues(decodeText(await charEntry.read()));
		name = character.get('name') ?? name;
		const imageName = character.get('image');
		if (imageName) {
			const wanted = (dirName(charEntry.path) + imageName).replace(/\\/g, '/').toLowerCase();
			const imageEntry =
				entries.find((e) => e.path.replace(/\\/g, '/').toLowerCase() === wanted) ??
				entries.find((e) => baseName(e.path).toLowerCase() === imageName.toLowerCase());
			if (imageEntry) image = URL.createObjectURL(await imageEntry.blob());
		}
	}

	// --- samples ---------------------------------------------------------
	const samples = new Map<string, SampleFile>();
	for (const wav of wavs) {
		const key = sampleKey(wav.path);
		if (!samples.has(key))
			samples.set(key, { path: wav.path, key, size: wav.size, read: wav.read });
	}

	const fingerprint = hashString(
		fingerprintSeed +
			'|' +
			[...samples.values()]
				.map((s) => `${s.key}:${s.size}`)
				.sort()
				.join(',')
	);

	return {
		id: fingerprint,
		name,
		image,
		character,
		oto: encodeText(otoText) as Uint8Array<ArrayBuffer>,
		generatedOto,
		prefixMap: prefixMap as Uint8Array<ArrayBuffer> | null,
		samples,
		aliases: [],
		aliasFile: new Map()
	};
}

// ---- sources ---------------------------------------------------------------

async function entriesFromZip(file: File, status: StatusFn): Promise<Entry[]> {
	status(`Opening ${file.name}…`);
	const zip = await JSZip.loadAsync(file, {
		decodeFileName: (bytes) =>
			Array.isArray(bytes) ? bytes.join('') : decodeText(new Uint8Array(bytes as Uint8Array))
	});
	const entries: Entry[] = [];
	zip.forEach((path, zipEntry) => {
		if (zipEntry.dir || path.startsWith('__MACOSX/')) return;
		entries.push({
			path,
			// Uncompressed size is a good cache discriminator and is stored in the central directory.
			size:
				(zipEntry as unknown as { _data?: { uncompressedSize?: number } })._data
					?.uncompressedSize ?? 0,
			read: () => zipEntry.async('uint8array') as Promise<Uint8Array<ArrayBuffer>>,
			blob: () => zipEntry.async('blob')
		});
	});
	return entries;
}

function entriesFromFiles(files: File[]): Entry[] {
	return files.map((file) => ({
		path: file.webkitRelativePath || file.name,
		size: file.size,
		read: async () => new Uint8Array(await file.arrayBuffer()),
		blob: async () => file
	}));
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
	// readEntries returns at most ~100 entries per call.
	const all: FileSystemEntry[] = [];
	for (;;) {
		const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
			reader.readEntries(resolve, reject)
		);
		if (!batch.length) return all;
		all.push(...batch);
	}
}

async function filesFromDirectory(dir: FileSystemDirectoryEntry, prefix = ''): Promise<File[]> {
	const out: File[] = [];
	for (const entry of await readAllEntries(dir.createReader())) {
		if (entry.isFile) {
			const file = await new Promise<File>((res, rej) =>
				(entry as FileSystemFileEntry).file(res, rej)
			);
			Object.defineProperty(file, 'webkitRelativePath', {
				value: `${prefix}${dir.name}/${file.name}`
			});
			out.push(file);
		} else if (entry.isDirectory) {
			out.push(
				...(await filesFromDirectory(entry as FileSystemDirectoryEntry, `${prefix}${dir.name}/`))
			);
		}
	}
	return out;
}

const stem = (name: string) => name.replace(/\.zip$/i, '');

/** Loads a voicebank from a file picker result (a zip, or a folder's files). */
export async function loadFromFileList(files: File[], status: StatusFn): Promise<Voicebank> {
	if (!files.length) throw new Error('Nothing was selected.');
	const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
	if (zip && files.length === 1) {
		const entries = await entriesFromZip(zip, status);
		return buildVoicebank(entries, stem(zip.name), `${zip.name}:${zip.size}`, status);
	}
	const root = files[0].webkitRelativePath?.split('/')[0] || 'voicebank';
	status(`Reading folder “${root}”…`);
	return buildVoicebank(entriesFromFiles(files), root, root, status);
}

/**
 * Loads a voicebank from a dropped file-system entry. The entry must be taken
 * from the drop event synchronously (`item.webkitGetAsEntry()`).
 */
export async function loadFromEntry(entry: FileSystemEntry, status: StatusFn): Promise<Voicebank> {
	if (entry.isFile) {
		const file = await new Promise<File>((res, rej) =>
			(entry as FileSystemFileEntry).file(res, rej)
		);
		return loadFromFileList([file], status);
	}
	status(`Reading folder “${entry.name}”…`);
	const files = await filesFromDirectory(entry as FileSystemDirectoryEntry);
	return buildVoicebank(entriesFromFiles(files), entry.name, entry.name, status);
}
