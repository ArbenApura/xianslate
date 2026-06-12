// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED DEP-MODULES
import { error, redirect } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiFetch } from '$lib/api';

// -- FUNCTIONS -- //

// NO CHAPTER IN THE PATH → REDIRECT TO THE RESUME POINT (ELSE THE FIRST CHAPTER). RESOLVED THROUGH /api SO
// THE REDIRECT WORKS UNDER WEB SSR *AND* CLIENT-SIDE IN THE STATIC SPA — NO SERVER LOAD IS REACHED.
export const load: PageLoad = async ({ params, fetch }) => {
	const f = __CAPACITOR_BUILD__ ? apiFetch : fetch;
	const res = await f(`/api/books/${params.id}/chapters`);
	if (!res.ok) throw error(res.status, 'Book not found.');
	const data = (await res.json()) as { resumeUuid: string | null; chapters: { uuid: string }[] };
	const target = data.resumeUuid ?? data.chapters[0]?.uuid ?? null;
	// EMPTY BOOK → SEND TO THE MANAGEMENT PAGE (ADD CHAPTERS / CURATE GLOSSARY) RATHER THAN 404
	if (!target) throw redirect(307, `/app/book/${params.id}/manage/`);
	throw redirect(307, `/app/book/${params.id}/${target}/`);
};
