// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED TYPES
import type { SourceType } from '$lib/types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiFetch } from '$lib/api';

// -- TYPES -- //

// THE SHAPE GET /api/books/[id]/chapters RETURNS — MIRRORS THE FORMER manage/+page.server.ts CONTRACT.
type ManageData = {
	book: { id: string; title: string; sourceType: SourceType; sourceLang: string; targetLang: string };
	resumeUuid: string | null;
	chapters: {
		uuid: string;
		seq: number;
		titleSource: string;
		titleTarget: string | null;
		hasTarget: boolean;
		readProgress: number;
	}[];
};

// -- FUNCTIONS -- //

// LOAD THE BOOK + ITS ORDERED CHAPTERS THROUGH /api SO MANAGE RENDERS IDENTICALLY UNDER WEB SSR *AND* AS A
// STATIC SPA (ssr=false) — NO SERVER LOAD IS REACHED.
export const load: PageLoad = async ({ params, fetch }) => {
	const f = __CAPACITOR_BUILD__ ? apiFetch : fetch;
	const res = await f(`/api/books/${params.id}/chapters`);
	if (!res.ok) throw error(res.status, 'Book not found.');
	return (await res.json()) as ManageData;
};
