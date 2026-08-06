// OFFLINE DATASTORE TESTS — THE IndexedDB WRAPPER, EXERCISED AGAINST fake-indexeddb.
//
// COVERS: ROUND-TRIPS PER STORE, OUTBOX FIFO ORDERING + USER PARTITIONING + REMOVE, clearUserData SCOPE,
// AND THE v1→v2 MIGRATION THAT REBUILDS THE OUTBOX STORE WITH autoIncrement (THE BUG THAT SILENTLY DROPPED
// EVERY QUEUED WRITE).
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
	chapterGet,
	chapterPut,
	clearUserData,
	coverGet,
	coverPut,
	glossaryGet,
	glossaryKey,
	glossaryPut,
	metaDelete,
	metaGet,
	metaSet,
	outboxCount,
	outboxEnqueue,
	outboxPending,
	outboxRemove,
	_closeForTests,
	tocGet,
	tocPut,
	type OutboxOp,
} from '$lib/offline/db';

// WIPE THE DATABASE BEFORE EACH TEST: CLOSE THE MODULE'S CACHED CONNECTION, DELETE THE DB, REOPEN FRESH.
async function wipeDb(): Promise<void> {
	_closeForTests();
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase('xianslate');
		req.onsuccess = () => resolve();
		req.onerror = () => resolve(); // NOT THERE YET IS FINE
		req.onblocked = () => resolve(); // STALE CONNECTION — BEST EFFORT
	});
}

function op(p: Partial<OutboxOp>): OutboxOp {
	return { op: 'progress', payload: { p: 1 }, userId: 'u1', createdAt: Date.now(), attempts: 0, ...p };
}

beforeEach(async () => await wipeDb());

describe('meta', () => {
	it('set → get → delete round-trip', async () => {
		expect(await metaGet('session:user')).toBeNull();
		await metaSet('session:user', { id: 'u1' });
		expect(await metaGet('session:user')).toEqual({ id: 'u1' });
		await metaDelete('session:user');
		expect(await metaGet('session:user')).toBeNull();
	});
});

describe('toc + chapters', () => {
	it('tocPut/tocGet round-trips the full row', async () => {
		await tocPut('b1', 'u1', { book: { title: 'T' }, resumeUuid: 'c2', chapters: [{ uuid: 'c1' }] });
		const row = await tocGet('b1');
		expect(row?.userId).toBe('u1');
		expect(row?.data.resumeUuid).toBe('c2');
		expect(row?.data.chapters).toEqual([{ uuid: 'c1' }]);
	});

	it('chapterPut/chapterGet round-trips the view', async () => {
		await chapterPut('c1', 'u1', { titleSource: 'T1', contentSource: 'body' });
		expect(await chapterGet('c1')).toMatchObject({ uuid: 'c1', userId: 'u1', view: { titleSource: 'T1' } });
	});
});

describe('outbox', () => {
	it('enqueues in FIFO id order and partitions by user', async () => {
		const a = await outboxEnqueue(op({ userId: 'u1', op: 'progress' }));
		const b = await outboxEnqueue(op({ userId: 'u1', op: 'read' }));
		await outboxEnqueue(op({ userId: 'u2', op: 'resume' }));
		const u1 = await outboxPending('u1');
		expect(u1.map((o) => o.id)).toEqual([a, b]);
		expect(u1.map((o) => o.op)).toEqual(['progress', 'read']);
		expect(await outboxPending('u2')).toHaveLength(1);
		expect(await outboxCount('u1')).toBe(2);
	});

	it('outboxRemove deletes exactly one op', async () => {
		const a = await outboxEnqueue(op({ userId: 'u1' }));
		const b = await outboxEnqueue(op({ userId: 'u1' }));
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		await outboxRemove(a!);
		expect((await outboxPending('u1')).map((o) => o.id)).toEqual([b]);
	});
});

describe('glossary + covers', () => {
	it('glossaryKey format is stable (cache invalidation depends on it)', () => {
		expect(glossaryKey('book', 'zh-Hant', 'en', 'b1')).toBe('book|zh-Hant|en|b1');
		expect(glossaryKey('global', 'zh-Hant', 'en')).toBe('global|zh-Hant|en|');
	});

	it('glossary + cover round-trips', async () => {
		await glossaryPut(glossaryKey('book', 'zh-Hant', 'en', 'b1'), 'u1', { rows: [1, 2], total: 2, page: 0, pageSize: 20, q: '' });
		expect(await glossaryGet('book|zh-Hant|en|b1')).toMatchObject({ userId: 'u1', total: 2 });
		await coverPut('https://x/cover.jpg', new Blob(['x']));
		expect((await coverGet('https://x/cover.jpg'))?.blob.size).toBe(1);
	});
});

describe('clearUserData', () => {
	it('removes only the target user rows across stores (session marker is persistSessionUser domain)', async () => {
		await metaSet('session:user', { id: 'u1' });
		await tocPut('b1', 'u1', { book: {}, resumeUuid: null, chapters: [] });
		await tocPut('b2', 'u2', { book: {}, resumeUuid: null, chapters: [] });
		await chapterPut('c1', 'u1', {});
		await chapterPut('c2', 'u2', {});
		await outboxEnqueue(op({ userId: 'u1' }));
		await outboxEnqueue(op({ userId: 'u2' }));

		await clearUserData('u1');

		expect(await tocGet('b1')).toBeNull();
		expect(await chapterGet('c1')).toBeNull();
		expect(await tocGet('b2')).not.toBeNull(); // u2 UNTOUCHED
		expect(await chapterGet('c2')).not.toBeNull();
		expect(await outboxCount('u1')).toBe(0);
		expect(await outboxCount('u2')).toBe(1);
		// THE session:user KEY IS OWNED BY persistSessionUser(null) ON SIGN-OUT, NOT clearUserData.
		expect(await metaGet('session:user')).toEqual({ id: 'u1' });
	});
});

describe('v1 → v2 outbox migration', () => {
	it('rebuilds the v1 plain outbox store with autoIncrement, preserving queued ops', async () => {
		// SIMULATE THE v1 DATABASE: OPEN WITH VERSION 1 AND CREATE THE OUTBOX STORE *WITHOUT* autoIncrement
		// (THE v1 BUG), THEN QUEUE A ROW THE WAY THE OLD CODE DID.
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open('xianslate', 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				for (const name of ['meta', 'toc', 'chapters', 'glossary', 'covers']) db.createObjectStore(name);
				db.createObjectStore('outbox'); // <-- THE v1 BUG: NO autoIncrement
			};
			req.onsuccess = () => {
				const db = req.result;
				const t = db.transaction('outbox', 'readwrite');
				// KEYLESS v1 STORE: THE VALUE MUST BE PUT WITH AN EXPLICIT KEY (THE OLD APP DID THIS).
				t.objectStore('outbox').put({ id: 7, op: 'progress', payload: {}, userId: 'u1', createdAt: 1, attempts: 0 }, 7);
				t.oncomplete = () => {
					db.close();
					resolve();
				};
				t.onerror = () => reject(t.error);
			};
			req.onerror = () => reject(req.error);
		});

		// NOW THE MODULE OPENS THE DB AT v2 — THE MIGRATION MUST REBUILD THE STORE AND KEEP THE QUEUED OP.
		_closeForTests();
		await outboxEnqueue(op({ userId: 'u1', op: 'read' }));
		const pending = await outboxPending('u1');
		// THE OLD ROW SURVIVES THE MIGRATION (RE-KEYED TO A FRESH AUTO-INCREMENT id) AND THE NEW OP (ALSO
		// AUTO-INCREMENTED) FOLLOWS IT — FIFO ORDER PRESERVED.
		expect(pending.map((o) => o.op)).toEqual(['progress', 'read']);
		expect(await outboxCount('u1')).toBe(2);
	});
});
