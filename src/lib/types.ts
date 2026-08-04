// -- TYPES -- //

export type Gender = 'neuter' | 'masculine' | 'feminine';
export type GlossaryScope = 'global' | 'book';
export type SourceType = 'web' | 'epub' | 'txt' | 'manual';

// THE KIND OF ENTITY A GLOSSARY TERM NAMES — STRUCTURES THE EDITOR (GROUP / FILTER / COLOUR) AND HELPS
// EXTRACTION STAY CONSISTENT. NOT FED TO THE TRANSLATION PROMPT (THE target RENDERING ALREADY ENCODES IT).
export type TermCategory =
	| 'character'
	| 'location'
	| 'organization'
	| 'technique'
	| 'item'
	| 'realm'
	| 'creature'
	| 'title'
	| 'concept'
	| 'other';
export const TERM_CATEGORIES: TermCategory[] = [
	'character',
	'location',
	'organization',
	'technique',
	'item',
	'realm',
	'creature',
	'title',
	'concept',
	'other',
];

// WHO CREATED / LAST CONFIRMED A TERM — 'ai' = AUTO-EXTRACTED (UNREVIEWED), 'user' = HUMAN-ADDED OR EDITED.
// A 'user' TERM IS AUTHORITATIVE AND NEVER DOWNGRADED BY EXTRACTION.
export type TermStatus = 'ai' | 'user';

/** A SOURCE/TARGET LANGUAGE PAIR (BCP-47-ISH CODES FROM $lib/languages) */
export interface LangPair {
	sourceLang: string;
	targetLang: string;
}

/** A CHAPTER AS PARSED FROM A WEB PAGE (BEFORE PERSISTENCE) — TITLE/BODY ARE IN THE SOURCE LANGUAGE */
export interface ParsedChapter {
	titleSource: string;
	contentSource: string;
	siteChapterId?: string | null;
	chapterUrl?: string | null;
	prevUrl?: string | null;
	nextUrl?: string | null;
	indexUrl?: string | null;
	bookId?: string | null;
	bookTitle?: string | null;
	author?: string | null;
}

/** A BOOK PRODUCED BY AN EPUB/TXT IMPORT (BEFORE PERSISTENCE) */
export interface ImportedBook {
	sourceType: SourceType;
	title: string;
	author?: string | null;
	chapters: { titleSource: string; contentSource: string }[];
}

/** A GLOSSARY TERM AS EXTRACTED OR EDITED (BEFORE PERSISTENCE) */
export interface TermDraft {
	source: string;
	target: string;
	gender: Gender;
	// WHEN THE TERM WAS FIRST SAVED (MS EPOCH) — POPULATED WHEN READING FROM THE DB SO THE UI CAN FLAG
	// RECENTLY-DISCOVERED TERMS. UNSET ON FRESHLY-EXTRACTED DRAFTS THAT AREN'T PERSISTED YET.
	createdAt?: number;
	// A SHORT TRANSLATOR-FACING NOTE (WHO/WHAT THE TERM IS) — DISAMBIGUATES THE TERM DURING TRANSLATION
	context?: string | null;
	tags?: string | null;
	// WHAT KIND OF ENTITY THIS NAMES (character / location / technique / …). null = UNCATEGORISED.
	category?: TermCategory | null;
	// HIGH-PRIORITY: LISTED FIRST AND EMPHASISED IN THE TRANSLATION PROMPT, NEVER TRUNCATED.
	pinned?: boolean;
	// 'ai' (AUTO-EXTRACTED) vs 'user' (HUMAN-CONFIRMED). UNSET ON A FRESH DRAFT.
	status?: TermStatus;
	// ALTERNATE SOURCE-LANGUAGE FORMS OF THE SAME ENTITY (EPITHETS / SHORT FORMS) — ALL RENDER TO `target`
	// AND ALL MATCH IN A CHAPTER. EMPTY / null = NONE.
	aliases?: string[] | null;
	// THE chapters.id WHERE THIS TERM WAS FIRST EXTRACTED — ITS FIRST APPEARANCE. null FOR GLOBAL TERMS.
	firstChapterId?: number | null;
}

/** ONE PERSISTED GLOSSARY ROW AS THE EDITOR CONSUMES IT — aliases PARSED TO AN ARRAY, firstSeq RESOLVED */
export interface GlossaryRow {
	id: number;
	source: string;
	target: string;
	gender: Gender;
	context: string | null;
	tags: string | null;
	category: TermCategory | null;
	pinned: boolean;
	status: TermStatus;
	aliases: string[];
	firstChapterId: number | null;
	// THE seq OF THE first-appearance CHAPTER (RESOLVED VIA JOIN) — null FOR GLOBAL TERMS OR A DELETED CHAPTER.
	// seq IS A BOOK POSITION, NOT THE STORY'S CHAPTER NUMBER — USED ONLY AS A FALLBACK WHEN THE TITLE HAS NO
	// NUMBER (SEQUENTIAL epub/txt). FOR WEB BOOKS THE REAL NUMBER IS DERIVED FROM THE TITLE (chapterLabel).
	firstSeq: number | null;
	// THE first-appearance CHAPTER'S TITLE(S) — THE REAL STORY CHAPTER NUMBER IS PARSED FROM THESE.
	firstChapterTitle: string | null;
	firstChapterTitleTarget: string | null;
	createdAt: number;
}

/** TOKEN USAGE + COST FOR ONE TRANSLATION CALL */
export interface TranslationUsage {
	model: string;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	costUsd: number;
}

/** LENGTH METRICS FOR ONE SIDE (SOURCE OR TARGET) OF A CHAPTER */
export interface ChapterContentStats {
	chars: number;
	words: number;
	paragraphs: number;
	readMinutes: number;
}

/** ONE STORED TRANSLATION RUN — A DISTINCT MODEL/GLOSSARY/PROMPT FINGERPRINT THAT WAS BILLED */
export interface ChapterStatRun {
	model: string;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	costUsd: number;
	createdAt: number;
}

/** ONE BILLED PAGE-FETCH TIER FOR A CHAPTER (ZYTE 'zyte' = HTTP TIER) — FROM fetch_usage */
export interface ChapterFetchItem {
	provider: string;
	calls: number;
	costUsd: number;
}

/** ONE LEDGERED PIPELINE EXPENSE KIND FOR A CHAPTER (EXTRACTION / TITLE / LEAK-REPAIR) — FROM ai_usage */
export interface ChapterPipelineItem {
	kind: string;
	calls: number;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	costUsd: number;
}

/** FULL PER-CHAPTER ANALYTICS BEHIND THE READER'S STATS DIALOG (SEE $lib/server/chapter-stats) */
export interface ChapterStats {
	// IDENTITY + POSITION
	uuid: string;
	bookId: string;
	bookTitle: string;
	seq: number;
	position: number;
	totalChapters: number;
	sourceType: SourceType;
	// LANGUAGE CODES + DISPLAY NAMES; wordDelimited DECIDES WHETHER THE UI LEADS WITH WORDS OR CHARACTERS.
	sourceLang: string;
	targetLang: string;
	sourceLangName: string;
	targetLangName: string;
	sourceWordDelimited: boolean;
	targetWordDelimited: boolean;
	monolingual: boolean;
	chapterUrl: string | null;
	// STATUS
	translated: boolean;
	extracted: boolean;
	readProgress: number | null;
	// TIMELINE (MS EPOCH | null)
	fetchedAt: number | null;
	translatedAt: number | null;
	extractedAt: number | null;
	// CONTENT
	source: ChapterContentStats;
	target: ChapterContentStats | null;
	// TARGET CHARACTERS ÷ SOURCE CHARACTERS — HOW MUCH THE TRANSLATION EXPANDED/CONTRACTED THE TEXT.
	expansionRatio: number | null;
	// GLOSSARY TERMS THAT ACTUALLY APPEAR IN THIS CHAPTER (THE SET THE TRANSLATOR INJECTS).
	glossaryTerms: number;
	// BODY-TRANSLATION COST + TOKEN LEDGER, SUMMED ACROSS EVERY RUN STORED FOR THIS CHAPTER.
	cost: {
		runs: number;
		models: string[];
		promptTokens: number;
		cachedTokens: number;
		completionTokens: number;
		totalTokens: number;
		cacheHitRate: number;
		costUsd: number;
		latest: ChapterStatRun | null;
		history: ChapterStatRun[];
	};
	// PIPELINE SPEND OUTSIDE THE BODY-TRANSLATION CACHE (EXTRACTION / TITLE / LEAK-REPAIR), ATTRIBUTED TO
	// THIS CHAPTER VIA THE ai_usage LEDGER. KEPT SEPARATE FROM `cost` (THE BODY RUN LEDGER) SO EACH STAYS
	// INTERNALLY CONSISTENT; `totalCostUsd` IS THE TRUE ALL-IN CHAPTER SPEND.
	pipeline: {
		costUsd: number;
		promptTokens: number;
		cachedTokens: number;
		completionTokens: number;
		items: ChapterPipelineItem[];
	};
	// BILLED PAGE-FETCH SPEND (ZYTE httpResponseBody) ATTRIBUTED TO THIS CHAPTER VIA fetch_usage; USUALLY ONE ROW.
	// ZERO FOR FREE (node-fetch/curl) FETCHES.
	fetch: {
		costUsd: number;
		items: ChapterFetchItem[];
	};
	// cost.costUsd (BODY) + pipeline.costUsd + fetch.costUsd — WHAT THIS CHAPTER ACTUALLY COST END-TO-END.
	totalCostUsd: number;
}
