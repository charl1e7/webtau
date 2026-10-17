/** One audio file of a voicebank; its bytes are read only when needed. */
export interface SampleFile {
	/** Path inside the voicebank, as stored in the archive / folder. */
	path: string;
	/** Lowercase file name without directories: how oto.ini entries refer to it. */
	key: string;
	/** Compressed or on-disk size, for cache fingerprints. */
	size: number;
	read(): Promise<Uint8Array<ArrayBuffer>>;
}

export interface Voicebank {
	/** What kind of voicebank this is; renderers say which kinds they can use. */
	kind: 'utau';
	/** Stable id derived from the contents, used as cache namespace. */
	id: string;
	name: string;
	image: string | null;
	character: Map<string, string>;
	/** UTF-8 oto.ini (all oto files merged) as handed to the engine. */
	oto: Uint8Array<ArrayBuffer>;
	/** True when no oto.ini existed and one was generated from file names. */
	generatedOto: boolean;
	prefixMap: Uint8Array<ArrayBuffer> | null;
	samples: Map<string, SampleFile>;
	/** Alias list, filled in once the engine has parsed the oto. */
	aliases: string[];
	/** alias -> sample key, filled in once the engine has parsed the oto. */
	aliasFile: Map<string, string>;
}

export function sampleKey(path: string): string {
	return (path.replace(/\\/g, '/').split('/').pop() ?? path).toLowerCase();
}
