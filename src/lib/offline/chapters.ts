// OFFLINE CHAPTER/TOC CACHE — READ-THROUGH CACHE FOR CHAPTER BODIES AND PER-BOOK TOCS.
//
// CHAPTERS ARE THE BIGGEST OFFLINE WIN: A ChapterView CONTAINS THE FULL SOURCE + TARGET TEXT, AND
// TRANSLATIONS ARE PERSISTED SERVER-SIDE — SO ANY CHAPTER OPENED WHILE ONLINE BECOMES READABLE OFFLINE
// (INCLUDING ITS TRANSLATION, TTS, SCROLL RESTORE). THE TOC (BOOK METADATA + CHAPTER LIST) LETS THE
// RESUME REDIRECT AND THE MANAGE PAGE WORK OFFLINE TOO.
//
// DESIGN: TRANSLATED CHAPTERS ARE CACHE-AS-YOU-OPEN (NO WHOLE-BOOK DOWNLOADS OF TARGET TEXT); THE SOURCE
// OF UNTRANSLATED CHAPTERS IS PREFETCHED SO IT READS OFFLINE WITHOUT HAVING BEEN OPENED FIRST (SEE
// prefetchUntranslatedSources — SOURCE-ONLY, NO AI/TRANSLATION COST). WRITES ARE FIRE-AND-FORGET; READS
// FALL BACK TO THE CACHE ONLY WHEN THE NETWORK CALL FAILS, SO ONLINE BEHAVIOUR IS IDENTICAL TO TODAY.

import { browser } from '$app/environment';
import { chapterGet, chapterPut, metaGet, metaSet, tocGet, tocPut, type TocRow } from '$lib/offline/db';
import { readSessionUser } from '$lib/offline/session';
import { isOnline } from '$lib/offline/network';
import { apiFetch } from '$lib/api';

// -- HELPERS -- //

// RESOLVE THE CACHING ACCOUNT: THE STORE VALUE WHEN ALREADY HYDRATED, OTHERWISE THE PERSISTED SESSION
// (IndexedDB meta). THE STORE IS EMPTY DURING BOOT-TIME PAGE LOADS — HYDRATION RUNS IN THE LAYOUT'S
// onMount, AFTER page loads COMPLETE — SO WITHOUT THIS FALLBACK CHAPTERS OPENED RIGHT AFTER LAUNCH
// WOULD NEVER BE CACHED (userId null → WRITE SKIPPED) AND OFFLINE READING WOULD FAIL.
async function cacheUserId(userId: string | null | undefined): Promise<string | null> {
	if (userId) return userId;
	return (await readSessionUser())?.id ?? null;
}

// -- CHAPTER BODIES -- //

// STORE A FRESHLY-FETCHED ChapterView SO IT IS AVAILABLE OFFLINE (BEST-EFFORT, NEVER BLOCKS THE READER).
export function cacheChapter(uuid: string, userId: string | null | undefined, view: unknown): void {
	void (async () => {
		const uid = await cacheUserId(userId);
		if (!uid) return;
		await chapterPut(uuid, uid, view);
	})();
}

// READ A PREVIOUSLY-CACHED ChapterView (null WHEN NONE / IndexedDB UNAVAILABLE).
export async function readCachedChapter(uuid: string): Promise<unknown | null> {
	const row = await chapterGet(uuid);
	return row?.view ?? null;
}

// -- BOOK TOC / MANAGE DATA -- //

// STORE THE PER-BOOK TOC RESPONSE ({ book, resumeUuid, chapters }) FOR OFFLINE REDIRECTS + MANAGE.
// ALSO NOTES THE BOOK AS RECENTLY-OPENED SO THE SYNC ENGINE REFRESHES ITS TOC ON RECONNECT.
export function cacheToc(bookId: string, userId: string | null | undefined, data: TocRow['data']): void {
	void (async () => {
		const uid = await cacheUserId(userId);
		if (!uid) return;
		await tocPut(bookId, uid, data);
		await noteRecentBook(bookId);
	})();
}

// TRACK RECENTLY-OPENED BOOKS (CAP 5) SO THE SYNC ENGINE KNOWS WHICH TOCs TO REVALIDATE ON RECONNECT.
export async function noteRecentBook(bookId: string): Promise<void> {
	const recent = (await metaGet<string[]>('sync:recentBooks')) ?? [];
	const next = [bookId, ...recent.filter((b) => b !== bookId)].slice(0, 5);
	await metaSet('sync:recentBooks', next);
}

// READ A PREVIOUSLY-CACHED TOC (null WHEN NONE).
export async function readCachedToc(bookId: string): Promise<TocRow['data'] | null> {
	const row = await tocGet(bookId);
	return row?.data ?? null;
}

// -- UNTRANSLATED-SOURCE PREFETCH -- //

// DOWNLOAD + CACHE THE SOURCE TEXT OF EVERY UNTRANSLATED CHAPTER SO IT READS OFFLINE WITHOUT HAVING BEEN
// OPENED FIRST (TRANSLATED CHAPTERS STAY CACHE-AS-YOU-OPEN). SOURCE-ONLY — THE /api/chapter VIEW IS THE
// SAME PAYLOAD THE READER SHOWS, WITH NO TRANSLATION / AI COST. CALLERS FIRE-AND-FORGET
// (`void prefetchUntranslatedSources(bookId)`).
//
// IDEMPOTENT: ALREADY-CACHED CHAPTERS ARE SKIPPED, AND A MODULE-LEVEL SET PREVENTS DUPLICATE IN-FLIGHT
// FETCHES WHEN SEVERAL TRIGGER POINTS (BOOK LOAD / MANAGE / READER TOC) FIRE TOGETHER. BAILS OUTSIDE A
// BROWSER (SSR) AND WHEN OFFLINE, AND STOPS MID-RUN ON A NETWORK FAILURE — THE REST RETRIES ON A LATER
// ONLINE SESSION. CONCURRENCY IS BOUNDED SO A HUGE BOOK NEVER FIRES A FETCH STORM.
const prefetchInFlight = new Set<string>();

export function prefetchUntranslatedSources(bookId: string): void {
	void (async () => {
		if (!browser) return;
		const toc = await readCachedToc(bookId);
		if (!toc) return;
		const untranslated = (toc.chapters as { uuid?: string; hasTarget?: boolean }[]).filter(
			(c) => c.uuid && !c.hasTarget,
		);
		if (!untranslated.length || !isOnline()) return;
		const queue = [...untranslated];
		const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
			while (queue.length) {
				const ch = queue.shift();
				if (!ch?.uuid) continue;
				if (prefetchInFlight.has(ch.uuid)) continue;
				if (!isOnline()) break;
				if (await readCachedChapter(ch.uuid)) continue;
				prefetchInFlight.add(ch.uuid);
				try {
					const res = await apiFetch(`/api/chapter?id=${encodeURIComponent(ch.uuid)}`);
					if (res.ok) cacheChapter(ch.uuid, null, await res.json());
				} catch {
					// OFFLINE MID-RUN → STOP THE WHOLE PREFETCH (THE NEXT ONLINE SESSION RETRIES THE REST).
					break;
				} finally {
					prefetchInFlight.delete(ch.uuid);
				}
			}
		});
		await Promise.all(workers);
	})();
}
