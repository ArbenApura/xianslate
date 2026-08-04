// IMPORTED TYPES
import type { ImportedBook, LangPair, SourceType } from '$lib/types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
// IMPORTED MODULES
import { AUTO_SOURCE, DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, detectSourceLang } from '$lib/languages';
import { db } from './db';
import { books, chapters, type Book, type Chapter } from './db/schema';
import { fetchBookMeta, fetchChapter, type FetchBilling } from './fetcher';
import { recordFetchUsage } from './site-stats';

// -- CONSTANTS -- //

// THE FALLBACK PAIR WHEN A CALLER DOESN'T SPECIFY ONE (PRESERVES THE APP'S ORIGINAL zh→en DIRECTION).
const DEFAULT_PAIR: LangPair = { sourceLang: DEFAULT_SOURCE_LANG, targetLang: DEFAULT_TARGET_LANG };

// -- TYPES -- //

export interface ChapterView {
	id: number; // INTERNAL PK — USED BY translate/extract
	uuid: string; // STABLE PUBLIC ID — USED IN URLS
	bookId: string;
	bookTitle: string;
	sourceType: SourceType;
	// THE BOOK'S TRANSLATION DIRECTION — DRIVES PROMPTS, FONTS, TTS, AND LABELS IN THE READER.
	sourceLang: string;
	targetLang: string;
	seq: number;
	titleSource: string;
	titleTarget: string | null;
	contentSource: string;
	contentTarget: string | null;
	chapterUrl: string | null;
	prevUrl: string | null;
	nextUrl: string | null;
	indexUrl: string | null;
	prevUuid: string | null;
	nextUuid: string | null;
	// WHEN GLOSSARY TERMS WERE AUTO-EXTRACTED FROM THIS CHAPTER (null = NEVER) — GATES RE-EXTRACTION IN THE UI
	extractedAt: number | null;
	// FRACTION OF THE CHAPTER ACTUALLY READ (0..1) — SEEDS THE READER'S PROGRESS TRACKER ON OPEN
	readProgress: number | null;
}

export interface BookSummary {
	id: string;
	title: string;
	titleTarget: string | null;
	author: string | null;
	authorTarget: string | null;
	sourceType: SourceType;
	sourceLang: string;
	targetLang: string;
	sourceUrl: string | null;
	coverUrl: string | null;
	// LIBRARY ORGANIZATION: pinned FLOATS TO THE TOP; archived HIDES FROM THE DEFAULT SHELF.
	pinned: boolean;
	archived: boolean;
	chapterCount: number;
	// CHAPTERS UP TO & INCLUDING THE RESUME POINT (READING PROGRESS); 0 IF NOTHING READ YET
	readChapters: number;
	// CHAPTERS WITH A STORED TARGET-LANGUAGE TRANSLATION (TRANSLATION COVERAGE)
	translatedChapters: number;
	lastChapterUuid: string | null;
	firstChapterUuid: string | null;
	lastReadAt: number | null;
	createdAt: number;
}

// CHUNKED MULTI-ROW INSERT (SQLite CAPS BOUND PARAMETERS PER STATEMENT) — RETURNS {id,uuid} IN ORDER.
type ChapterInsert = typeof chapters.$inferInsert;

// -- FUNCTIONS -- //

// RESOLVE A SCRAPED NEIGHBOR URL TO THE EXISTING CHAPTER IT POINTS AT (uuid + seq), OR null IF NOT FETCHED
// YET. seq LETS US VERIFY THE LINK ACTUALLY MOVES IN THE INTENDED DIRECTION (chapterUrl IS GLOBALLY UNIQUE).
async function chapterByUrl(bookId: string, url: string | null): Promise<{ uuid: string; seq: number } | null> {
	if (!url) return null;
	// SCOPED TO THE BOOK: chapterUrl IS UNIQUE PER BOOK (Phase 4), SO NEIGHBOR RESOLUTION STAYS WITHIN THIS
	// BOOK AND NEVER RESOLVES TO ANOTHER USER'S CHAPTER THAT HAPPENS TO SHARE THE SAME SOURCE URL.
	const row = await db
		.select({ uuid: chapters.uuid, seq: chapters.seq })
		.from(chapters)
		.where(and(eq(chapters.bookId, bookId), eq(chapters.chapterUrl, url)))
		.limit(1);
	return row[0]?.uuid ? { uuid: row[0].uuid, seq: row[0].seq } : null;
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
	let prevUuid: string | null;
	let nextUuid: string | null;
	let prevUrl = ch.prevUrl;
	let nextUrl = ch.nextUrl;

	if (book.sourceType === 'web') {
		const [p, n, seqPrev, seqNext] = await Promise.all([
			chapterByUrl(book.id, ch.prevUrl),
			chapterByUrl(book.id, ch.nextUrl),
			neighborUuidByOrder(book.id, ch.seq, 'prev'),
			neighborUuidByOrder(book.id, ch.seq, 'next'),
		]);
		// NAVIGATE BY THE LOCAL seq ORDER SO MANUAL REORDERING ON THE MANAGE PAGE IS RESPECTED. seq AND THE
		// SCRAPED prev/next LINKS NORMALLY AGREE; THEY DIVERGE ONLY AFTER A REORDER, WHERE THE USER ORDER WINS.
		// A prev/next URL THAT DOES NOT RESOLVE TO AN IMPORTED CHAPTER IS A FETCH TARGET (THE FRONTIER, OR A GAP)
		// — KEEP THE URL AND LEAVE uuid NULL SO THE READER FETCHES THROUGH IT. OTHERWISE WALK seq (THE URL IS NO
		// LONGER NEEDED, AND THIS NATURALLY IGNORES A MIS-SCRAPED LINK THAT RESOLVES BACKWARD BY seq).
		if (ch.prevUrl && !p) {
			prevUuid = null;
		} else {
			prevUuid = seqPrev ?? (p && p.seq < ch.seq ? p.uuid : null);
			prevUrl = null;
		}
		if (ch.nextUrl && !n) {
			nextUuid = null;
		} else {
			nextUuid = seqNext ?? (n && n.seq > ch.seq ? n.uuid : null);
			nextUrl = null;
		}
	} else {
		[prevUuid, nextUuid] = await Promise.all([
			neighborUuidByOrder(book.id, ch.seq, 'prev'),
			neighborUuidByOrder(book.id, ch.seq, 'next'),
		]);
	}

	return {
		id: ch.id,
		uuid: ch.uuid!,
		bookId: book.id,
		bookTitle: book.titleTarget ?? book.title,
		sourceType: book.sourceType,
		sourceLang: book.sourceLang,
		targetLang: book.targetLang,
		seq: ch.seq,
		titleSource: ch.titleSource,
		titleTarget: ch.titleTarget,
		contentSource: ch.contentSource,
		contentTarget: ch.contentTarget,
		chapterUrl: ch.chapterUrl,
		prevUrl,
		nextUrl,
		indexUrl: ch.indexUrl,
		prevUuid,
		nextUuid,
		extractedAt: ch.extractedAt,
		readProgress: ch.readProgress,
	};
}

/**
 * RE-FETCH A WEB CHAPTER'S LIVE PAGE AND REFRESH ONLY ITS NAVIGATION LINKS (prev/next/index) IN PLACE,
 * LEAVING titleSource/contentSource AND ANY TRANSLATION UNTOUCHED. FIXES A CHAPTER WHOSE STORED next/prev
 * WAS MIS-SCRAPED, AND LETS THE FORMER "LATEST" CHAPTER DISCOVER A NEWLY-PUBLISHED NEXT. RETURNS THE
 * UPDATED VIEW, OR null IF THE CHAPTER ISN'T A REFRESHABLE WEB CHAPTER.
 */
export async function refreshChapterNav(uuid: string): Promise<ChapterView | null> {
	const [row] = await db.select().from(chapters).where(eq(chapters.uuid, uuid)).limit(1);
	if (!row?.chapterUrl) return null;
	const book = await getBook(row.bookId);
	if (!book || book.sourceType !== 'web') return null;

	// RE-FETCH IS BILLED LIKE INGEST; THE CHAPTER ALREADY EXISTS SO WE ATTRIBUTE IT DIRECTLY (row.id).
	const parsed = await fetchChapter(row.chapterUrl, book.sourceLang, (e) => {
		void recordFetchUsage(book.userId, e.host, e.provider, e.costUsd, row.id);
	});
	await db
		.update(chapters)
		.set({ prevUrl: parsed.prevUrl ?? null, nextUrl: parsed.nextUrl ?? null, indexUrl: parsed.indexUrl ?? null })
		.where(eq(chapters.id, row.id));
	const [updated] = await db.select().from(chapters).where(eq(chapters.id, row.id)).limit(1);
	return updated ? toView(updated, book) : null;
}

/**
 * RECORD HOW FAR THE READER GOT IN A CHAPTER. MONOTONIC: NEVER LOWERS A PREVIOUSLY-RECORDED MAX, SO
 * SCROLLING BACK UP (OR RE-OPENING AT THE TOP) DOESN'T UN-MARK A FINISHED CHAPTER. `progress` IS 0..1.
 */
export async function setReadProgress(uuid: string, progress: number): Promise<void> {
	const p = Math.max(0, Math.min(1, progress));
	// greatest() IS THE POSTGRES SCALAR ROW-WISE MAX (SQLite's 2-ARG max() IS AN AGGREGATE IN PG). KEEPS
	// THE WRITE MONOTONIC — NEVER LOWERS A PREVIOUSLY-RECORDED MAX.
	await db
		.update(chapters)
		.set({ readProgress: sql`greatest(coalesce(${chapters.readProgress}, 0), ${p})` })
		.where(eq(chapters.uuid, uuid));
}

export type ReadScope = 'this' | 'previous' | 'all';

/**
 * BULK-SET THE READ STATE OF A BOOK'S CHAPTERS RELATIVE TO AN ANCHOR CHAPTER. UNLIKE setReadProgress THIS
 * IS A DIRECT (NON-MONOTONIC) WRITE — IT'S AN EXPLICIT USER ACTION, SO read=true → 1 (done) AND
 * read=false → 0 (unread) BOTH OVERRIDE WHATEVER WAS THERE.
 *  - 'this'     → ONLY THE ANCHOR CHAPTER
 *  - 'previous' → EVERY CHAPTER BEFORE THE ANCHOR (seq < anchor.seq)
 *  - 'all'      → EVERY CHAPTER IN THE BOOK
 */
export async function setBookReadStatus(
	bookId: string,
	scope: ReadScope,
	anchorUuid: string,
	read: boolean,
): Promise<void> {
	const value = read ? 1 : 0;
	if (scope === 'this') {
		await db
			.update(chapters)
			.set({ readProgress: value })
			.where(and(eq(chapters.bookId, bookId), eq(chapters.uuid, anchorUuid)));
		return;
	}
	if (scope === 'all') {
		await db.update(chapters).set({ readProgress: value }).where(eq(chapters.bookId, bookId));
		return;
	}
	// 'previous' — NEEDS THE ANCHOR'S POSITION FIRST
	const [anchor] = await db
		.select({ seq: chapters.seq })
		.from(chapters)
		.where(and(eq(chapters.bookId, bookId), eq(chapters.uuid, anchorUuid)))
		.limit(1);
	if (!anchor) return;
	await db
		.update(chapters)
		.set({ readProgress: value })
		.where(and(eq(chapters.bookId, bookId), lt(chapters.seq, anchor.seq)));
}

export async function listBooks(userId: string): Promise<BookSummary[]> {
	const rows = await db.select().from(books).where(eq(books.userId, userId)).orderBy(desc(books.createdAt));
	if (rows.length === 0) return [];
	// SCOPE EVERY CHAPTER AGGREGATE TO THIS USER'S BOOKS — NEVER COUNT/PEEK INTO ANOTHER USER'S CHAPTERS.
	const bookIds = rows.map((b) => b.id);

	// CHAPTER COUNT + TRANSLATED COUNT PER BOOK (PURE AGGREGATES — VALID UNDER GROUP BY IN POSTGRES).
	const agg = await db
		.select({
			bookId: chapters.bookId,
			n: sql<number>`count(*)`,
			translated: sql<number>`sum(case when ${chapters.contentTarget} is not null then 1 else 0 end)`,
		})
		.from(chapters)
		.where(inArray(chapters.bookId, bookIds))
		.groupBy(chapters.bookId);
	const byBook = new Map(agg.map((a) => [a.bookId, a]));

	// FIRST-CHAPTER uuid PER BOOK (THE min(seq) ROW). POSTGRES FORBIDS SELECTING A BARE NON-GROUPED COLUMN
	// (SQLite ALLOWED THE "uuid FROM THE min(seq) ROW" TRICK), SO USE DISTINCT ON (book_id) ORDERED BY seq
	// TO PICK EACH BOOK'S FIRST CHAPTER uuid IN ONE PASS — NO N+1.
	const firstRows = await db
		.selectDistinctOn([chapters.bookId], { bookId: chapters.bookId, uuid: chapters.uuid })
		.from(chapters)
		.where(inArray(chapters.bookId, bookIds))
		.orderBy(chapters.bookId, asc(chapters.seq));
	const firstUuidByBook = new Map(firstRows.map((r) => [r.bookId, r.uuid]));

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
		.where(and(lte(chapters.seq, rc.seq), eq(books.userId, userId)))
		.groupBy(chapters.bookId);
	const readByBook = new Map(readRows.map((r) => [r.bookId, Number(r.readN)]));

	return rows.map((b) => {
		const a = byBook.get(b.id);
		return {
			id: b.id,
			title: b.title,
			titleTarget: b.titleTarget,
			author: b.author,
			authorTarget: b.authorTarget,
			sourceType: b.sourceType,
			sourceLang: b.sourceLang,
			targetLang: b.targetLang,
			sourceUrl: b.sourceUrl,
			coverUrl: b.coverUrl,
			pinned: b.pinned,
			archived: b.archived,
			chapterCount: Number(a?.n ?? 0),
			readChapters: readByBook.get(b.id) ?? 0,
			translatedChapters: Number(a?.translated ?? 0),
			lastChapterUuid: b.lastChapterId != null ? (lastUuids.get(b.lastChapterId) ?? null) : null,
			firstChapterUuid: firstUuidByBook.get(b.id) ?? null,
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

// (RE)FETCH A BOOK'S COVER FROM ITS WEB SOURCE PAGE AND PERSIST IT. RETURNS THE RESOLVED URL (OR null IF
// NONE FOUND). `reason` EXPLAINS A REFUSAL — NO BOOK, OR NO http(s) SOURCE TO SCRAPE A COVER FROM.
export async function refetchCover(
	id: string,
): Promise<{ ok: boolean; coverUrl: string | null; reason?: 'not_found' | 'no_source' }> {
	const book = await getBook(id);
	if (!book) return { ok: false, coverUrl: null, reason: 'not_found' };
	if (!book.sourceUrl || !/^https?:\/\//i.test(book.sourceUrl))
		return { ok: false, coverUrl: null, reason: 'no_source' };
	const { cover } = await fetchBookMeta(book.sourceUrl, book.sourceLang, (e) =>
		recordFetchUsage(book.userId, e.host, e.provider, e.costUsd),
	);
	if (cover) await db.update(books).set({ coverUrl: cover }).where(eq(books.id, id));
	return { ok: true, coverUrl: cover };
}

/**
 * RESOLVE A CHAPTER BY ITS PUBLIC UUID.
 * `recordResume` MUST ONLY BE SET ON A REAL PAGE VIEW (THE SSR LOAD) — NOT FROM PREFETCH / JSON
 * LOOKUPS, OTHERWISE BACKGROUND PREFETCH WOULD SILENTLY ADVANCE THE BOOK'S "RESUME" POINTER.
 */
export async function getChapterView(uuid: string, userId: string, recordResume = false): Promise<ChapterView | null> {
	const row = await db.select().from(chapters).where(eq(chapters.uuid, uuid)).limit(1);
	if (!row[0]) return null;
	const book = await getBook(row[0].bookId);
	// OWNERSHIP: A CHAPTER IS ONLY VISIBLE TO THE USER WHO OWNS ITS BOOK — A GUESSED uuid FROM ANOTHER
	// USER'S LIBRARY RETURNS null (404 AT THE ENDPOINT), NOT THEIR CONTENT.
	if (!book || book.userId !== userId) return null;
	if (recordResume) {
		await db.update(books).set({ lastChapterId: row[0].id, lastReadAt: Date.now() }).where(eq(books.id, book.id));
	}
	return toView(row[0], book);
}

// -- OWNERSHIP HELPERS (Phase 4) -- //

// THE BOOK IF OWNED BY userId, ELSE THROW 404 (NEVER REVEAL ANOTHER USER'S BOOK EXISTS). USE AT THE START
// OF EVERY /api ENDPOINT THAT TAKES A bookId BEFORE TOUCHING THE BOOK / ITS CHAPTERS / ITS GLOSSARY.
export async function assertBookOwner(userId: string, bookId: string): Promise<Book> {
	const [book] = await db
		.select()
		.from(books)
		.where(and(eq(books.id, bookId), eq(books.userId, userId)))
		.limit(1);
	if (!book) throw error(404, 'Book not found.');
	return book;
}

// THE CHAPTER ROW IF IT (VIA ITS BOOK) IS OWNED BY userId, ELSE null. JOINS chapters→books SO A GUESSED
// uuid OR INTEGER chapterId CAN'T REACH ANOTHER USER'S CHAPTER.
export async function getOwnedChapterByUuid(userId: string, uuid: string): Promise<Chapter | null> {
	const [row] = await db
		.select({ chapter: chapters })
		.from(chapters)
		.innerJoin(books, eq(books.id, chapters.bookId))
		.where(and(eq(chapters.uuid, uuid), eq(books.userId, userId)))
		.limit(1);
	return row?.chapter ?? null;
}

// THE CHAPTER ROW IF ITS BOOK IS OWNED BY userId, BY INTEGER chapterId — ELSE throw 404. STOPS A USER
// ATTACHING TO ANOTHER USER'S TRANSLATION SSE STREAM BY GUESSING A NUMERIC chapterId.
export async function assertChapterOwner(userId: string, chapterId: number): Promise<Chapter> {
	const [row] = await db
		.select({ chapter: chapters })
		.from(chapters)
		.innerJoin(books, eq(books.id, chapters.bookId))
		.where(and(eq(chapters.id, chapterId), eq(books.userId, userId)))
		.limit(1);
	if (!row) throw error(404, 'Chapter not found.');
	return row.chapter;
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
	userId: string,
	anchor?: { fromChapterId: number; dir: 'prev' | 'next' },
	targetBookId?: string,
	pair: LangPair = DEFAULT_PAIR,
): Promise<ChapterView> {
	// NOTE: THE RESUME POINTER (books.lastChapterId) IS RECORDED ONLY BY THE REAL CHAPTER PAGE VIEW,
	// NOT HERE — SO PREFETCH/FETCH-AHEAD CAN PULL CHAPTERS WITHOUT MOVING WHERE THE READER LEFT OFF.
	// SCOPED TO THIS USER: chapterUrl IS UNIQUE PER BOOK, SO LOOK FOR *THIS USER'S* COPY OF THE URL.
	const existing = await db
		.select({ chapter: chapters })
		.from(chapters)
		.innerJoin(books, eq(books.id, chapters.bookId))
		.where(and(eq(chapters.chapterUrl, url), eq(books.userId, userId)))
		.limit(1);
	if (existing[0]) {
		const book = await getBook(existing[0].chapter.bookId);
		if (book) return toView(existing[0].chapter, book);
	}

	// AN EXPLICIT TARGET BOOK MUST EXIST *AND* BE OWNED BY THIS USER (404 OTHERWISE). AN EXISTING TARGET
	// BOOK DICTATES THE DIRECTION (A NEIGHBOUR INHERITS ITS LANGUAGES); OTHERWISE USE THE CALLER'S PAIR.
	const preBook = targetBookId ? await assertBookOwner(userId, targetBookId) : null;
	const effPair: LangPair = preBook ? { sourceLang: preBook.sourceLang, targetLang: preBook.targetLang } : pair;

	// 'auto' SOURCE → FETCH WITH NEUTRAL HEADERS (CHARSET STILL AUTO-DETECTS), THEN INFER THE SOURCE
	// LANGUAGE FROM THE DECODED TEXT BEFORE CREATING THE BOOK. COLLECT BILLED (ZYTE) FETCHES HERE AND CHARGE
	// THEM ONCE WE KNOW THE CHAPTER id (BELOW), SO THE STATS DIALOG CAN ATTRIBUTE THE FETCH SPEND.
	const fetchBills: FetchBilling[] = [];
	const parsed = await fetchChapter(url, effPair.sourceLang === AUTO_SOURCE ? undefined : effPair.sourceLang, (e) =>
		fetchBills.push(e),
	);
	if (effPair.sourceLang === AUTO_SOURCE) {
		effPair.sourceLang = detectSourceLang(`${parsed.titleSource}\n${parsed.contentSource}`);
	}
	// PER-USER WEB BOOK id: PREFIX THE SITE'S DETERMINISTIC id WITH THE OWNER SO TWO USERS READING THE SAME
	// NOVEL GET SEPARATE (PRIVATE) BOOKS RATHER THAN COLLIDING ON A SHARED books.id.
	const bookId = targetBookId ?? `web-${userId}-${parsed.bookId ?? randomUUID()}`;

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
				userId,
				sourceType: 'web',
				sourceLang: effPair.sourceLang,
				targetLang: effPair.targetLang,
				title: parsed.bookTitle ?? parsed.titleSource,
				author: parsed.author ?? null,
				sourceUrl: parsed.indexUrl ?? url,
			})
			.onConflictDoNothing();
		book = await getBook(bookId);

		// WE HAD NO REAL BOOK TITLE FROM THE CHAPTER PAGE → THE INSERT ABOVE FELL BACK TO THE CHAPTER HEADING,
		// WHICH ON SOME SITES (e.g. faloo) IS "BookName ChapterName" MASHED TOGETHER. THE INDEX PAGE'S og:title
		// IS THE AUTHORITATIVE BOOK NAME — BACKFILL IT BELOW.
		const titleIsFallback = !parsed.bookTitle;

		// BOOK METADATA: PULL THE COVER (+ CLEAN TITLE) FROM THE INDEX PAGE IN THE BACKGROUND — A SEPARATE FETCH
		// THAT MUST NEVER BLOCK (OR FAIL) THE FIRST CHAPTER. THE LIBRARY PICKS IT UP ON THE NEXT RENDER.
		const metaIndexUrl = parsed.indexUrl ?? url;
		// BOOK-LEVEL FETCH (COVER/TITLE) — BILL THE USER, BUT NO chapterId (IT BELONGS TO THE BOOK, NOT A CHAPTER).
		void fetchBookMeta(metaIndexUrl, effPair.sourceLang, (e) =>
			recordFetchUsage(userId, e.host, e.provider, e.costUsd),
		).then((meta) => {
			const set: { coverUrl?: string; title?: string; titleTarget?: null } = {};
			if (meta.cover) set.coverUrl = meta.cover;
			// ONLY OVERRIDE THE NAME WHEN OURS WAS A FALLBACK AND THE INDEX GIVES A DIFFERENT, CLEAN TITLE. NULL
			// titleTarget SO THE LIBRARY LAZILY RE-TRANSLATES THE CORRECTED NAME ON THE NEXT BOOK-META READ.
			if (titleIsFallback && meta.title && meta.title !== parsed.titleSource) {
				set.title = meta.title;
				set.titleTarget = null;
			}
			if (Object.keys(set).length === 0) return;
			db.update(books)
				.set(set)
				.where(eq(books.id, bookId))
				.catch((e) => console.error(`[book-meta] failed to persist for ${bookId}:`, e));
		});
	}
	if (!book) throw new Error('Failed to create book.');

	// SEQ PLACEMENT + INSERT IN ONE TRANSACTION SO CONCURRENT INGESTS CAN'T (a) BOTH READ THE SAME max(seq)
	// AND COLLIDE ON (book_id, seq), OR (b) BOTH PASS THE chapterUrl EXISTENCE CHECK AND COLLIDE ON THE
	// UNIQUE URL. THE LOSER OF A chapterUrl RACE RE-READS THE WINNER'S ROW INSTEAD OF THROWING A 500.
	const inserted = await db.transaction(async (tx) => {
		const dup = await tx
			.select()
			.from(chapters)
			.where(and(eq(chapters.bookId, bookId), eq(chapters.chapterUrl, url)))
			.limit(1);
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
				titleSource: parsed.titleSource,
				contentSource: parsed.contentSource,
				prevUrl: parsed.prevUrl ?? null,
				nextUrl: parsed.nextUrl ?? null,
				indexUrl: parsed.indexUrl ?? null,
				fetchedAt: Date.now(),
			})
			.onConflictDoNothing()
			.returning();
		if (ins[0]) return ins[0];
		// LOST THE (book_id, chapterUrl) RACE — RETURN THE ROW THE WINNER INSERTED (WITHIN THIS BOOK).
		const [row] = await tx
			.select()
			.from(chapters)
			.where(and(eq(chapters.bookId, bookId), eq(chapters.chapterUrl, url)))
			.limit(1);
		return row;
	});

	// CHARGE THE (ZYTE) FETCH(ES) FOR THIS CHAPTER NOW THAT WE HAVE ITS id — userId FEEDS THE ROLLING BUDGET,
	// chapterId LETS THE STATS DIALOG REPORT PER-CHAPTER FETCH SPEND (HTTP vs RENDER). BEST-EFFORT.
	for (const b of fetchBills) {
		void recordFetchUsage(userId, b.host, b.provider, b.costUsd, inserted.id);
	}

	return toView(inserted, book);
}

/** PERSIST AN EPUB/TXT IMPORT; RETURNS THE NEW BOOK id + FIRST CHAPTER uuid */
export async function createImportedBook(
	imported: ImportedBook,
	userId: string,
	sourceUrl: string | null = null,
	pair: LangPair = DEFAULT_PAIR,
): Promise<{ bookId: string; firstChapterUuid: string }> {
	const bookId = `${imported.sourceType}-${randomUUID()}`;
	const now = Date.now();
	// 'auto' SOURCE → INFER FROM THE FIRST FEW CHAPTERS' TEXT.
	const sourceLang =
		pair.sourceLang === AUTO_SOURCE
			? detectSourceLang(
					imported.chapters
						.slice(0, 3)
						.map((c) => `${c.titleSource}\n${c.contentSource}`)
						.join('\n'),
				)
			: pair.sourceLang;
	// ONE TRANSACTION FOR THE WHOLE IMPORT: A FAILURE PARTWAY THROUGH A THOUSAND-CHAPTER BOOK ROLLS BACK
	// EVERYTHING (NO HALF-IMPORTED BOOK), AND CHAPTERS GO IN AS BATCHED MULTI-ROW INSERTS, NOT N ROUND-TRIPS.
	const firstChapterUuid = await db.transaction(async (tx) => {
		await tx.insert(books).values({
			id: bookId,
			userId,
			sourceType: imported.sourceType,
			sourceLang,
			targetLang: pair.targetLang,
			title: imported.title,
			author: imported.author ?? null,
			sourceUrl,
		});

		const rows = imported.chapters.map((ch, i) => ({
			bookId,
			seq: i,
			titleSource: ch.titleSource,
			contentSource: ch.contentSource,
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
export async function createEmptyBook(input: {
	title: string;
	userId: string;
	author?: string | null;
	pair?: LangPair;
}): Promise<{ id: string }> {
	const id = `manual-${randomUUID()}`;
	const pair = input.pair ?? DEFAULT_PAIR;
	// AN EMPTY BOOK HAS NO TEXT TO DETECT FROM YET — RESOLVE 'auto' TO THE DEFAULT SOURCE LANGUAGE.
	const sourceLang = pair.sourceLang === AUTO_SOURCE ? DEFAULT_SOURCE_LANG : pair.sourceLang;
	await db.insert(books).values({
		id,
		userId: input.userId,
		sourceType: 'manual',
		sourceLang,
		targetLang: pair.targetLang,
		title: input.title.trim() || 'Untitled',
		author: input.author?.trim() || null,
	});
	return { id };
}

/** APPEND CHAPTERS TO AN EXISTING BOOK AT THE TAIL (seq = max+1, max+2, …) */
export async function appendChapters(
	bookId: string,
	list: { titleSource: string; contentSource: string }[],
): Promise<{ added: number; firstUuid: string | null }> {
	const clean = list
		.map((c) => ({ titleSource: c.titleSource.trim(), contentSource: c.contentSource.trim() }))
		.filter((c) => c.contentSource.length > 0);
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
			titleSource: c.titleSource || `Chapter ${base + i + 1}`,
			contentSource: c.contentSource,
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
		await db
			.update(books)
			.set({ lastChapterId: first?.id ?? null })
			.where(eq(books.id, row.bookId));
	}
}
