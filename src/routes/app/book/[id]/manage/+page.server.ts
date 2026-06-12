// IMPORTED DEP-TYPES
import type { PageServerLoad } from './$types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
// IMPORTED MODULES
import { db } from '$lib/server/db';
import { books, chapters } from '$lib/server/db/schema';

// -- FUNCTIONS -- //

// LOAD THE BOOK + ITS ORDERED CHAPTERS FOR THE MANAGEMENT VIEW
export const load: PageServerLoad = async ({ params }) => {
	const [book] = await db.select().from(books).where(eq(books.id, params.id)).limit(1);
	if (!book) throw error(404, 'Book not found.');

	const list = await db
		.select({
			id: chapters.id,
			uuid: chapters.uuid,
			seq: chapters.seq,
			titleSource: chapters.titleSource,
			titleTarget: chapters.titleTarget,
			contentTarget: chapters.contentTarget,
			readProgress: chapters.readProgress,
		})
		.from(chapters)
		.where(eq(chapters.bookId, book.id))
		.orderBy(asc(chapters.seq));

	// THE RESUME POINT (BOOK'S lastChapterId) → ITS uuid, SO THE LISTING CAN MARK READING PROGRESS LIKE THE READER
	const resumeUuid = list.find((c) => c.id === book.lastChapterId)?.uuid ?? null;

	return {
		book: {
			id: book.id,
			title: book.titleTarget ?? book.title,
			sourceType: book.sourceType,
			sourceLang: book.sourceLang,
			targetLang: book.targetLang,
		},
		resumeUuid,
		chapters: list.map((c) => ({
			uuid: c.uuid!,
			seq: c.seq,
			titleSource: c.titleSource,
			titleTarget: c.titleTarget,
			hasTarget: c.contentTarget != null,
			readProgress: c.readProgress ?? 0,
		})),
	};
};
