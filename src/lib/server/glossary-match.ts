// IMPORTED DEP-MODULES
import AhoCorasick from 'ahocorasick';
// IMPORTED MODULES
import { getLanguage } from '$lib/languages';
import { bookPair, getEffectiveGlossary } from './glossary';
// IMPORTED TYPES
import type { TermDraft } from '$lib/types';

// -- TYPES -- //

interface Built {
	ac: AhoCorasick;
	bySource: Map<string, TermDraft>;
	// WHEN TRUE (SPACE-DELIMITED SOURCE LANGUAGE), A MATCH ONLY COUNTS AT A WORD BOUNDARY SO "art" ISN'T
	// MATCHED INSIDE "start". FALSE FOR CJK (SCRIPTURA CONTINUA — SUBSTRING MATCHING IS CORRECT THERE).
	wordDelimited: boolean;
}

// -- CONSTANTS -- //

// PER-BOOK AUTOMATON CACHE (L1), LRU-BOUNDED. REBUILT WHEN THE BOOK OR GLOBAL GLOSSARY CHANGES.
const MAX_CACHED_BOOKS = 32;
const cache = new Map<string, Built>();

// A "WORD" CHARACTER FOR BOUNDARY DETECTION — LATIN/CYRILLIC LETTERS, DIGITS, AND THE COMBINING MARKS
// THAT RIDE ON THEM. A MATCH IS WORD-BOUNDED WHEN NEITHER NEIGHBOUR IS ONE OF THESE.
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

// -- FUNCTIONS -- //

export function invalidateBook(bookId: string): void {
	cache.delete(bookId);
}

// A GLOBAL-GLOSSARY WRITE AFFECTS EVERY BOOK'S EFFECTIVE SET → DROP ALL
export function invalidateAll(): void {
	cache.clear();
}

async function build(bookId: string): Promise<Built> {
	const cached = cache.get(bookId);
	if (cached) {
		// MARK AS MOST-RECENTLY-USED (RE-INSERT MOVES IT TO THE END OF THE Map'S ITERATION ORDER).
		cache.delete(bookId);
		cache.set(bookId, cached);
		return cached;
	}
	const [terms, pair] = await Promise.all([getEffectiveGlossary(bookId), bookPair(bookId)]);
	const bySource = new Map<string, TermDraft>();
	for (const t of terms) bySource.set(t.source, t);
	const ac = new AhoCorasick([...bySource.keys()]);
	const built: Built = { ac, bySource, wordDelimited: getLanguage(pair.sourceLang).wordDelimited };
	cache.set(bookId, built);
	// EVICT THE OLDEST ENTRY (FIRST IN ITERATION ORDER) ONCE OVER CAPACITY.
	if (cache.size > MAX_CACHED_BOOKS) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return built;
}

// TRUE IF THE MATCH SPANNING [start, end] IN `content` SITS AT A WORD BOUNDARY ON BOTH SIDES.
function wordBounded(content: string, start: number, end: number): boolean {
	const before = start > 0 ? content[start - 1] : '';
	const after = end + 1 < content.length ? content[end + 1] : '';
	return !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
}

// RETURN ONLY THE EFFECTIVE-GLOSSARY TERMS PRESENT IN THIS CHAPTER.
// LONGEST MATCH WINS: A TERM THAT IS A STRICT SUBSTRING OF ANOTHER MATCHED TERM IS DROPPED.
export async function matchTerms(bookId: string, content: string): Promise<TermDraft[]> {
	const { ac, bySource, wordDelimited } = await build(bookId);
	if (bySource.size === 0) return [];

	// ahocorasick.search() RETURNS [endIndex, [keywords]] PER MATCH POSITION. FOR WORD-DELIMITED SOURCE
	// LANGUAGES, KEEP A KEYWORD ONLY IF AT LEAST ONE OCCURRENCE IS WORD-BOUNDED; FOR CJK, ANY HIT COUNTS.
	const found = new Set<string>();
	for (const [endIndex, keywords] of ac.search(content) as [number, string[]][]) {
		for (const k of keywords) {
			if (!wordDelimited) {
				found.add(k);
				continue;
			}
			const start = endIndex - k.length + 1;
			if (wordBounded(content, start, endIndex)) found.add(k);
		}
	}
	if (found.size === 0) return [];

	const matched = [...found];
	const kept = matched.filter((term) => !matched.some((other) => other !== term && other.includes(term)));
	// SORT BY FIRST APPEARANCE FOR STABLE, READABLE PROMPTS — PRECOMPUTE EACH indexOf ONCE.
	const firstAt = new Map<string, number>();
	for (const term of kept) firstAt.set(term, content.indexOf(term));
	kept.sort((a, b) => firstAt.get(a)! - firstAt.get(b)!);
	return kept.map((source) => bySource.get(source)!).filter(Boolean);
}
