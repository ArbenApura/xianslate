// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { getChapterStats } from '$lib/server/chapter-stats';

// -- FUNCTIONS -- //

// READ-ONLY ANALYTICS FOR ONE CHAPTER (CONTENT METRICS + COST LEDGER + TIMELINE) — POWERS THE READER'S
// STATS DIALOG. NO MODEL CALL, SO IT'S FREE TO OPEN.
export const GET: RequestHandler = async ({ params }) => {
	const stats = await getChapterStats(params.uuid);
	if (!stats) throw error(404, 'Chapter not found.');
	return json(stats);
};
