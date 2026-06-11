// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { appendChapters, getBook, ingestWebChapter, reorderChapters } from '$lib/server/books';

// -- CONSTANTS -- //

const AddBody = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('manual'), titleZh: z.string().trim().min(1), contentZh: z.string().trim().min(1) }),
	z.object({ kind: z.literal('url'), url: z.string().url() }),
]);

const ReorderBody = z.object({ order: z.array(z.string()).min(1) });

// -- FUNCTIONS -- //

// ADD CHAPTER(S) INTO AN EXISTING BOOK (PASTE OR SINGLE-URL FETCH). APPENDS AT THE TAIL.
export const POST: RequestHandler = async ({ params, request }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');

	const parsed = AddBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide { kind: "manual", titleZh, contentZh } or { kind: "url", url }.');

	if (parsed.data.kind === 'manual') {
		const { added, firstUuid } = await appendChapters(book.id, [
			{ titleZh: parsed.data.titleZh, contentZh: parsed.data.contentZh },
		]);
		return json({ added, firstUuid });
	}

	// URL: PULL THIS PAGE INTO THIS BOOK, KEEPING ITS SCRAPED chapterUrl/prevUrl/nextUrl SO THAT
	// PREV/NEXT (FETCH-AHEAD) WORK FROM THIS CHAPTER — EVEN IN A MANUAL BOOK.
	try {
		const view = await ingestWebChapter(parsed.data.url, undefined, book.id);
		return json({ added: 1, firstUuid: view.uuid });
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'Failed to fetch chapter.');
	}
};

// REORDER CHAPTERS — REWRITES seq TO MATCH THE GIVEN uuid ORDER
export const PATCH: RequestHandler = async ({ params, request }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');
	const parsed = ReorderBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'An array of chapter uuids is required.');
	try {
		await reorderChapters(book.id, parsed.data.order);
		return json({ ok: true });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not reorder chapters.');
	}
};
