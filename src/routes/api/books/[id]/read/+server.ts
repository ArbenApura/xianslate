// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { setBookReadStatus } from '$lib/server/books';

// -- CONSTANTS -- //

const Body = z.object({
	// THE CHAPTER THE ACTION IS ANCHORED ON (uuid).
	uuid: z.string().min(1),
	// WHICH CHAPTERS TO AFFECT RELATIVE TO THE ANCHOR.
	scope: z.enum(['this', 'previous', 'all']),
	// true = MARK READ (DONE), false = MARK UNREAD.
	read: z.boolean(),
});

// -- FUNCTIONS -- //

// BULK MARK A BOOK'S CHAPTERS READ/UNREAD (THIS / EVERYTHING BEFORE THIS / ALL) — POWERS THE MANAGE
// PAGE'S "Mark previous read", "Mark unread", … MENU ITEMS.
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide { uuid, scope: this|previous|all, read: boolean }.');
	await setBookReadStatus(params.id, parsed.data.scope, parsed.data.uuid, parsed.data.read);
	return json({ ok: true });
};
