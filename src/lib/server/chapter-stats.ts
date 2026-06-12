// AGGREGATE PER-CHAPTER ANALYTICS FOR THE READER'S STATS DIALOG: CONTENT METRICS (LENGTH / READING TIME),
// THE TRANSLATION COST + TOKEN LEDGER (FROM THE translations CACHE, WHICH MAY HOLD SEVERAL RUNS PER CHAPTER
// AFTER A MODEL/GLOSSARY CHANGE), GLOSSARY COVERAGE, AND THE FETCH → TRANSLATE → EXTRACT TIMELINE. ALL
// READ-ONLY — NO MODEL CALLS, SO OPENING THE DIALOG IS FREE.

// IMPORTED TYPES
import type { ChapterContentStats, ChapterPipelineItem, ChapterStatRun, ChapterStats } from '$lib/types';
import type { Language } from '$lib/languages';
// IMPORTED DEP-MODULES
import { and, desc, eq, lte, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { getLanguage, isMonolingual, languageName } from '$lib/languages';
import { stripLeadingTitle } from '$lib/chapter-label';
import { db } from './db';
import { aiUsage, books, chapters, translations } from './db/schema';
import { matchTerms } from './glossary-match';

// -- FUNCTIONS -- //

// LENGTH + READING-TIME FOR ONE SIDE — MIRRORS THE READER'S OWN DERIVATION: STRIP THE REDUNDANT LEADING
// TITLE LINE, SPLIT ON BLANK LINES, THEN COUNT WORDS (SPACE-DELIMITED LANGUAGES) OR CHARACTERS (CJK/THAI).
function countContent(text: string | null, title: string, lang: Language): ChapterContentStats {
	const body = text ? stripLeadingTitle(text, title) : '';
	const paras = body ? body.split(/\n{2,}/).filter(Boolean) : [];
	const chars = [...paras.join('')].length;
	const words = lang.wordDelimited ? paras.join(' ').trim().split(/\s+/).filter(Boolean).length : 0;
	const units = lang.wordDelimited ? words : chars;
	const readMinutes = units ? Math.max(1, Math.round(units / lang.readUnitsPerMin)) : 0;
	return { chars, words, paragraphs: paras.length, readMinutes };
}

// FULL ANALYTICS FOR ONE CHAPTER BY ITS PUBLIC uuid. RETURNS null WHEN THE CHAPTER (OR ITS BOOK) IS GONE.
export async function getChapterStats(uuid: string): Promise<ChapterStats | null> {
	const [chapter] = await db.select().from(chapters).where(eq(chapters.uuid, uuid)).limit(1);
	if (!chapter) return null;
	const [book] = await db.select().from(books).where(eq(books.id, chapter.bookId)).limit(1);
	if (!book) return null;

	const srcLang = getLanguage(book.sourceLang);
	const tgtLang = getLanguage(book.targetLang);
	const monolingual = isMonolingual(book.targetLang);
	// PREPEND THE TITLE SO TITLE-ONLY GLOSSARY NAMES COUNT TOO (MATCHES THE EXTRACT ENDPOINT).
	const body = stripLeadingTitle(chapter.contentSource, chapter.titleSource);

	const [runs, totalRow, positionRow, terms, pipelineRows] = await Promise.all([
		db
			.select({
				model: translations.model,
				promptTokens: translations.promptTokens,
				cachedTokens: translations.cachedTokens,
				completionTokens: translations.completionTokens,
				costUsd: translations.costUsd,
				createdAt: translations.createdAt,
			})
			.from(translations)
			.where(eq(translations.chapterId, chapter.id))
			.orderBy(desc(translations.createdAt)),
		db
			.select({ n: sql<number>`count(*)` })
			.from(chapters)
			.where(eq(chapters.bookId, book.id)),
		db
			.select({ n: sql<number>`count(*)` })
			.from(chapters)
			.where(and(eq(chapters.bookId, book.id), lte(chapters.seq, chapter.seq))),
		matchTerms(chapter.bookId, `${chapter.titleSource}\n\n${body}`),
		// PIPELINE SPEND FOR THIS CHAPTER (EXTRACTION / TITLE / LEAK-REPAIR) FROM THE ai_usage LEDGER —
		// THE PART THE translations CACHE DOESN'T HOLD. GROUPED BY KIND FOR A PER-STAGE BREAKDOWN.
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
			.where(eq(aiUsage.chapterId, chapter.id))
			.groupBy(aiUsage.kind),
	]);

	const history: ChapterStatRun[] = runs.map((r) => ({
		model: r.model,
		promptTokens: r.promptTokens ?? 0,
		cachedTokens: r.cachedTokens ?? 0,
		completionTokens: r.completionTokens ?? 0,
		costUsd: r.costUsd ?? 0,
		createdAt: r.createdAt,
	}));
	const promptTokens = history.reduce((s, r) => s + r.promptTokens, 0);
	const cachedTokens = history.reduce((s, r) => s + r.cachedTokens, 0);
	const completionTokens = history.reduce((s, r) => s + r.completionTokens, 0);
	const costUsd = history.reduce((s, r) => s + r.costUsd, 0);

	// PIPELINE EXTRAS (EXTRACTION / TITLE / REPAIR) FOR THIS CHAPTER — SUMMED INTO A GRAND TOTAL SO THE
	// DIALOG REPORTS WHAT THE CHAPTER ACTUALLY COST, NOT JUST THE BODY TRANSLATION.
	const pipelineItems: ChapterPipelineItem[] = pipelineRows.map((r) => ({
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

	const source = countContent(chapter.contentSource, chapter.titleSource, srcLang);
	const target =
		!monolingual && chapter.contentTarget
			? countContent(chapter.contentTarget, chapter.titleTarget ?? '', tgtLang)
			: null;

	return {
		uuid: chapter.uuid!,
		bookId: book.id,
		bookTitle: book.titleTarget ?? book.title,
		seq: chapter.seq,
		position: Number(positionRow[0]?.n ?? 1),
		totalChapters: Number(totalRow[0]?.n ?? 1),
		sourceType: book.sourceType,
		sourceLang: book.sourceLang,
		targetLang: book.targetLang,
		sourceLangName: srcLang.name,
		targetLangName: languageName(book.targetLang),
		sourceWordDelimited: srcLang.wordDelimited,
		targetWordDelimited: tgtLang.wordDelimited,
		monolingual,
		chapterUrl: chapter.chapterUrl,
		translated: !!chapter.contentTarget,
		extracted: chapter.extractedAt != null,
		readProgress: chapter.readProgress,
		fetchedAt: chapter.fetchedAt,
		translatedAt: chapter.translatedAt,
		extractedAt: chapter.extractedAt,
		source,
		target,
		expansionRatio: target && source.chars > 0 ? target.chars / source.chars : null,
		glossaryTerms: terms.length,
		cost: {
			runs: history.length,
			models: [...new Set(history.map((r) => r.model))],
			promptTokens,
			cachedTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			cacheHitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
			costUsd,
			latest: history[0] ?? null,
			history,
		},
		pipeline,
		totalCostUsd: costUsd + pipeline.costUsd,
	};
}
