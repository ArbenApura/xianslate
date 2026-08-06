// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { appendChapters, assertBookOwner, ingestWebChapter, reorderChapters } from '$lib/server/books';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
import { isFetchError } from '$lib/server/fetch-error';

// -- CONSTANTS -- //

const AddBody = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('manual'),
		// CAP THE PASTED CHAPTER SO A SINGLE REQUEST CAN'T BILL UNBOUNDED EXTRACTION/TRANSLATION TOKENS.
		titleSource: z.string().trim().min(1).max(500, 'Title is too long.'),
		contentSource: z.string().trim().min(1).max(2_000_000, 'Chapter text is too long (max 2MB).'),
	}),
	z.object({ kind: z.literal('url'), url: z.string().url() }),
]);

const ReorderBody = z.object({ order: z.array(z.string()).min(1) });

// -- FUNCTIONS -- //

// THE BOOK + ITS ORDERED CHAPTERS FOR THE MANAGE VIEW (AND THE RESUME REDIRECT). REPLACES THE FORMER
// manage/+page.server.ts SO /app RENDERS THE SAME UNDER WEB SSR AND AS A STATIC SPA. hasTarget IS COMPUTED
// IN SQL SO WE NEVER TRANSFER EVERY CHAPTER'S FULL contentTarget JUST TO NULL-TEST IT.
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);

	const list = await db
		.select({
			id: chapters.id,
			uuid: chapters.uuid,
			seq: chapters.seq,
			titleSource: chapters.titleSource,
			titleTarget: chapters.titleTarget,
			hasTarget: sql<number>`(${chapters.contentTarget} is not null)`,
			readProgress: chapters.readProgress,
		})
		.from(chapters)
		.where(eq(chapters.bookId, book.id))
		.orderBy(asc(chapters.seq));

	// THE RESUME POINT (BOOK'S lastChapterId) → ITS uuid, SO THE LISTING MARKS READING PROGRESS LIKE THE READER
	const resumeUuid = list.find((c) => c.id === book.lastChapterId)?.uuid ?? null;

	return json({
		// title IS THE RAW SOURCE TITLE HERE (NOT titleTarget ?? title) — THE MANAGE PAGE EDITS BOTH SIDES AND
		// DERIVES ITS OWN DISPLAY TITLE. THE READER'S RESUME LOADER IGNORES book.title, SO THIS IS SAFE.
		book: {
			id: book.id,
			title: book.title,
			titleTarget: book.titleTarget,
			author: book.author,
			authorTarget: book.authorTarget,
			coverUrl: book.coverUrl,
			sourceUrl: book.sourceUrl,
			sourceType: book.sourceType,
			sourceLang: book.sourceLang,
			targetLang: book.targetLang,
		},
		resumeUuid,
		chapters: list.map((c) => ({
			// NUMERIC id IS NEEDED CLIENT-SIDE TO DRIVE /api/translate (WHICH KEYS ON chapterId), E.G. THE MANAGE
			// PAGE'S BATCH TRANSLATE. OWNERSHIP IS RE-CHECKED THERE, SO EXPOSING IT IS SAFE (THE READER ALSO DOES).
			id: c.id,
			uuid: c.uuid!,
			seq: c.seq,
			titleSource: c.titleSource,
			titleTarget: c.titleTarget,
			hasTarget: !!c.hasTarget,
			readProgress: c.readProgress ?? 0,
		})),
	});
};

// ADD CHAPTER(S) INTO AN EXISTING BOOK (PASTE OR SINGLE-URL FETCH). APPENDS AT THE TAIL.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);

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
		const view = await ingestWebChapter(parsed.data.url, user.id, undefined, book.id);
		return json({ added: 1, firstUuid: view.uuid });
	} catch (e) {
		// TYPED FAILURE → ITS OWN STATUS + HUMAN MESSAGE (INVALID / BLOCKED / UNSUPPORTED / NOT FOUND …)
		if (isFetchError(e)) throw error(e.status, e.message);
		throw error(502, e instanceof Error ? e.message : 'Couldn’t fetch that chapter.');
	}
};

// REORDER CHAPTERS — REWRITES seq TO MATCH THE GIVEN uuid ORDER
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);
	const parsed = ReorderBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'An array of chapter uuids is required.');
	try {
		await reorderChapters(book.id, parsed.data.order);
		return json({ ok: true });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not reorder chapters.');
	}
};
