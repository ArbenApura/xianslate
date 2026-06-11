// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { setReadProgress } from '$lib/server/books';

// -- CONSTANTS -- //

const Body = z.object({ progress: z.number().min(0).max(1) });

// -- FUNCTIONS -- //

// RECORD HOW FAR THE READER HAS READ THIS CHAPTER (0..1). CALLED FREQUENTLY (DEBOUNCED) WHILE READING AND
// VIA navigator.sendBeacon ON LEAVE — SO IT MUST BE TINY AND TOLERANT OF A beacon's text/plain BODY.
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A numeric progress (0..1) is required.');
	await setReadProgress(params.uuid, parsed.data.progress);
	return json({ ok: true });
};
