// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED TYPES
import type { ChapterView } from '$lib/server/books';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiUrl, authHeaders } from '$lib/api';
import { cacheChapter, readCachedChapter } from '$lib/offline/chapters';
import { get } from 'svelte/store';
import { currentUser } from '$lib/stores/auth';

// -- FUNCTIONS -- //

// LOAD THE CHAPTER BY ITS UUID THROUGH /api SO THE READER RENDERS IDENTICALLY UNDER WEB SSR AND THE
// CAPACITOR STATIC SPA (apiUrl → ABSOLUTE PUBLIC_API_BASE THERE; authHeaders → Bearer FIREBASE ID TOKEN) —
// NO SERVER LOAD IS REACHED. resume=1 RECORDS THE RESUME POINT SERVER-SIDE BECAUSE THIS IS A REAL PAGE VIEW
// (PREFETCH/JSON LOOKUPS OMIT IT, SO THEY DON'T MOVE THE POINTER).
export const load: PageLoad = async ({ params, fetch }) => {
	try {
		const res = await fetch(apiUrl(`/api/chapter?id=${encodeURIComponent(params.chapter)}&resume=1`), {
			headers: await authHeaders(),
		});
		if (!res.ok) throw error(res.status, 'Chapter not found.');
		const view: ChapterView = await res.json();
		// CACHE-AS-YOU-OPEN: A FETCHED CHAPTER (SOURCE + TRANSLATION) IS AVAILABLE OFFLINE FROM NOW ON.
		cacheChapter(view.uuid, get(currentUser)?.id, view);
		return { view };
	} catch (e) {
		// A REAL HTTP ERROR (404 etc.) PROPAGATES AS-IS. ONLY A NETWORK-TYPE FAILURE (OFFLINE / DNS) SERVES
		// THE CACHED COPY. NO CACHED COPY → A CLEAR "NOT AVAILABLE OFFLINE" ERROR INSTEAD OF THE RAW
		// NETWORK TypeError (WHICH RENDERS AS A GENERIC 500 PAGE).
		if (e instanceof Error && 'status' in e) throw e;
		const cached = await readCachedChapter(params.chapter);
		if (cached) {
			// fromCache LETS THE READER QUEUE A resume OP — THE resume=1 SIDE EFFECT CAN'T RUN OFFLINE, SO
			// THE OUTBOX REPLAYS IT ON RECONNECT (OTHERWISE THE SERVER'S RESUME POINTER STAYS AT THE LAST
			// ONLINE-OPENED CHAPTER).
			return { view: cached as ChapterView, fromCache: true };
		}
		throw error(503, "This chapter isn't saved on this device — open it once while online to read it offline.");
	}
};
