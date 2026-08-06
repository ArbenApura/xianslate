// OFFLINE LOCAL DATASTORE — A THIN, PROMISE-BASED WRAPPER OVER IndexedDB (NO EXTERNAL DEPS — THE
// ANDROID WEBVIEW'S IndexedDB PERSISTS IN APP DATA ACROSS RESTARTS, AND FIREBASE ALREADY RELIES ON IT).
//
// OBJECT STORES (v1):
//   meta       keyPath 'key'            — SESSION USER, LAST-SYNC TIMES, SCHEMA VERSION
//   toc        keyPath 'bookId'         — PER-BOOK TOC/MANAGE DATA { book, resumeUuid, chapters }
//   chapters   keyPath 'uuid'           — FULL ChapterView (SOURCE + TARGET TEXT) PER CHAPTER
//   glossary   keyPath 'key'            — CACHED GLOSSARY PAGE ROWS PER (scope, pair, book)
//   covers     keyPath 'url'            — COVER IMAGE BLOBS KEYED BY THE SOURCE URL
//   outbox     keyPath 'id' (auto)      — QUEUED WRITE OPS (FIFO BY id), USER-PARTITIONED
//
// EVERY USER-FACING ROW IS PARTITIONED BY userId SO ONE ACCOUNT NEVER SEES ANOTHER'S CACHE ON A
// SHARED DEVICE (MIRRORS THE EXISTING xianslate:books:<id> POLICY). ALL FUNCTIONS NO-OP GRACEFULLY
// WHEN IndexedDB IS UNAVAILABLE (SSR, PRIVATE MODE, WEBVIEW STORAGE DISABLED) — CACHING IS A
// PROGRESSIVE ENHANCEMENT, NEVER A HARD DEPENDENCY.

// -- TYPES -- //

export type DbRowBase = { userId: string; savedAt: number };

export type TocRow = DbRowBase & {
	bookId: string;
	data: { book: unknown; resumeUuid: string | null; chapters: unknown[] };
};

export type ChapterRow = DbRowBase & {
	uuid: string;
	view: unknown; // ChapterView
};

export type GlossaryRow = DbRowBase & {
	key: string; // `scope|sourceLang|targetLang|bookId`
	rows: unknown[];
	total: number;
	page: number;
	pageSize: number;
	q: string;
};

export type CoverRow = {
	url: string;
	blob: Blob;
	savedAt: number;
};

// AN OUTBOX OP: EVERYTHING THE SYNC ENGINE NEEDS TO REPLAY THE WRITE ONCE NETWORK RETURNS. `id` IS THE
// AUTO-INCREMENT IndexedDB KEY, ASSIGNED BY outboxEnqueue AND RETURNED FOR LATER outboxRemove CALLS.
export type OutboxOp = {
	id?: number;
	op:
		| 'progress'
		| 'read'
		| 'resume'
		| 'bookPatch'
		| 'bookDelete'
		| 'chapterPatch'
		| 'chapterDelete'
		| 'reorder'
		| 'glossaryUpsert'
		| 'glossaryDelete';
	payload: Record<string, unknown>;
	userId: string;
	createdAt: number;
	attempts: number;
};

// -- STATE -- //

const DB_NAME = 'xianslate';
// v2: REBUILDS THE OUTBOX STORE WITH autoIncrement (v1 CREATED IT PLAIN, SILENTLY DROPPING QUEUED OPS).
const DB_VERSION = 2;

// OBJECT STORES THAT USE EXPLICIT OUT-OF-LINE KEYS (meta key / bookId / uuid / glossary key / url).
// NOTE: 'outbox' IS DELIBERATELY NOT HERE — IT NEEDS autoIncrement AND IS CREATED SEPARATELY BELOW.
const STORES = ['meta', 'toc', 'chapters', 'glossary', 'covers'] as const;

let dbPromise: Promise<IDBDatabase | null> | null = null;

// -- HELPERS -- //

function openDb(): Promise<IDBDatabase | null> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve) => {
			if (typeof indexedDB === 'undefined') {
				resolve(null);
				return;
			}
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				for (const name of STORES) {
					if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
				}
				if (!db.objectStoreNames.contains('outbox')) {
					// THE OUTBOX NEEDS AN AUTO-INCREMENT KEY SO ops CAN BE ADDED WITHOUT AN EXPLICIT id AND
					// FLUSHED OLDEST-FIRST BY KEY ORDER.
					db.createObjectStore('outbox', { autoIncrement: true });
				} else if (db.version === 2) {
					// v1 BUG: 'outbox' WAS CREATED BY THE PLAIN LOOP WITHOUT autoIncrement, SO s.add(op) THREW
					// AND EVERY QUEUED WRITE WAS SILENTLY LOST. REBUILD THE STORE (PRESERVING PENDING OPS) —
					// THE DATA MODEL DIDN'T CHANGE, ONLY THE KEY GENERATOR.
					const t = req.transaction;
					if (t) {
						const old = t.objectStore('outbox');
						const rows: unknown[] = [];
						old.openCursor().onsuccess = (e) => {
							const cursor = (e.target as IDBRequest).result;
							if (cursor) {
								rows.push(cursor.value);
								cursor.continue();
							} else {
								db.deleteObjectStore('outbox');
								const fresh = db.createObjectStore('outbox', { autoIncrement: true });
								for (const row of rows) fresh.add(row);
							}
						};
					}
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => {
				console.warn('[offline] IndexedDB unavailable:', req.error);
				resolve(null);
			};
		});
	}
	return dbPromise;
}

function tx(
	db: IDBDatabase,
	store: string,
	mode: IDBTransactionMode,
	run: (s: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const t = db.transaction(store, mode);
		const req = run(t.objectStore(store));
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function getRow<T>(store: string, key: string): Promise<T | null> {
	const db = await openDb();
	if (!db) return null;
	try {
		return (await tx(db, store, 'readonly', (s) => s.get(key))) as T | null;
	} catch {
		return null;
	}
}

async function putRow(store: string, value: unknown, key?: string): Promise<void> {
	const db = await openDb();
	if (!db) return;
	try {
		await tx(db, store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
	} catch {
		// QUOTA / TRANSIENT FAILURE — CACHE IS BEST-EFFORT.
	}
}

async function delRow(store: string, key: string): Promise<void> {
	const db = await openDb();
	if (!db) return;
	try {
		await tx(db, store, 'readwrite', (s) => s.delete(key));
	} catch {
		// IGNORE
	}
}

// -- PUBLIC API: META -- //

export async function metaGet<T>(key: string): Promise<T | null> {
	return getRow<T>('meta', key);
}

export async function metaSet(key: string, value: unknown): Promise<void> {
	return putRow('meta', value, key);
}

export async function metaDelete(key: string): Promise<void> {
	return delRow('meta', key);
}

// -- PUBLIC API: TOC -- //

export async function tocGet(bookId: string): Promise<TocRow | null> {
	return getRow<TocRow>('toc', bookId);
}

export async function tocPut(bookId: string, userId: string, data: TocRow['data']): Promise<void> {
	const row: TocRow = { bookId, userId, data, savedAt: Date.now() };
	return putRow('toc', row, bookId);
}

// -- PUBLIC API: CHAPTERS -- //

export async function chapterGet(uuid: string): Promise<ChapterRow | null> {
	return getRow<ChapterRow>('chapters', uuid);
}

export async function chapterPut(uuid: string, userId: string, view: unknown): Promise<void> {
	const row: ChapterRow = { uuid, userId, view, savedAt: Date.now() };
	return putRow('chapters', row, uuid);
}

// -- PUBLIC API: GLOSSARY -- //

export function glossaryKey(scope: string, sourceLang: string, targetLang: string, bookId?: string): string {
	return `${scope}|${sourceLang}|${targetLang}|${bookId ?? ''}`;
}

export async function glossaryGet(key: string): Promise<GlossaryRow | null> {
	return getRow<GlossaryRow>('glossary', key);
}

export async function glossaryPut(
	key: string,
	userId: string,
	data: Pick<GlossaryRow, 'rows' | 'total' | 'page' | 'pageSize' | 'q'>,
): Promise<void> {
	const row: GlossaryRow = { key, userId, rows: data.rows, total: data.total, page: data.page, pageSize: data.pageSize, q: data.q, savedAt: Date.now() };
	return putRow('glossary', row, key);
}

// -- PUBLIC API: COVERS -- //

export async function coverGet(url: string): Promise<CoverRow | null> {
	return getRow<CoverRow>('covers', url);
}

export async function coverPut(url: string, blob: Blob): Promise<void> {
	const row: CoverRow = { url, blob, savedAt: Date.now() };
	return putRow('covers', row, url);
}

// -- PUBLIC API: OUTBOX -- //

// QUEUE A WRITE OP; RETURNS THE AUTO-INCREMENT id (null WHEN IndexedDB IS UNAVAILABLE OR THE QUEUE
// FAILED — CALLERS THEN FALL THROUGH TO BEST-EFFORT DIRECT WRITES AS TODAY).
export async function outboxEnqueue(op: OutboxOp): Promise<number | null> {
	const db = await openDb();
	if (!db) return null;
	try {
		const id = (await tx(db, 'outbox', 'readwrite', (s) => s.add(op))) as number;
		return id;
	} catch {
		return null;
	}
}

// ALL PENDING OPS FOR A USER, OLDEST FIRST (FIFO — ORDER MATTERS FOR read/progress SEQUENCING).
// NOTE: getAll() DROPS autoIncrement KEYS, SO WE WALK A CURSOR AND ATTACH primaryKey AS op.id — THE
// FLUSHER NEEDS THE REAL KEY TO REMOVE OPS AFTER REPLAY (outboxRemove(id)).
export async function outboxPending(userId: string): Promise<OutboxOp[]> {
	const db = await openDb();
	if (!db) return [];
	try {
		return await new Promise((resolve, reject) => {
			const t = db.transaction('outbox', 'readonly');
			const req = t.objectStore('outbox').openCursor();
			const ops: OutboxOp[] = [];
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					const op = cursor.value as OutboxOp;
					if (op.userId === userId) ops.push({ ...op, id: cursor.primaryKey as number });
					cursor.continue();
				} else {
					resolve(ops.sort((a, b) => (a.id ?? 0) - (b.id ?? 0)));
				}
			};
			req.onerror = () => reject(req.error);
		});
	} catch {
		return [];
	}
}

export async function outboxRemove(id: number): Promise<void> {
	const db = await openDb();
	if (!db) return;
	try {
		await tx(db, 'outbox', 'readwrite', (s) => s.delete(id));
	} catch {
		// IGNORE
	}
}

export async function outboxCount(userId: string): Promise<number> {
	const db = await openDb();
	if (!db) return 0;
	try {
		const all = (await tx(db, 'outbox', 'readonly', (s) => s.getAll())) as OutboxOp[];
		return all.filter((o) => o.userId === userId).length;
	} catch {
		return 0;
	}
}

// -- PUBLIC API: USER PARTITION CLEANUP (SIGN-OUT / ACCOUNT SWITCH) -- //

// REMOVE EVERY CACHE ROW + QUEUED OP FOR ONE USER (LEAVES OTHER ACCOUNTS' DATA INTACT). COVERS ARE
// URL-KEYED AND SHARED ACROSS ACCOUNTS (SAFE TO KEEP — THEY ARE PUBLIC IMAGES, NOT USER DATA).
export async function clearUserData(userId: string): Promise<void> {
	const db = await openDb();
	if (!db) return;
	const jobs: Promise<unknown>[] = [];
	try {
		for (const store of ['toc', 'chapters', 'glossary'] as const) {
			jobs.push(
				new Promise((resolve, reject) => {
					const t = db.transaction(store, 'readwrite');
					const s = t.objectStore(store);
					const req = s.openCursor();
					req.onsuccess = () => {
						const cursor = req.result;
						if (cursor) {
							const row = cursor.value as DbRowBase;
							if (row.userId === userId) cursor.delete();
							cursor.continue();
						} else {
							resolve(undefined);
						}
					};
					req.onerror = () => reject(req.error);
				}),
			);
		}
		jobs.push(
			new Promise((resolve, reject) => {
				const t = db.transaction('outbox', 'readwrite');
				const s = t.objectStore('outbox');
				const req = s.openCursor();
				req.onsuccess = () => {
					const cursor = req.result;
					if (cursor) {
						const row = cursor.value as OutboxOp;
						if (row.userId === userId) cursor.delete();
						cursor.continue();
					} else {
						resolve(undefined);
					}
				};
				req.onerror = () => reject(req.error);
			}),
		);
		await Promise.all(jobs);
	} catch {
		// BEST-EFFORT — SIGN-OUT STILL PROCEEDS.
	}
}
