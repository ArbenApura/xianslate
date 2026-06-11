// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { refetchCover } from '$lib/server/books';

// (RE)FETCH THE BOOK COVER FROM ITS WEB SOURCE PAGE. RETURNS { coverUrl } (null IF NONE FOUND). USED BY
// THE LIBRARY "Fetch cover" / "Refetch cover" ACTION.
export const POST: RequestHandler = async ({ params }) => {
	const res = await refetchCover(params.id);
	if (res.reason === 'not_found') throw error(404, 'Book not found.');
	if (res.reason === 'no_source') throw error(400, 'This book has no web source to fetch a cover from.');
	return json({ coverUrl: res.coverUrl });
};
