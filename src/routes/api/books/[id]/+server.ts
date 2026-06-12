// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { isMonolingual } from '$lib/languages';
import { deleteBook, getBook } from '$lib/server/books';
import { db } from '$lib/server/db';
import { books, chapters } from '$lib/server/db/schema';
import { matchTerms } from '$lib/server/glossary-match';
import { recordAiUsage } from '$lib/server/site-stats';
import { translateTerm, translateTitle } from '$lib/server/translate';

// -- FUNCTIONS -- //

export const GET: RequestHandler = async ({ params }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');
	// COMPUTE hasTarget IN SQL — DON'T TRANSFER EVERY CHAPTER'S FULL contentTarget (POTENTIALLY MEGABYTES)
	// JUST TO TEST IT FOR null.
	const list = await db
		.select({
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
	return json({
		book,
		chapters: list.map((c) => ({
			uuid: c.uuid,
			seq: c.seq,
			titleSource: c.titleSource,
			titleTarget: c.titleTarget,
			hasTarget: !!c.hasTarget,
			readProgress: c.readProgress ?? 0,
		})),
	});
};

// TRANSLATE THE BOOK TITLE (NOVEL NAME) + ROMANIZE THE AUTHOR ONCE, GLOSSARY-AWARE, AND CACHE BOTH
export const POST: RequestHandler = async ({ params }) => {
	const book = await getBook(params.id);
	if (!book) throw error(404, 'Book not found.');
	// READ-IN-ORIGINAL BOOK: NO TRANSLATION DIRECTION — RETURN THE SOURCE TITLE/AUTHOR AS-IS SO THE LIBRARY
	// SHOWS THEM UNCHANGED INSTEAD OF TRANSLATING INTO THE FALLBACK LANGUAGE. (DEFENSE IN DEPTH — THE CLIENT
	// ALREADY SKIPS THESE; THIS GUARANTEES IT EVEN IF SOMETHING ELSE CALLS THIS ENDPOINT.)
	if (isMonolingual(book.targetLang)) {
		return json({ titleTarget: null, authorTarget: null });
	}
	// NOTHING LEFT TO DO: TITLE TRANSLATED AND (NO AUTHOR, OR AUTHOR ALREADY RENDERED)
	if (book.titleTarget && (!book.author || book.authorTarget)) {
		return json({ titleTarget: book.titleTarget, authorTarget: book.authorTarget });
	}

	const pair = { sourceLang: book.sourceLang, targetLang: book.targetLang };
	let titleTarget = book.titleTarget;
	let authorTarget = book.authorTarget;
	const set: { titleTarget?: string; authorTarget?: string } = {};
	try {
		if (!titleTarget) {
			const terms = await matchTerms(book.id, book.title);
			const { text, usage } = await translateTitle(book.title, terms, pair);
			await recordAiUsage('title', usage);
			titleTarget = text || book.title;
			set.titleTarget = titleTarget;
		}
		if (book.author && !authorTarget) {
			// AUTHOR IS A PERSON NAME → RENDER INTO THE TARGET LANGUAGE VIA THE TERM TRANSLATOR, GLOSSARY-AWARE
			const terms = await matchTerms(book.id, book.author);
			const { text, usage } = await translateTerm(book.author, pair, terms);
			await recordAiUsage('term', usage);
			authorTarget = text || book.author;
			set.authorTarget = authorTarget;
		}
		if (Object.keys(set).length) await db.update(books).set(set).where(eq(books.id, book.id));
		return json({ titleTarget, authorTarget });
	} catch {
		// DON'T FAIL THE UI IF TRANSLATION IS UNAVAILABLE — FALL BACK TO THE SOURCE VALUES
		return json({ titleTarget: titleTarget ?? book.title, authorTarget: authorTarget ?? book.author });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteBook(params.id);
	return json({ ok: true });
};
