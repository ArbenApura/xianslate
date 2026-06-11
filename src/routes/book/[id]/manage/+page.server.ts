import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { books, chapters } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

// LOAD THE BOOK + ITS ORDERED CHAPTERS FOR THE MANAGEMENT VIEW
export const load: PageServerLoad = async ({ params }) => {
	const [book] = await db.select().from(books).where(eq(books.id, params.id)).limit(1);
	if (!book) throw error(404, 'Book not found.');

	const list = await db
		.select({
			uuid: chapters.uuid,
			seq: chapters.seq,
			titleZh: chapters.titleZh,
			titleEn: chapters.titleEn,
			contentEn: chapters.contentEn,
		})
		.from(chapters)
		.where(eq(chapters.bookId, book.id))
		.orderBy(asc(chapters.seq));

	return {
		book: { id: book.id, title: book.titleEn ?? book.title, sourceType: book.sourceType },
		chapters: list.map((c) => ({
			uuid: c.uuid!,
			seq: c.seq,
			titleZh: c.titleZh,
			titleEn: c.titleEn,
			hasEn: c.contentEn != null,
		})),
	};
};
