// IMPORTED TYPES
import type { ImportedBook, SourceType } from '$lib/types';
// IMPORTED DEP-MODULES
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
// IMPORTED MODULES
import { db } from './db';
import { books, chapters, type Book, type Chapter } from './db/schema';
import { fetchChapter } from './fetcher';

// -- TYPES -- //

export interface ChapterView {
	id: number; // INTERNAL PK — USED BY translate/extract
	uuid: string; // STABLE PUBLIC ID — USED IN URLS
	bookId: string;
	bookTitle: string;
	sourceType: SourceType;
	seq: number;
	titleZh: string;
	titleEn: string | null;
	contentZh: string;
	contentEn: string | null;
	chapterUrl: string | null;
	prevUrl: string | null;
	nextUrl: string | null;
	indexUrl: string | null;
	prevUuid: string | null;
	nextUuid: string | null;
}

export interface BookSummary {
	id: string;
	title: string;
	titleEn: string | null;
	author: string | null;
	sourceType: SourceType;
	sourceUrl: string | null;
	chapterCount: number;
	// CHAPTERS UP TO & INCLUDING THE RESUME POINT (READING PROGRESS); 0 IF NOTHING READ YET
	readChapters: number;
	// CHAPTERS WITH A STORED ENGLISH TRANSLATION (TRANSLATION COVERAGE)
	translatedChapters: number;
	lastChapterUuid: string | null;
	firstChapterUuid: string | null;
	lastReadAt: number | null;
	createdAt: number;
}

// CHUNKED MULTI-ROW INSERT (SQLite CAPS BOUND PARAMETERS PER STATEMENT) — RETURNS {id,uuid} IN ORDER.
type ChapterInsert = typeof chapters.$inferInsert;

// -- FUNCTIONS -- //

async function neighborUuidByUrl(url: string | null): Promise<string | null> {
	if (!url) return null;
	const row = await db.select({ uuid: chapters.uuid }).from(chapters).where(eq(chapters.chapterUrl, url)).limit(1);
	return row[0]?.uuid ?? null;
}

// GAP-TOLERANT NEIGHBOR FOR seq-ORDERED BOOKS: NEAREST CHAPTER BELOW (prev) / ABOVE (next).
// TOLERATES seq GAPS LEFT BY DELETES/REORDERS — NO NEED TO RE-PACK seq AFTER EVERY EDIT.
async function neighborUuidByOrder(bookId: string, seq: number, dir: 'prev' | 'next'): Promise<string | null> {
	const row = await db
		.select({ uuid: chapters.uuid })
		.from(chapters)
		.where(and(eq(chapters.bookId, bookId), dir === 'prev' ? lt(chapters.seq, seq) : gt(chapters.seq, seq)))
		.orderBy(dir === 'prev' ? desc(chapters.seq) : asc(chapters.seq))
		.limit(1);
	return row[0]?.uuid ?? null;
}

async function toView(ch: Chapter, book: Book): Promise<ChapterView> {
	const [prevUuid, nextUuid] =
		book.sourceType === 'web'
			? await Promise.all([neighborUuidByUrl(ch.prevUrl), neighborUuidByUrl(ch.nextUrl)])
			: await Promise.all([
					neighborUuidByOrder(book.id, ch.seq, 'prev'),
					neighborUuidByOrder(book.id, ch.seq, 'next'),
				]);
	return {
		id: ch.id,
		uuid: ch.uuid!,
		bookId: book.id,
		bookTitle: book.titleEn ?? book.title,
		sourceType: book.sourceType,
		seq: ch.seq,
		titleZh: ch.titleZh,
		titleEn: ch.titleEn,
		contentZh: ch.contentZh,
		contentEn: ch.contentEn,
		chapterUrl: ch.chapterUrl,
		prevUrl: ch.prevUrl,
		nextUrl: ch.nextUrl,
		indexUrl: ch.indexUrl,
		prevUuid,
		nextUuid,
	};
}

export async function listBooks(): Promise<BookSummary[]> {
	const rows = await db.select().from(books).orderBy(desc(books.createdAt));
	if (rows.length === 0) return [];

	// CHAPTER COUNT + TRANSLATED COUNT + FIRST-CHAPTER uuid PER BOOK IN ONE PASS. SQLite RETURNS THE BARE
	// `uuid` FROM THE SAME ROW min(seq) CAME FROM, SO THIS YIELDS THE FIRST CHAPTER'S uuid WITHOUT N QUERIES.
	const agg = await db
		.select({
			bookId: chapters.bookId,
			n: sql<number>`count(*)`,
			translated: sql<number>`sum(case when ${chapters.contentEn} is not null then 1 else 0 end)`,
			firstUuid: chapters.uuid,
			minSeq: sql<number>`min(${chapters.seq})`,
		})
		.from(chapters)
		.groupBy(chapters.bookId);
	const byBook = new Map(agg.map((a) => [a.bookId, a]));

	// RESOLVE EVERY RESUME-POINT id → uuid IN A SINGLE QUERY
	const lastIds = rows.map((b) => b.lastChapterId).filter((id): id is number => id != null);
	const lastUuids = new Map<number, string>();
	if (lastIds.length) {
		const lastRows = await db
			.select({ id: chapters.id, uuid: chapters.uuid })
			.from(chapters)
			.where(inArray(chapters.id, lastIds));
		for (const r of lastRows) if (r.uuid) lastUuids.set(r.id, r.uuid);
	}

	// READING PROGRESS: COUNT OF CHAPTERS AT OR BEFORE EACH BOOK'S RESUME POINT, IN ONE JOIN (resume = rc).
	const rc = alias(chapters, 'rc');
	const readRows = await db
		.select({ bookId: chapters.bookId, readN: sql<number>`count(*)` })
		.from(chapters)
		.innerJoin(books, eq(books.id, chapters.bookId))
		.innerJoin(rc, eq(rc.id, books.lastChapterId))
		.where(lte(chapters.seq, rc.seq))
		.groupBy(chapters.bookId);
	const readByBook = new Map(readRows.map((r) => [r.bookId, Number(r.readN)]));

	return rows.map((b) => {
		const a = byBook.get(b.id);
		return {
			id: b.id,
			title: b.title,
			titleEn: b.titleEn,
			author: b.author,
			sourceType: b.sourceType,
			sourceUrl: b.sourceUrl,
			chapterCount: Number(a?.n ?? 0),
			readChapters: readByBook.get(b.id) ?? 0,
			translatedChapters: Number(a?.translated ?? 0),
			lastChapterUuid: b.lastChapterId != null ? (lastUuids.get(b.lastChapterId) ?? null) : null,
			firstChapterUuid: a?.firstUuid ?? null,
			lastReadAt: b.lastReadAt,
			createdAt: b.createdAt,
		};
	});
}

export async function getBook(id: string): Promise<Book | null> {
	const row = await db.select().from(books).where(eq(books.id, id)).limit(1);
	return row[0] ?? null;
}

export async function deleteBook(id: string): Promise<void> {
	await db.delete(books).where(eq(books.id, id));
}

/**
 * RESOLVE A CHAPTER BY ITS PUBLIC UUID.
 * `recordResume` MUST ONLY BE SET ON A REAL PAGE VIEW (THE SSR LOAD) — NOT FROM PREFETCH / JSON
 * LOOKUPS, OTHERWISE BACKGROUND PREFETCH WOULD SILENTLY ADVANCE THE BOOK'S "RESUME" POINTER.
 */
export async function getChapterView(uuid: string, recordResume = false): Promise<ChapterView | null> {
	const row = await db.select().from(chapters).where(eq(chapters.uuid, uuid)).limit(1);
	if (!row[0]) return null;
	const book = await getBook(row[0].bookId);
	if (!book) return null;
	if (recordResume) {
		await db
			.update(books)
			.set({ lastChapterId: row[0].id, lastReadAt: Date.now() })
			.where(eq(books.id, book.id));
	}
	return toView(row[0], book);
}

/**
 * FETCH (OR RETURN CACHED) A WEB CHAPTER.
 * - `anchor` (READER Prev/Next FETCH) INSERTS THE NEW CHAPTER AT THE CORRECT seq RELATIVE TO THE
 *   CHAPTER NAVIGATED FROM, INSTEAD OF APPENDING TO THE TAIL.
 * - `targetBookId` FORCES THE CHAPTER INTO A SPECIFIC EXISTING BOOK (E.G. A MANUAL BOOK THE USER IS
 *   BUILDING FROM SCRAPED URLs). WHEN OMITTED, IT CREATES/USES THE SITE'S OWN WEB BOOK AS BEFORE.
 *   EITHER WAY THE CHAPTER KEEPS ITS SCRAPED chapterUrl/prevUrl/nextUrl, SO Prev/Next STAY ENABLED.
 */
export async function ingestWebChapter(
	url: string,
	anchor?: { fromChapterId: number; dir: 'prev' | 'next' },
	targetBookId?: string,
): Promise<ChapterView> {
	// NOTE: THE RESUME POINTER (books.lastChapterId) IS RECORDED ONLY BY THE REAL CHAPTER PAGE VIEW,
	// NOT HERE — SO PREFETCH/FETCH-AHEAD CAN PULL CHAPTERS WITHOUT MOVING WHERE THE READER LEFT OFF.
	const existing = await db.select().from(chapters).where(eq(chapters.chapterUrl, url)).limit(1);
	if (existing[0]) {
		const book = await getBook(existing[0].bookId);
		if (book) return toView(existing[0], book);
	}

	const parsed = await fetchChapter(url);
	const bookId = targetBookId ?? parsed.bookId ?? `web-${randomUUID()}`;

	let book = await getBook(bookId);
	if (!book) {
		// AN EXPLICIT TARGET BOOK MUST ALREADY EXIST; ONLY AUTO-CREATE THE SITE'S OWN WEB BOOK
		if (targetBookId) throw new Error('Target book not found.');
		// onConflictDoNothing GUARDS THE RACE WHERE TWO CONCURRENT FIRST-FETCHES BOTH AUTO-CREATE THE
		// SAME DETERMINISTIC web-bookId (PK COLLISION → 500). LOSER NO-OPS, THEN RE-READS THE WINNER'S ROW.
		await db
			.insert(books)
			.values({
				id: bookId,
				sourceType: 'web',
				title: parsed.bookTitle ?? parsed.titleZh,
				author: parsed.author ?? null,
				sourceUrl: parsed.indexUrl ?? url,
			})
			.onConflictDoNothing();
		book = await getBook(bookId);
	}
	if (!book) throw new Error('Failed to create book.');

	// SEQ PLACEMENT + INSERT IN ONE TRANSACTION SO CONCURRENT INGESTS CAN'T (a) BOTH READ THE SAME max(seq)
	// AND COLLIDE ON (book_id, seq), OR (b) BOTH PASS THE chapterUrl EXISTENCE CHECK AND COLLIDE ON THE
	// UNIQUE URL. THE LOSER OF A chapterUrl RACE RE-READS THE WINNER'S ROW INSTEAD OF THROWING A 500.
	const inserted = await db.transaction(async (tx) => {
		const dup = await tx.select().from(chapters).where(eq(chapters.chapterUrl, url)).limit(1);
		if (dup[0]) return dup[0];

		let seq: number;
		let anchorSeq: number | null = null;
		if (anchor) {
			const [a] = await tx
				.select({ seq: chapters.seq, bookId: chapters.bookId })
				.from(chapters)
				.where(eq(chapters.id, anchor.fromChapterId))
				.limit(1);
			if (a && a.bookId === bookId) anchorSeq = a.seq;
		}
		if (anchorSeq != null) {
			const target = anchor!.dir === 'prev' ? anchorSeq : anchorSeq + 1;
			// INLINE TWO-PHASE NEGATIVE BUMP (SAME AS shiftSeqsFrom) — KEEPS IT INSIDE THIS TRANSACTION.
			await tx
				.update(chapters)
				.set({ seq: sql`-(${chapters.seq} + 1)` })
				.where(and(eq(chapters.bookId, bookId), gte(chapters.seq, target)));
			await tx
				.update(chapters)
				.set({ seq: sql`-${chapters.seq}` })
				.where(and(eq(chapters.bookId, bookId), lt(chapters.seq, 0)));
			seq = target;
		} else {
			const [m] = await tx
				.select({ m: sql<number>`coalesce(max(${chapters.seq}), -1)` })
				.from(chapters)
				.where(eq(chapters.bookId, bookId));
			seq = Number(m?.m ?? -1) + 1;
		}

		const ins = await tx
			.insert(chapters)
			.values({
				bookId,
				seq,
				chapterUrl: url,
				siteChapterId: parsed.siteChapterId ?? null,
				titleZh: parsed.titleZh,
				contentZh: parsed.contentZh,
				prevUrl: parsed.prevUrl ?? null,
				nextUrl: parsed.nextUrl ?? null,
				indexUrl: parsed.indexUrl ?? null,
				fetchedAt: Date.now(),
			})
			.onConflictDoNothing()
			.returning();
		if (ins[0]) return ins[0];
		// LOST THE chapterUrl RACE — RETURN THE ROW THE WINNER INSERTED.
		const [row] = await tx.select().from(chapters).where(eq(chapters.chapterUrl, url)).limit(1);
		return row;
	});

	return toView(inserted, book);
}

/** PERSIST AN EPUB/TXT IMPORT; RETURNS THE NEW BOOK id + FIRST CHAPTER uuid */
export async function createImportedBook(
	imported: ImportedBook,
	sourceUrl: string | null = null,
): Promise<{ bookId: string; firstChapterUuid: string }> {
	const bookId = `${imported.sourceType}-${randomUUID()}`;
	const now = Date.now();
	// ONE TRANSACTION FOR THE WHOLE IMPORT: A FAILURE PARTWAY THROUGH A THOUSAND-CHAPTER BOOK ROLLS BACK
	// EVERYTHING (NO HALF-IMPORTED BOOK), AND CHAPTERS GO IN AS BATCHED MULTI-ROW INSERTS, NOT N ROUND-TRIPS.
	const firstChapterUuid = await db.transaction(async (tx) => {
		await tx.insert(books).values({
			id: bookId,
			sourceType: imported.sourceType,
			title: imported.title,
			author: imported.author ?? null,
			sourceUrl,
		});

		const rows = imported.chapters.map((ch, i) => ({
			bookId,
			seq: i,
			titleZh: ch.titleZh,
			contentZh: ch.contentZh,
			fetchedAt: now,
		}));
		const inserted = await batchInsertChapters(tx, rows);
		const first = inserted[0];
		if (first) await tx.update(books).set({ lastChapterId: first.id }).where(eq(books.id, bookId));
		return first?.uuid ?? '';
	});
	return { bookId, firstChapterUuid };
}

async function batchInsertChapters(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	rows: ChapterInsert[],
): Promise<{ id: number; uuid: string | null }[]> {
	const CHUNK = 100;
	const out: { id: number; uuid: string | null }[] = [];
	for (let i = 0; i < rows.length; i += CHUNK) {
		const part = await tx
			.insert(chapters)
			.values(rows.slice(i, i + CHUNK))
			.returning({ id: chapters.id, uuid: chapters.uuid });
		out.push(...part);
	}
	return out;
}

/** CREATE AN EMPTY, MANUALLY-MANAGED BOOK (NO CHAPTERS YET) — CURATE THE GLOSSARY FIRST */
export async function createEmptyBook(input: { title: string; author?: string | null }): Promise<{ id: string }> {
	const id = `manual-${randomUUID()}`;
	await db.insert(books).values({
		id,
		sourceType: 'manual',
		title: input.title.trim() || 'Untitled',
		author: input.author?.trim() || null,
	});
	return { id };
}

/** APPEND CHAPTERS TO AN EXISTING BOOK AT THE TAIL (seq = max+1, max+2, …) */
export async function appendChapters(
	bookId: string,
	list: { titleZh: string; contentZh: string }[],
): Promise<{ added: number; firstUuid: string | null }> {
	const clean = list
		.map((c) => ({ titleZh: c.titleZh.trim(), contentZh: c.contentZh.trim() }))
		.filter((c) => c.contentZh.length > 0);
	if (clean.length === 0) return { added: 0, firstUuid: null };
	const now = Date.now();

	// READ max(seq) AND INSERT IN ONE TRANSACTION SO TWO CONCURRENT APPENDS CAN'T BOTH GRAB THE SAME BASE
	// SEQ AND COLLIDE ON (book_id, seq). CHAPTERS GO IN AS BATCHED MULTI-ROW INSERTS.
	return await db.transaction(async (tx) => {
		const [m] = await tx
			.select({ m: sql<number>`coalesce(max(${chapters.seq}), -1)` })
			.from(chapters)
			.where(eq(chapters.bookId, bookId));
		const base = Number(m?.m ?? -1) + 1;

		const rows = clean.map((c, i) => ({
			bookId,
			seq: base + i,
			titleZh: c.titleZh || `第 ${base + i + 1} 章`,
			contentZh: c.contentZh,
			fetchedAt: now,
		}));
		const inserted = await batchInsertChapters(tx, rows);
		const first = inserted[0] ?? null;

		// SET THE RESUME POINT IF THE BOOK PREVIOUSLY HAD NONE (E.G. FIRST CHAPTERS OF AN EMPTY BOOK)
		const [book] = await tx.select({ last: books.lastChapterId }).from(books).where(eq(books.id, bookId)).limit(1);
		if (book && book.last == null && first) {
			await tx.update(books).set({ lastChapterId: first.id }).where(eq(books.id, bookId));
		}
		return { added: clean.length, firstUuid: first?.uuid ?? null };
	});
}

/** REWRITE seq TO MATCH orderedUuids (0..n-1). VALIDATES THE SET MATCHES THE BOOK EXACTLY. */
export async function reorderChapters(bookId: string, orderedUuids: string[]): Promise<void> {
	await db.transaction(async (tx) => {
		// VALIDATE INSIDE THE TRANSACTION SO A CONCURRENT ADD/DELETE CAN'T SLIP BETWEEN THE CHECK AND THE
		// REWRITE (WHICH WOULD LEAVE ROWS PARKED IN THE DISJOINT RANGE OR CREATE seq GAPS/COLLISIONS).
		const rows = await tx.select({ uuid: chapters.uuid }).from(chapters).where(eq(chapters.bookId, bookId));
		const existing = new Set(rows.map((r) => r.uuid));
		if (orderedUuids.length !== existing.size || !orderedUuids.every((u) => existing.has(u))) {
			throw new Error('Order must list each chapter of the book exactly once.');
		}
		// MOVE ALL INTO A DISJOINT RANGE FIRST SO PER-ROW UPDATES NEVER TRANSIENTLY COLLIDE ON (book_id, seq)
		await tx
			.update(chapters)
			.set({ seq: sql`${chapters.seq} - 1000000` })
			.where(eq(chapters.bookId, bookId));
		for (let i = 0; i < orderedUuids.length; i++) {
			await tx.update(chapters).set({ seq: i }).where(eq(chapters.uuid, orderedUuids[i]));
		}
	});
}

/** DELETE A CHAPTER BY uuid (CASCADE CLEARS ITS TRANSLATIONS). LEAVES A seq GAP — NEIGHBORS TOLERATE IT. */
export async function deleteChapter(uuid: string): Promise<void> {
	const [row] = await db
		.select({ id: chapters.id, bookId: chapters.bookId })
		.from(chapters)
		.where(eq(chapters.uuid, uuid))
		.limit(1);
	if (!row) return;
	await db.delete(chapters).where(eq(chapters.id, row.id));
	// IF IT WAS THE BOOK'S RESUME POINT, MOVE IT TO THE FIRST REMAINING CHAPTER (OR NULL IF NONE LEFT)
	const [book] = await db.select({ last: books.lastChapterId }).from(books).where(eq(books.id, row.bookId)).limit(1);
	if (book && book.last === row.id) {
		const [first] = await db
			.select({ id: chapters.id })
			.from(chapters)
			.where(eq(chapters.bookId, row.bookId))
			.orderBy(asc(chapters.seq))
			.limit(1);
		await db.update(books).set({ lastChapterId: first?.id ?? null }).where(eq(books.id, row.bookId));
	}
}
