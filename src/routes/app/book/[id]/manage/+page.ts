// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED TYPES
import type { SourceType } from '$lib/types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiUrl, authHeaders } from '$lib/api';

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
// NO SERVER LOAD IS REACHED.
export const load: PageLoad = async ({ params, fetch }) => {
	const res = await fetch(apiUrl(`/api/books/${params.id}/chapters`), { headers: await authHeaders() });
	if (!res.ok) throw error(res.status, 'Book not found.');
	return (await res.json()) as ManageData;
};
