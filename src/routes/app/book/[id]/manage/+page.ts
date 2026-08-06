// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED TYPES
import type { SourceType } from '$lib/types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiUrl, authHeaders } from '$lib/api';
import { cacheToc, prefetchUntranslatedSources, readCachedToc } from '$lib/offline/chapters';
import { get } from 'svelte/store';
import { currentUser } from '$lib/stores/auth';

// -- TYPES -- //

// THE SHAPE GET /api/books/[id]/chapters RETURNS — MIRRORS THE FORMER manage/+page.server.ts CONTRACT.
type ManageData = {
	book: {
		id: string;
		// SOURCE-LANGUAGE TITLE/AUTHOR + THEIR TRANSLATIONS — THE MANAGE PAGE EDITS BOTH AND DERIVES ITS DISPLAY.
		title: string;
		titleTarget: string | null;
		author: string | null;
		authorTarget: string | null;
		coverUrl: string | null;
		sourceUrl: string | null;
		sourceType: SourceType;
		sourceLang: string;
		targetLang: string;
	};
	resumeUuid: string | null;
	chapters: {
		id: number;
		uuid: string;
		seq: number;
		titleSource: string;
		titleTarget: string | null;
		hasTarget: boolean;
		readProgress: number;
	}[];
};

// -- FUNCTIONS -- //

// LOAD THE BOOK + ITS ORDERED CHAPTERS THROUGH /api SO MANAGE RENDERS IDENTICALLY UNDER WEB SSR AND THE
// CAPACITOR STATIC SPA (apiUrl → ABSOLUTE PUBLIC_API_BASE THERE; authHeaders → Bearer FIREBASE ID TOKEN) —
// NO SERVER LOAD IS REACHED. THE RESPONSE IS CACHED (SAME TOC STORE AS THE RESUME REDIRECT) SO THE PAGE
// RENDERS OFFLINE; A REAL HTTP ERROR (BOOK NOT FOUND) PROPAGATES AS-IS.
export const load: PageLoad = async ({ params, fetch }) => {
	try {
		const res = await fetch(apiUrl(`/api/books/${params.id}/chapters`), { headers: await authHeaders() });
		if (!res.ok) throw error(res.status, 'Book not found.');
		const data = (await res.json()) as ManageData;
		// AWAITED SO THE PREFETCH BELOW ALWAYS SEES THE FRESH TOC (SEE book/[id]/+page.ts — SAME RACE).
		await cacheToc(params.id, get(currentUser)?.id, {
			book: data.book,
			resumeUuid: data.resumeUuid,
			chapters: data.chapters,
		});
		// SOURCE OF UNTRANSLATED CHAPTERS READS OFFLINE TOO — SILENTLY DOWNLOAD THEM (FIRE-AND-FORGET).
		void prefetchUntranslatedSources(params.id);
		return data;
	} catch (e) {
		if (e instanceof Error && 'status' in e) throw e;
		const cached = await readCachedToc(params.id);
		if (cached) {
			return { book: cached.book, resumeUuid: cached.resumeUuid, chapters: cached.chapters } as ManageData;
		}
		// OFFLINE + NO CACHED TOC → A CLEAR MESSAGE INSTEAD OF THE RAW TypeError (GENERIC 500 PAGE).
		throw error(503, "This book isn't saved on this device — open it once while online to edit it offline.");
	}
};
