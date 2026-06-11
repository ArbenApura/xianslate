// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { appendChapters, getBook, ingestWebChapter, reorderChapters } from '$lib/server/books';
import { isFetchError } from '$lib/server/fetch-error';

// -- CONSTANTS -- //

const AddBody = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('manual'),
		titleSource: z.string().trim().min(1),
		contentSource: z.string().trim().min(1),
	}),
	z.object({ kind: z.literal('url'), url: z.string().url() }),
]);

const ReorderBody = z.object({ order: z.array(z.string()).min(1) });

// -- FUNCTIONS -- //

// ADD CHAPTER(S) INTO AN EXISTING BOOK (PASTE OR SINGLE-URL FETCH). APPENDS AT THE TAIL.
export const POST: RequestHandler = async ({ params, request }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');

	const parsed = AddBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		throw error(400, 'Provide { kind: "manual", titleSource, contentSource } or { kind: "url", url }.');

	if (parsed.data.kind === 'manual') {
		const { added, firstUuid } = await appendChapters(book.id, [
			{ titleSource: parsed.data.titleSource, contentSource: parsed.data.contentSource },
		]);
		return json({ added, firstUuid });
	}

	// URL: PULL THIS PAGE INTO THIS BOOK, KEEPING ITS SCRAPED chapterUrl/prevUrl/nextUrl SO THAT
	// PREV/NEXT (FETCH-AHEAD) WORK FROM THIS CHAPTER — EVEN IN A MANUAL BOOK.
	try {
		const view = await ingestWebChapter(parsed.data.url, undefined, book.id);
		return json({ added: 1, firstUuid: view.uuid });
	} catch (e) {
		// TYPED FAILURE → ITS OWN STATUS + HUMAN MESSAGE (INVALID / BLOCKED / UNSUPPORTED / NOT FOUND …)
		if (isFetchError(e)) throw error(e.status, e.message);
		throw error(502, e instanceof Error ? e.message : 'Couldn’t fetch that chapter.');
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
