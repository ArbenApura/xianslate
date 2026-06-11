// SHARED TYPES ACROSS CLIENT + SERVER

export type Gender = 'neuter' | 'masculine' | 'feminine';
export type GlossaryScope = 'global' | 'book';
export type SourceType = 'web' | 'epub' | 'txt' | 'manual';

/** A CHAPTER AS PARSED FROM A WEB PAGE (BEFORE PERSISTENCE) */
export interface ParsedChapter {
	titleZh: string;
	contentZh: string;
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
	chapters: { titleZh: string; contentZh: string }[];
}

/** A GLOSSARY TERM AS EXTRACTED OR EDITED (BEFORE PERSISTENCE) */
export interface TermDraft {
	raw: string;
	translation: string;
	gender: Gender;
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
