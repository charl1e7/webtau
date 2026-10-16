/**
 * Persistent cache of analyzed samples (IndexedDB), so that a voicebank is
 * analyzed only once per browser. Every failure degrades to "no cache".
 */

const DB_NAME = 'webtau-features';
const STORE = 'features';
const BANKS = 'banks';
/** Oldest voicebanks are evicted once the cache grows beyond this. */
const MAX_BYTES = 1.5 * 1024 ** 3;

interface FeatureRow {
	key: string;
	bank: string;
	data: Uint8Array;
}

interface BankRow {
	id: string;
	name: string;
	bytes: number;
	lastUsed: number;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

export class FeatureCache {
	private constructor(private readonly db: IDBDatabase) {}

	static async open(): Promise<FeatureCache | null> {
		try {
			if (typeof indexedDB === 'undefined') return null;
			const req = indexedDB.open(DB_NAME, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				const features = db.createObjectStore(STORE, { keyPath: 'key' });
				features.createIndex('bank', 'bank');
				db.createObjectStore(BANKS, { keyPath: 'id' });
			};
			return new FeatureCache(await promisify(req));
		} catch {
			return null;
		}
	}

	async get(key: string): Promise<Uint8Array | null> {
		try {
			const row = await promisify<FeatureRow | undefined>(
				this.db.transaction(STORE).objectStore(STORE).get(key)
			);
			return row?.data ?? null;
		} catch {
			return null;
		}
	}

	async put(bank: string, key: string, data: Uint8Array): Promise<void> {
		try {
			const tx = this.db.transaction([STORE, BANKS], 'readwrite');
			tx.objectStore(STORE).put({ key, bank, data } satisfies FeatureRow);
			const banks = tx.objectStore(BANKS);
			const row = await promisify<BankRow | undefined>(banks.get(bank));
			if (row) banks.put({ ...row, bytes: row.bytes + data.byteLength });
			await done(tx);
		} catch {
			/* quota exceeded or storage unavailable: the cache is optional */
		}
	}

	/** Marks a voicebank as used and evicts the least recently used ones if needed. */
	async touchBank(id: string, name: string): Promise<void> {
		try {
			const tx = this.db.transaction([BANKS], 'readwrite');
			const store = tx.objectStore(BANKS);
			const row = await promisify<BankRow | undefined>(store.get(id));
			store.put({ id, name, bytes: row?.bytes ?? 0, lastUsed: Date.now() } satisfies BankRow);
			await done(tx);
			await this.evict(id);
		} catch {
			/* ignore */
		}
	}

	private async evict(keep: string): Promise<void> {
		const banks = await promisify<BankRow[]>(
			this.db.transaction(BANKS).objectStore(BANKS).getAll()
		);
		let total = banks.reduce((n, b) => n + b.bytes, 0);
		for (const bank of banks.sort((a, b) => a.lastUsed - b.lastUsed)) {
			if (total <= MAX_BYTES) break;
			if (bank.id === keep) continue;
			await this.deleteBank(bank.id);
			total -= bank.bytes;
		}
	}

	async deleteBank(id: string): Promise<void> {
		const tx = this.db.transaction([STORE, BANKS], 'readwrite');
		const index = tx.objectStore(STORE).index('bank');
		const range = IDBKeyRange.only(id);
		const cursorReq = index.openKeyCursor(range);
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (cursor) {
				tx.objectStore(STORE).delete(cursor.primaryKey);
				cursor.continue();
			}
		};
		tx.objectStore(BANKS).delete(id);
		await done(tx);
	}

	async clear(): Promise<void> {
		try {
			const tx = this.db.transaction([STORE, BANKS], 'readwrite');
			tx.objectStore(STORE).clear();
			tx.objectStore(BANKS).clear();
			await done(tx);
		} catch {
			/* ignore */
		}
	}

	async usage(): Promise<{ bytes: number; banks: number }> {
		try {
			const banks = await promisify<BankRow[]>(
				this.db.transaction(BANKS).objectStore(BANKS).getAll()
			);
			return { bytes: banks.reduce((n, b) => n + b.bytes, 0), banks: banks.length };
		} catch {
			return { bytes: 0, banks: 0 };
		}
	}
}
