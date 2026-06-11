import { error, json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { deleteBook, getBook } from '$lib/server/books';
import { db } from '$lib/server/db';
import { books, chapters } from '$lib/server/db/schema';
import { matchTerms } from '$lib/server/glossary-match';
import { translateTitle } from '$lib/server/translate';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');
	// COMPUTE hasEn IN SQL — DON'T TRANSFER EVERY CHAPTER'S FULL contentEn (POTENTIALLY MEGABYTES) JUST TO
	// TEST IT FOR null.
	const list = await db
		.select({
			uuid: chapters.uuid,
			seq: chapters.seq,
			titleZh: chapters.titleZh,
			titleEn: chapters.titleEn,
			hasEn: sql<number>`(${chapters.contentEn} is not null)`,
		})
		.from(chapters)
		.where(eq(chapters.bookId, book.id))
		.orderBy(asc(chapters.seq));
	return json({
		book,
		chapters: list.map((c) => ({
			uuid: c.uuid,
			seq: c.seq,
			titleZh: c.titleZh,
			titleEn: c.titleEn,
			hasEn: !!c.hasEn,
		})),
	});
};

// TRANSLATE THE BOOK TITLE (NOVEL NAME) ONCE, GLOSSARY-AWARE, AND CACHE IT
export const POST: RequestHandler = async ({ params }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');
	if (book.titleEn) return json({ titleEn: book.titleEn });
	try {
		const terms = await matchTerms(book.id, book.title);
		const { text } = await translateTitle(book.title, terms);
		const titleEn = text || book.title;
		await db.update(books).set({ titleEn }).where(eq(books.id, book.id));
		return json({ titleEn });
	} catch {
		// DON'T FAIL THE UI IF TRANSLATION IS UNAVAILABLE
		return json({ titleEn: book.title });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteBook(params.id);
	return json({ ok: true });
};
