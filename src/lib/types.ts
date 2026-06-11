// -- TYPES -- //

export type Gender = 'neuter' | 'masculine' | 'feminine';
export type GlossaryScope = 'global' | 'book';
export type SourceType = 'web' | 'epub' | 'txt' | 'manual';

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
}

/** TOKEN USAGE + COST FOR ONE TRANSLATION CALL */
export interface TranslationUsage {
	model: string;
	promptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	costUsd: number;
}
