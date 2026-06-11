import { error, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { books, chapters } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

// NO CHAPTER IN THE PATH → REDIRECT TO THE RESUME POINT (ELSE THE FIRST CHAPTER)
export const load: PageServerLoad = async ({ params }) => {
	const [book] = await db.select().from(books).where(eq(books.id, params.id)).limit(1);
	if (!book) throw error(404, 'Book not found.');

	let uuid: string | null = null;
	if (book.lastChapterId != null) {
		const [c] = await db
			.select({ uuid: chapters.uuid })
			.from(chapters)
			.where(eq(chapters.id, book.lastChapterId))
			.limit(1);
		uuid = c?.uuid ?? null;
	}
	if (!uuid) {
		const [c] = await db
			.select({ uuid: chapters.uuid })
			.from(chapters)
			.where(eq(chapters.bookId, book.id))
			.orderBy(asc(chapters.seq))
			.limit(1);
		uuid = c?.uuid ?? null;
	}
	// EMPTY BOOK → SEND TO THE MANAGEMENT PAGE (ADD CHAPTERS / CURATE GLOSSARY) RATHER THAN 404
	if (!uuid) throw redirect(307, `/book/${book.id}/manage/`);
	throw redirect(307, `/book/${book.id}/${uuid}/`);
};
