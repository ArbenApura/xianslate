// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { getChapterView } from '$lib/server/books';

// -- FUNCTIONS -- //

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireUser(locals);
	const uuid = url.searchParams.get('id') ?? url.searchParams.get('uuid');
	if (!uuid) throw error(400, 'A chapter id is required.');
	// resume=1 IS SET ONLY BY THE READER PAGE LOAD (A REAL VIEW), SO IT ADVANCES THE BOOK'S RESUME POINTER
	// (books.lastChapterId / lastReadAt). PREFETCH + JSON LOOKUPS OMIT IT SO THEY NEVER MOVE WHERE THE
	// READER LEFT OFF — THIS PRESERVES THE SIDE-EFFECT THAT USED TO LIVE IN THE READER'S SERVER LOAD.
	const recordResume = url.searchParams.get('resume') === '1';
	// getChapterView IS userId-SCOPED → A GUESSED uuid FROM ANOTHER USER'S LIBRARY RETURNS null (404).
	const view = await getChapterView(uuid, user.id, recordResume);
	if (!view) throw error(404, 'Chapter not found.');
	return json(view);
};
