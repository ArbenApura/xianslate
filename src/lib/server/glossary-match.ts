import AhoCorasick from 'ahocorasick';
import { getEffectiveGlossary } from './glossary';
import type { TermDraft } from '$lib/types';

interface Built {
	ac: AhoCorasick;
	byRaw: Map<string, TermDraft>;
}

// PER-BOOK AUTOMATON CACHE (L1), LRU-BOUNDED. REBUILT WHEN THE BOOK OR GLOBAL GLOSSARY CHANGES. EACH
// BUILT AUTOMATON CAN HOLD THOUSANDS OF TERMS, SO AN UNBOUNDED MAP WOULD GROW WITHOUT LIMIT IN A
// LONG-LIVED PROCESS THAT TOUCHES MANY BOOKS — CAP IT AND EVICT THE LEAST-RECENTLY-USED ENTRY.
const MAX_CACHED_BOOKS = 32;
const cache = new Map<string, Built>();

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
	const terms = await getEffectiveGlossary(bookId);
	const byRaw = new Map<string, TermDraft>();
	for (const t of terms) byRaw.set(t.raw, t);
	const ac = new AhoCorasick([...byRaw.keys()]);
	const built: Built = { ac, byRaw };
	cache.set(bookId, built);
	// EVICT THE OLDEST ENTRY (FIRST IN ITERATION ORDER) ONCE OVER CAPACITY.
	if (cache.size > MAX_CACHED_BOOKS) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return built;
}

/**
 * RETURN ONLY THE EFFECTIVE-GLOSSARY TERMS PRESENT IN THIS CHAPTER.
 * LONGEST MATCH WINS: A TERM THAT IS A STRICT SUBSTRING OF ANOTHER MATCHED TERM IS DROPPED.
 */
export async function matchTerms(bookId: string, content: string): Promise<TermDraft[]> {
	const { ac, byRaw } = await build(bookId);
	if (byRaw.size === 0) return [];

	const found = new Set<string>();
	for (const [, keywords] of ac.search(content)) {
		for (const k of keywords) found.add(k);
	}
	if (found.size === 0) return [];

	const matched = [...found];
	const kept = matched.filter((term) => !matched.some((other) => other !== term && other.includes(term)));
	// SORT BY FIRST APPEARANCE FOR STABLE, READABLE PROMPTS — PRECOMPUTE EACH indexOf ONCE (NOT PER
	// COMPARISON), SO A LARGE CHAPTER ISN'T RE-SCANNED O(n log n) TIMES.
	const firstAt = new Map<string, number>();
	for (const term of kept) firstAt.set(term, content.indexOf(term));
	kept.sort((a, b) => firstAt.get(a)! - firstAt.get(b)!);
	return kept.map((raw) => byRaw.get(raw)!).filter(Boolean);
}
