// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { ingestWebChapter } from '$lib/server/books';
import { isFetchError } from '$lib/server/fetch-error';

// -- CONSTANTS -- //

const Body = z.object({
	url: z.string().url(),
	// READER PREV/NEXT FETCH: PLACE THE NEW CHAPTER RELATIVE TO THE ONE NAVIGATED FROM
	fromChapterId: z.number().int().positive().optional(),
	dir: z.enum(['prev', 'next']).optional(),
	// KEEP A FETCHED NEIGHBOR IN THE CURRENT BOOK (E.G. A MANUAL BOOK BUILT FROM SCRAPED URLS)
	targetBookId: z.string().optional(),
	// THE DIRECTION FOR A NEWLY-CREATED WEB BOOK (IGNORED WHEN THE CHAPTER JOINS AN EXISTING BOOK).
	sourceLang: z.string().optional(),
	targetLang: z.string().optional(),
});

// -- FUNCTIONS -- //

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A valid chapter URL is required.');
	// A FETCH MAY TRIGGER (BILLED) SITE-SELECTOR LEARNING + AUTO-TRANSLATE DOWNSTREAM.
	try {
		const { url, fromChapterId, dir, targetBookId, sourceLang, targetLang } = parsed.data;
		const anchor = fromChapterId && dir ? { fromChapterId, dir } : undefined;
		const pair = sourceLang && targetLang ? { sourceLang, targetLang } : undefined;
		const view = await ingestWebChapter(url, user.id, anchor, targetBookId, pair);
		return json(view);
	} catch (e) {
		// TYPED FAILURE → ITS OWN STATUS + HUMAN MESSAGE (INVALID / BLOCKED / UNSUPPORTED / NOT FOUND …)
		if (isFetchError(e)) throw error(e.status, e.message);
		throw error(502, e instanceof Error ? e.message : 'Couldn’t fetch that chapter.');
	}
};
