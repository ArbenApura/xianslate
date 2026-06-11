// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED MODULES
import { getChapterView } from '$lib/server/books';

// -- FUNCTIONS -- //

export const GET: RequestHandler = async ({ url }) => {
	const uuid = url.searchParams.get('id') ?? url.searchParams.get('uuid');
	if (!uuid) throw error(400, 'A chapter id is required.');
	const view = await getChapterView(uuid);
	if (!view) throw error(404, 'Chapter not found.');
	return json(view);
};
