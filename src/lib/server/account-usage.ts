// AGGREGATE PER-ACCOUNT USAGE FOR THE ACCOUNT > USAGE SECTION — THE USER'S TRUE ALL-IN SPEND ACROSS THE
// THREE LEDGERS: BODY TRANSLATION (translations CACHE), AI SPEND (ai_usage: PER-CHAPTER PIPELINE + THE
// userId-ATTRIBUTED 'map' SITE-MAPPING/COVER-LEARNING CALLS), AND BILLED PAGE FETCHES (fetch_usage).
// READ-ONLY — NO MODEL CALLS, SO OPENING THE SECTION IS FREE. MIRRORS THE SQL PATTERNS OF chapter-stats
// (THE PER-CHAPTER STATS DIALOG) SO THE TWO SURFACES AGREE ON HOW SPEND IS COUNTED.

// IMPORTED TYPES
import type {
	AccountBookItem,
	AccountFetchItem,
	AccountModelItem,
	AccountPipelineItem,
	AccountUsage,
} from '$lib/types';
// IMPORTED DEP-MODULES
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { db } from './db';
import { aiUsage, books, chapters, fetchUsage, translations } from './db/schema';

// -- FUNCTIONS -- //

// FULL PER-ACCOUNT USAGE FOR ONE USER: SUMMED TOKENS + COST ACROSS EVERY ATTRIBUTABLE LEDGER ROW, PLUS
// PER-STAGE (BODY / PIPELINE / MAP / FETCH), PER-BOOK, AND PER-MODEL BREAKDOWNS. LEGACY ai_usage 'map'
// ROWS WITHOUT A userId ARE NOT THIS ACCOUNT'S (THEY PREDATE ATTRIBUTION) AND ARE EXCLUDED — SEE
// recordMapUsage IN site-stats.ts.
export async function getAccountUsage(userId: string): Promise<AccountUsage> {
	const [
		bodyRows,
		pipelineRows,
		mapRows,
		fetchRows,
		bookListRows,
		bookBodyRows,
		bookAiRows,
		bookFetchRows,
		modelBodyRows,
		modelAiRows,
	] = await Promise.all([
		// BODY TRANSLATION SPEND — translations JOIN chapters JOIN books (THE OWNERSHIP CHAIN), SUMMED
		// ACROSS EVERY STORED RUN (A CHAPTER CAN HOLD SEVERAL AFTER A MODEL/GLOSSARY CHANGE).
		db
			.select({
				runs: sql<number>`count(*)`,
				promptTokens: sql<number>`coalesce(sum(${translations.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${translations.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${translations.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${translations.costUsd}),0)`,
			})
			.from(translations)
			.innerJoin(chapters, eq(translations.chapterId, chapters.id))
			.innerJoin(books, eq(chapters.bookId, books.id))
			.where(eq(books.userId, userId)),
		// PIPELINE SPEND — PER-CHAPTER ai_usage EXCLUDING 'map' (THE GLOBAL KIND, WHICH GETS ITS OWN
		// userId-ATTRIBUTED BUCKET BELOW), GROUPED BY KIND FOR A PER-STAGE BREAKDOWN.
		db
			.select({
				kind: aiUsage.kind,
				calls: sql<number>`count(*)`,
				promptTokens: sql<number>`coalesce(sum(${aiUsage.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${aiUsage.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${aiUsage.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)`,
			})
			.from(aiUsage)
			.innerJoin(chapters, eq(aiUsage.chapterId, chapters.id))
			.innerJoin(books, eq(chapters.bookId, books.id))
			.where(and(eq(books.userId, userId), ne(aiUsage.kind, 'map')))
			.groupBy(aiUsage.kind),
		// MAP SPEND — SITE-MAPPING / COVER-LEARNING, ATTRIBUTED VIA THE NEW ai_usage.userId COLUMN.
		db
			.select({
				calls: sql<number>`count(*)`,
				promptTokens: sql<number>`coalesce(sum(${aiUsage.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${aiUsage.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${aiUsage.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)`,
			})
			.from(aiUsage)
			.where(and(eq(aiUsage.userId, userId), eq(aiUsage.kind, 'map'))),
		// BILLED PAGE-FETCH SPEND — KEYED DIRECTLY ON userId (A FETCH HAPPENS DURING INGEST BEFORE THE
		// CHAPTER ROW EXISTS, SO IT CAN'T RIDE THE OWNERSHIP CHAIN), GROUPED BY TIER.
		db
			.select({
				provider: fetchUsage.provider,
				calls: sql<number>`count(*)`,
				costUsd: sql<number>`coalesce(sum(${fetchUsage.costUsd}),0)`,
			})
			.from(fetchUsage)
			.where(eq(fetchUsage.userId, userId))
			.groupBy(fetchUsage.provider),
		// PER-BOOK SPEND — COMPUTED AS THREE SINGLE-TABLE GROUP-BYS MERGED IN JS. (A SINGLE QUERY THAT LEFT
		// JOINS translations + ai_usage + fetch_usage ON THE SAME CHAPTER WOULD CROSS-PRODUCT: A CHAPTER WITH
		// 2 RUNS AND 1 FETCH WOULD COUNT EACH RUN TWICE.) BOOK-ATTRIBUTABLE ONLY — MAP SPEND AND BOOK-LEVEL
		// FETCHES (chapterId NULL — COVER/TITLE BACKFILL) STAY IN THE TOTALS, NOT HERE.
		// (a) THE USER'S BOOKS + DISPLAY TITLES.
		db
			.select({
				bookId: books.id,
				title: sql<string>`coalesce(${books.titleTarget}, ${books.title})`,
			})
			.from(books)
			.where(eq(books.userId, userId)),
		// (b) BODY TRANSLATION SPEND PER BOOK (VIA THE CHAPTER CHAIN).
		db
			.select({
				bookId: chapters.bookId,
				promptTokens: sql<number>`coalesce(sum(${translations.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${translations.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${translations.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${translations.costUsd}),0)`,
			})
			.from(translations)
			.innerJoin(chapters, eq(translations.chapterId, chapters.id))
			.innerJoin(books, eq(chapters.bookId, books.id))
			.where(eq(books.userId, userId))
			.groupBy(chapters.bookId),
		// (c) PIPELINE AI SPEND PER BOOK (NON-MAP, VIA THE CHAPTER CHAIN).
		db
			.select({
				bookId: chapters.bookId,
				promptTokens: sql<number>`coalesce(sum(${aiUsage.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${aiUsage.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${aiUsage.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)`,
			})
			.from(aiUsage)
			.innerJoin(chapters, eq(aiUsage.chapterId, chapters.id))
			.innerJoin(books, eq(chapters.bookId, books.id))
			.where(and(eq(books.userId, userId), ne(aiUsage.kind, 'map')))
			.groupBy(chapters.bookId),
		// (d) BILLED FETCH SPEND PER BOOK — ONLY ROWS WITH A chapterId (BOOK-LEVEL FETCHES ARE NOT BOOK-
		// ATTRIBUTABLE), JOINED THROUGH THE CHAPTER CHAIN.
		db
			.select({
				bookId: chapters.bookId,
				costUsd: sql<number>`coalesce(sum(${fetchUsage.costUsd}),0)`,
			})
			.from(fetchUsage)
			.innerJoin(chapters, eq(fetchUsage.chapterId, chapters.id))
			.innerJoin(books, eq(chapters.bookId, books.id))
			.where(eq(books.userId, userId))
			.groupBy(chapters.bookId),
		// PER-MODEL BODY RUNS — TRANSLATIONS GROUPED BY MODEL.
		db
			.select({
				model: translations.model,
				runs: sql<number>`count(*)`,
				promptTokens: sql<number>`coalesce(sum(${translations.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${translations.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${translations.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${translations.costUsd}),0)`,
			})
			.from(translations)
			.innerJoin(chapters, eq(translations.chapterId, chapters.id))
			.innerJoin(books, eq(chapters.bookId, books.id))
			.where(eq(books.userId, userId))
			.groupBy(translations.model),
		// PER-MODEL AI CALLS — PIPELINE (VIA THE CHAPTER CHAIN) + STANDALONE (VIA userId, NO CHAPTER/BROOK
		// JOIN — TITLE BACKFILLS, GLOBAL GLOSSARY TERMS, MAP LEARNS), UNIONED AND GROUPED.
		db
			.select({
				model: aiUsage.model,
				calls: sql<number>`count(*)`,
				promptTokens: sql<number>`coalesce(sum(${aiUsage.promptTokens}),0)`,
				cachedTokens: sql<number>`coalesce(sum(${aiUsage.cachedTokens}),0)`,
				completionTokens: sql<number>`coalesce(sum(${aiUsage.completionTokens}),0)`,
				costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)`,
			})
			.from(aiUsage)
			.leftJoin(chapters, eq(aiUsage.chapterId, chapters.id))
			.leftJoin(books, eq(chapters.bookId, books.id))
			.where(
				or(
					// STANDALONE ROWS (chapterId NULL) — ATTRIBUTED VIA THE STAMPED ai_usage.userId SO NO SPEND
					// IS INVISIBLE (BEFORE THE STAMP, TITLE BACKFILLS + GLOBAL TERMS COUNTED FOR NOBODY).
					and(eq(aiUsage.userId, userId), isNull(aiUsage.chapterId)),
					// CHAPTER-ATTRIBUTED ROWS — INHERIT OWNERSHIP THROUGH THE chapter → book CHAIN (COVERS
					// PRE-STAMP ROWS WHOSE userId IS NULL TOO).
					and(ne(aiUsage.kind, 'map'), eq(books.userId, userId)),
				),
			)
			.groupBy(aiUsage.model),
	]);

	// -- BODY -- //
	const body = {
		runs: Number(bodyRows[0]?.runs ?? 0),
		promptTokens: Number(bodyRows[0]?.promptTokens ?? 0),
		cachedTokens: Number(bodyRows[0]?.cachedTokens ?? 0),
		completionTokens: Number(bodyRows[0]?.completionTokens ?? 0),
		costUsd: Number(bodyRows[0]?.costUsd ?? 0),
	};

	// -- PIPELINE (PER-CHAPTER AI, EXCLUDING MAP) -- //
	const pipelineItems: AccountPipelineItem[] = pipelineRows.map((r) => ({
		kind: r.kind,
		calls: Number(r.calls),
		promptTokens: Number(r.promptTokens),
		cachedTokens: Number(r.cachedTokens),
		completionTokens: Number(r.completionTokens),
		costUsd: Number(r.costUsd),
	}));
	const pipeline = {
		costUsd: pipelineItems.reduce((s, r) => s + r.costUsd, 0),
		promptTokens: pipelineItems.reduce((s, r) => s + r.promptTokens, 0),
		cachedTokens: pipelineItems.reduce((s, r) => s + r.cachedTokens, 0),
		completionTokens: pipelineItems.reduce((s, r) => s + r.completionTokens, 0),
		items: pipelineItems,
	};

	// -- MAP (SITE-MAPPING / COVER-LEARNING, userId-ATTRIBUTED) -- //
	const map = {
		calls: Number(mapRows[0]?.calls ?? 0),
		promptTokens: Number(mapRows[0]?.promptTokens ?? 0),
		cachedTokens: Number(mapRows[0]?.cachedTokens ?? 0),
		completionTokens: Number(mapRows[0]?.completionTokens ?? 0),
		costUsd: Number(mapRows[0]?.costUsd ?? 0),
	};

	// -- FETCH (BILLED PAGE FETCHES) -- //
	const fetchItems: AccountFetchItem[] = fetchRows.map((r) => ({
		provider: r.provider,
		calls: Number(r.calls),
		costUsd: Number(r.costUsd),
	}));
	const fetch = { costUsd: fetchItems.reduce((s, r) => s + r.costUsd, 0), items: fetchItems };

	// -- ALL-IN TOTALS (BODY + PIPELINE + MAP + FETCH) -- //
	const promptTokens = body.promptTokens + pipeline.promptTokens + map.promptTokens;
	const cachedTokens = body.cachedTokens + pipeline.cachedTokens + map.cachedTokens;
	const completionTokens = body.completionTokens + pipeline.completionTokens + map.completionTokens;

	// -- PER-BOOK (MERGE THE THREE SINGLE-TABLE GROUP-BYS BY bookId) -- //
	const perBook = new Map<string, AccountBookItem>();
	for (const r of bookListRows)
		perBook.set(r.bookId, {
			bookId: r.bookId,
			title: r.title,
			promptTokens: 0,
			cachedTokens: 0,
			completionTokens: 0,
			costUsd: 0,
		});
	for (const r of bookBodyRows) {
		const prev = perBook.get(r.bookId);
		if (!prev) continue;
		prev.promptTokens += Number(r.promptTokens);
		prev.cachedTokens += Number(r.cachedTokens);
		prev.completionTokens += Number(r.completionTokens);
		prev.costUsd += Number(r.costUsd);
	}
	for (const r of bookAiRows) {
		const prev = perBook.get(r.bookId);
		if (!prev) continue;
		prev.promptTokens += Number(r.promptTokens);
		prev.cachedTokens += Number(r.cachedTokens);
		prev.completionTokens += Number(r.completionTokens);
		prev.costUsd += Number(r.costUsd);
	}
	for (const r of bookFetchRows) {
		const prev = perBook.get(r.bookId);
		if (!prev) continue;
		prev.costUsd += Number(r.costUsd);
	}
	const bookItems = [...perBook.values()].sort((a, b) => b.costUsd - a.costUsd);

	// -- PER-MODEL (MERGE BODY RUNS + AI CALLS BY MODEL) -- //
	const modelMap = new Map<string, AccountModelItem>();
	for (const r of modelBodyRows) {
		modelMap.set(r.model, {
			model: r.model,
			runs: Number(r.runs),
			calls: 0,
			promptTokens: Number(r.promptTokens),
			cachedTokens: Number(r.cachedTokens),
			completionTokens: Number(r.completionTokens),
			costUsd: Number(r.costUsd),
		});
	}
	for (const r of modelAiRows) {
		const prev = modelMap.get(r.model) ?? {
			model: r.model,
			runs: 0,
			calls: 0,
			promptTokens: 0,
			cachedTokens: 0,
			completionTokens: 0,
			costUsd: 0,
		};
		modelMap.set(r.model, {
			...prev,
			calls: prev.calls + Number(r.calls),
			promptTokens: prev.promptTokens + Number(r.promptTokens),
			cachedTokens: prev.cachedTokens + Number(r.cachedTokens),
			completionTokens: prev.completionTokens + Number(r.completionTokens),
			costUsd: prev.costUsd + Number(r.costUsd),
		});
	}
	const models = [...modelMap.values()].sort((a, b) => b.costUsd - a.costUsd);

	return {
		totalCostUsd: body.costUsd + pipeline.costUsd + map.costUsd + fetch.costUsd,
		promptTokens,
		cachedTokens,
		completionTokens,
		totalTokens: promptTokens + completionTokens,
		cacheHitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
		body,
		pipeline,
		map,
		fetch,
		books: bookItems,
		models,
	};
}
