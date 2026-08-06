// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED DEP-MODULES
import { error, redirect } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiUrl, authHeaders } from '$lib/api';
import { cacheToc, prefetchUntranslatedSources, readCachedToc } from '$lib/offline/chapters';
import { get } from 'svelte/store';
import { currentUser } from '$lib/stores/auth';

// -- FUNCTIONS -- //

// NO CHAPTER IN THE PATH → REDIRECT TO THE RESUME POINT (ELSE THE FIRST CHAPTER). RESOLVED THROUGH /api SO
// THE REDIRECT WORKS UNDER WEB SSR AND THE CAPACITOR STATIC SPA (apiUrl → ABSOLUTE PUBLIC_API_BASE THERE;
// authHeaders → Bearer FIREBASE ID TOKEN) — NO SERVER LOAD IS REACHED.
export const load: PageLoad = async ({ params, fetch }) => {
	let data: { book?: unknown; resumeUuid: string | null; chapters: { uuid: string }[] } | null = null;
	try {
		const res = await fetch(apiUrl(`/api/books/${params.id}/chapters`), { headers: await authHeaders() });
		if (!res.ok) throw error(res.status, 'Book not found.');
		data = (await res.json()) as { book: unknown; resumeUuid: string | null; chapters: { uuid: string }[] };
		// CACHE THE TOC SO THE RESUME REDIRECT + MANAGE PAGE WORK OFFLINE — AWAITED SO THE PREFETCH BELOW
		// ALWAYS SEES THE FRESH TOC (THE tocPut MUST COMMIT BEFORE prefetchUntranslatedSources READS IT).
		await cacheToc(params.id, get(currentUser)?.id, {
			book: data.book,
			resumeUuid: data.resumeUuid,
			chapters: data.chapters,
		});
		// SOURCE OF UNTRANSLATED CHAPTERS READS OFFLINE TOO — SILENTLY DOWNLOAD THEM (FIRE-AND-FORGET).
		void prefetchUntranslatedSources(params.id);
	} catch (e) {
		// A REAL HTTP ERROR (BOOK NOT FOUND) PROPAGATES AS-IS. ONLY A NETWORK-TYPE FAILURE (OFFLINE / DNS)
		// FALLS BACK TO THE CACHED TOC — SAME RESUME/FIRST-CHOICE LOGIC. NO CACHED TOC → A CLEAR
		// "NOT AVAILABLE OFFLINE" ERROR INSTEAD OF THE RAW TypeError (GENERIC 500 PAGE).
		if (e instanceof Error && 'status' in e) throw e;
		const cached = await readCachedToc(params.id);
		if (!cached)
			throw error(503, "This book isn't saved on this device — open it once while online to read it offline.");
		data = { resumeUuid: cached.resumeUuid, chapters: cached.chapters as { uuid: string }[] };
	}
	const target = data.resumeUuid ?? data.chapters[0]?.uuid ?? null;
	// EMPTY BOOK → SEND TO THE MANAGEMENT PAGE (ADD CHAPTERS / CURATE GLOSSARY) RATHER THAN 404
	if (!target) throw redirect(307, `/app/book/${params.id}/manage/`);
	throw redirect(307, `/app/book/${params.id}/${target}/`);
};
