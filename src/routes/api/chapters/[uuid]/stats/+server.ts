// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { getOwnedChapterByUuid } from '$lib/server/books';
import { getChapterStats } from '$lib/server/chapter-stats';

// -- FUNCTIONS -- //

// READ-ONLY ANALYTICS FOR ONE CHAPTER (CONTENT METRICS + COST LEDGER + TIMELINE) — POWERS THE READER'S
// STATS DIALOG. NO MODEL CALL, SO IT'S FREE TO OPEN.
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	// OWNERSHIP: ONLY EXPOSE STATS FOR A CHAPTER IN THE CALLER'S LIBRARY.
	if (!(await getOwnedChapterByUuid(user.id, params.uuid))) throw error(404, 'Chapter not found.');
	const stats = await getChapterStats(params.uuid);
	if (!stats) throw error(404, 'Chapter not found.');
	return json(stats);
};
