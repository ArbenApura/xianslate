// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
// IMPORTED MODULES
import { isMonolingual } from '$lib/languages';
import { requireUser } from '$lib/server/auth/user';
import { assertBookOwner, deleteBook } from '$lib/server/books';
import { db } from '$lib/server/db';
import { books, chapters } from '$lib/server/db/schema';
import { matchTerms } from '$lib/server/glossary-match';
import { recordAiUsage } from '$lib/server/site-stats';
import { translateTerm, translateTitle } from '$lib/server/translate';

// -- CONSTANTS -- //

// EDIT BOOK METADATA — ALL FIELDS OPTIONAL; AT LEAST ONE MUST BE PRESENT (CHECKED IN THE HANDLER). EMPTY
// STRINGS ON THE NULLABLE *Target / author FIELDS COLLAPSE TO null SO "CLEAR IT" IS EXPRESSIBLE FROM THE UI.
const PatchBody = z.object({
	title: z.string().trim().min(1).optional(),
	titleTarget: z.string().trim().nullable().optional(),
	author: z.string().trim().nullable().optional(),
	authorTarget: z.string().trim().nullable().optional(),
	// LIBRARY ORGANIZATION + COVER. coverUrl ACCEPTS AN http(s) URL OR A data: URI (CLIENT-RESIZED UPLOAD),
	// CAPPED SO A HUGE BASE64 BLOB CAN'T BLOAT THE ROW / LIBRARY PAYLOAD; EMPTY STRING CLEARS IT.
	pinned: z.boolean().optional(),
	archived: z.boolean().optional(),
	coverUrl: z
		.string()
		.trim()
		.max(700_000)
		.refine((v) => v === '' || /^(https?:\/\/|data:image\/)/.test(v), 'Cover must be an image URL or upload.')
		.nullable()
		.optional(),
});

// -- FUNCTIONS -- //

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);
	// COMPUTE hasTarget IN SQL — DON'T TRANSFER EVERY CHAPTER'S FULL contentTarget (POTENTIALLY MEGABYTES)
	// JUST TO TEST IT FOR null.
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
	return json({
		book,
		chapters: list.map((c) => ({
			// NUMERIC id POWERS CLIENT-SIDE /api/translate CALLS (BATCH TRANSLATE) — OWNERSHIP IS RE-CHECKED THERE.
			id: c.id,
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
export const POST: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);
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

// EDIT THE BOOK'S TITLE / AUTHOR (SOURCE + TRANSLATED). THE LIBRARY'S LAZY BACKFILL (THE POST ABOVE) ONLY
// FILLS *Target WHEN IT'S null, SO CLEARING titleTarget HERE LETS A RENAME RE-TRANSLATE ON NEXT LIBRARY LOAD.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);

	const parsed = PatchBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide a title, author, or their translations.');
	const b = parsed.data;

	const set: {
		title?: string;
		titleTarget?: string | null;
		author?: string | null;
		authorTarget?: string | null;
		pinned?: boolean;
		archived?: boolean;
		coverUrl?: string | null;
	} = {};
	if (b.title !== undefined) set.title = b.title;
	if (b.titleTarget !== undefined) set.titleTarget = b.titleTarget || null;
	if (b.author !== undefined) set.author = b.author || null;
	if (b.authorTarget !== undefined) set.authorTarget = b.authorTarget || null;
	if (b.pinned !== undefined) set.pinned = b.pinned;
	if (b.archived !== undefined) set.archived = b.archived;
	if (b.coverUrl !== undefined) set.coverUrl = b.coverUrl || null;
	if (Object.keys(set).length === 0) throw error(400, 'Nothing to update.');

	const [updated] = await db.update(books).set(set).where(eq(books.id, book.id)).returning();
	return json({
		ok: true,
		book: {
			title: updated.title,
			titleTarget: updated.titleTarget,
			author: updated.author,
			authorTarget: updated.authorTarget,
			pinned: updated.pinned,
			archived: updated.archived,
			coverUrl: updated.coverUrl,
		},
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	await assertBookOwner(user.id, params.id);
	await deleteBook(params.id);
	return json({ ok: true });
};
