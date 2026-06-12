// IMPORTED DEP-TYPES
import type { PageServerLoad } from './$types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
// IMPORTED MODULES
import { getChapterView } from '$lib/server/books';

// -- FUNCTIONS -- //

// SSR THE CHAPTER BY ITS UUID (PATH PARAM). THIS IS A REAL VIEW, SO IT RECORDS THE RESUME POINT.
export const load: PageServerLoad = async ({ params }) => {
	const view = await getChapterView(params.chapter, true);
	if (!view) throw error(404, 'Chapter not found.');
	return { view };
};
