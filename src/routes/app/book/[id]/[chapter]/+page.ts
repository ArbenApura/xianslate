// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED TYPES
import type { ChapterView } from '$lib/server/books';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';

// -- FUNCTIONS -- //

// LOAD THE CHAPTER BY ITS UUID THROUGH /api SO THE READER RENDERS IDENTICALLY UNDER WEB SSR — NO SERVER
// LOAD IS REACHED. resume=1 RECORDS THE RESUME POINT SERVER-SIDE BECAUSE THIS IS A REAL PAGE VIEW
// (PREFETCH/JSON LOOKUPS OMIT IT, SO THEY DON'T MOVE THE POINTER).
export const load: PageLoad = async ({ params, fetch }) => {
	const res = await fetch(`/api/chapter?id=${encodeURIComponent(params.chapter)}&resume=1`);
	if (!res.ok) throw error(res.status, 'Chapter not found.');
	const view: ChapterView = await res.json();
	return { view };
};
