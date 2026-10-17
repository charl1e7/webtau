/**
 * Where file formats announce themselves. The File menu and the drop handler
 * read this list, so supporting another format is one `formats.register(...)`
 * call next to its importer and exporter; nothing else needs to change.
 */

export interface FormatMenuItem {
	label: string;
	/** Shortcut text shown in the menu. */
	hint?: string;
	action: () => void | Promise<void>;
}

export interface FormatEntry {
	id: string;
	/** Lower-case extensions with the dot, used to recognize dropped files. */
	extensions: string[];
	/** File ▸ Import entry (opens a file picker). */
	import?: FormatMenuItem;
	/** File ▸ Export entry. */
	export?: FormatMenuItem;
	/** Opens an already chosen file (drag and drop, or after the picker). */
	openFile?: (file: File) => Promise<void>;
}

class FormatRegistry {
	private readonly entries = new Map<string, FormatEntry>();

	register(entry: FormatEntry): this {
		this.entries.set(entry.id, entry);
		return this;
	}

	all(): FormatEntry[] {
		return [...this.entries.values()];
	}

	imports(): (FormatMenuItem & { id: string })[] {
		return this.all().flatMap((f) => (f.import ? [{ id: f.id, ...f.import }] : []));
	}

	exports(): (FormatMenuItem & { id: string })[] {
		return this.all().flatMap((f) => (f.export ? [{ id: f.id, ...f.export }] : []));
	}

	forFile(name: string): FormatEntry | undefined {
		const lower = name.toLowerCase();
		return this.all().find((f) => f.extensions.some((e) => lower.endsWith(e)));
	}
}

export const formats = new FormatRegistry();
