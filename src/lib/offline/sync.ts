// OFFLINE SYNC ENGINE — REPLAYS THE QUEUED WRITES AND REFRESHES STALE CACHES WHEN THE NETWORK RETURNS.
//
// TRIGGERS (ALL IDEMPOTENT, ALL BEST-EFFORT):
//   - THE online EVENT (root layout subscribes to the online store)
//   - APP RESUME (native.ts — RETURNING TO FOREGROUND)
//   - AFTER A SUCCESSFUL /api/me PROBE AT BOOT (refreshUser)
//
// WHAT IT DOES, IN ORDER:
//   1. FLUSH THE OUTBOX (FIFO PER USER — progress/read/pin/delete/glossary OPS REPLAYED AS WRITTEN).
//   2. REVALIDATE THE CACHES THE USER IS LIKELY TO LOOK AT: THE SHELF AND THE OPEN BOOK'S TOC. CHAPTER
//      BODIES REVALIDATE LAZILY ON OPEN (THE READER'S LOAD IS A READ-THROUGH CACHE), AND GLOSSARY ROWS
//      REVALIDATE ON THE NEXT PANEL LOAD — SO THE SYNC ENGINE ONLY TOUCHES THE CHEAP METADATA.
//
// CONFLICT POLICY (SINGLE-USER APP, SERVER IS THE TRUTH):
//   - progress: THE SERVER'S MONOTONIC MAX WINS (THE OUTBOX REPLAYS IN ORDER, SO THE LAST WRITE WINS).
//   - read / pin / archive / delete / edits: REPLAYED FIFO — LAST QUEUED ACTION WINS.
//   - glossary: LAST-WRITE-WINS VIA updatedAt (SERVER-SIDE) — THE OUTBOX REPLAY IS THE LATEST EDIT.
//   - A QUEUED DELETE ALWAYS WINS (THE ROW IS GONE ON THE SERVER EITHER WAY).
//   - REVALIDATION REPLACES STALE CACHES WITH SERVER STATE AFTER THE QUEUE DRAINS.

import { get } from 'svelte/store';
import { apiFetch } from '$lib/api';
import { currentUser } from '$lib/stores/auth';
import { isOnline } from '$lib/offline/network';
import { flushOutbox } from '$lib/offline/outbox';
import { metaGet, tocGet } from '$lib/offline/db';
import { cacheToc } from '$lib/offline/chapters';

// -- STATE -- //

let syncing = false;
let lastSyncAt = 0;

// -- CONSTANTS -- //

// MINIMUM GAP BETWEEN SYNC RUNS (MS) — THE online EVENT CAN FIRE IN A FLAP WHILE THE RADIO SETTLES.
const SYNC_MIN_INTERVAL = 5000;

// -- FUNCTIONS -- //

// REVALIDATE THE SHELF (THE LIBRARY PAGE REFETCHES IT ON EVERY MOUNT ANYWAY, SO THIS ONLY WARMS THE
// localStorage CACHE USED FOR THE INSTANT OFFLINE PAINT — THE REAL REFRESH IS THE NEXT PAGE VISIT).
async function revalidateShelf(userId: string): Promise<void> {
	try {
		const res = await apiFetch('/api/books');
		if (!res.ok) return;
		const books = await res.json();
		if (Array.isArray(books)) {
			// MIRROR THE LIBRARY PAGE'S CACHE FORMAT SO AN OFFLINE COLD START PAINTS INSTANTLY.
			const key = `xianslate:books:${userId}`;
			localStorage.setItem(key, JSON.stringify({ v: 2, books }));
		}
	} catch {
		// OFFLINE AGAIN — NOTHING TO DO.
	}
}

// REVALIDATE THE TOC OF THE BOOK THE USER LAST HAD OPEN (IF ANY CACHED TOC EXISTS, REFRESH IT SO THE
// OFFLINE MANAGE/RESUME REDIRECT STAYS FRESH). THE RECENT-BOOK LIST IS MAINTAINED BY noteRecentBook
// (CALLED FROM cacheToc), SO ONLY BOOKS THE USER ACTUALLY OPENED ARE REFRESHED.
async function revalidateOpenBook(userId: string): Promise<void> {
	const recent = (await metaGet<string[]>('sync:recentBooks')) ?? [];
	for (const bookId of recent.slice(0, 5)) {
		const cached = await tocGet(bookId);
		if (!cached) continue;
		try {
			const res = await apiFetch(`/api/books/${bookId}/chapters`);
			if (!res.ok) continue;
			const data = await res.json();
			cacheToc(bookId, userId, { book: data.book, resumeUuid: data.resumeUuid, chapters: data.chapters });
		} catch {
			// IGNORE — KEEP THE STALE COPY.
		}
	}
}

// FULL SYNC: FLUSH THE OUTBOX, THEN REVALIDATE METADATA. SAFE TO CALL FROM ANYWHERE (IDEMPOTENT,
// DEBOUNCED, NEVER THROWS).
export async function syncNow(): Promise<void> {
	if (syncing) return;
	const user = get(currentUser);
	if (!user) return;
	const now = Date.now();
	if (now - lastSyncAt < SYNC_MIN_INTERVAL) return;
	if (!isOnline()) return;
	syncing = true;
	lastSyncAt = now;
	try {
		await flushOutbox(user.id);
		await revalidateShelf(user.id);
		await revalidateOpenBook(user.id);
	} catch {
		// NEVER THROW INTO THE EVENT HANDLER — A FAILED SYNC RETRIES ON THE NEXT ONLINE/RESUME.
	} finally {
		syncing = false;
	}
}
