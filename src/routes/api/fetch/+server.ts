import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { ingestWebChapter } from '$lib/server/books';
import type { RequestHandler } from './$types';

const Body = z.object({
	url: z.string().url(),
	// READER PREV/NEXT FETCH: PLACE THE NEW CHAPTER RELATIVE TO THE ONE NAVIGATED FROM
	fromChapterId: z.number().int().positive().optional(),
	dir: z.enum(['prev', 'next']).optional(),
	// KEEP A FETCHED NEIGHBOR IN THE CURRENT BOOK (E.G. A MANUAL BOOK BUILT FROM SCRAPED URLS)
	targetBookId: z.string().optional(),
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A valid chapter URL is required.');
	try {
		const { url, fromChapterId, dir, targetBookId } = parsed.data;
		const anchor = fromChapterId && dir ? { fromChapterId, dir } : undefined;
		const view = await ingestWebChapter(url, anchor, targetBookId);
		return json(view);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'Failed to fetch chapter.');
	}
};
