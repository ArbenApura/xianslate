// FETCH-OUTCOME LOGGING + AI-SPEND LEDGER.
//
// EVERY WEB-CHAPTER FETCH RECORDS ONE site_events ROW (SUCCESS OR A TYPED FAILURE), AND EVERY
// SITE-MAPPING MODEL CALL RECORDS ONE ai_usage ROW. ALL WRITES ARE BEST-EFFORT: LOGGING MUST NEVER
// BREAK A FETCH, SO FAILURES HERE ARE SWALLOWED.

// IMPORTED TYPES
import type { TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { db } from './db';
import { aiUsage, fetchUsage, siteEvents } from './db/schema';
import { isFetchError } from './fetch-error';

// -- FUNCTIONS -- //

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return 'unknown';
	}
}

export async function recordFetchOk(url: string): Promise<void> {
	try {
		await db.insert(siteEvents).values({ host: hostOf(url), url, ok: 1, kind: 'ok', status: 200 });
	} catch {
		// BEST-EFFORT — LOGGING MUST NOT BREAK A FETCH.
	}
}

export async function recordFetchError(url: string, e: unknown): Promise<void> {
	try {
		const fe = isFetchError(e) ? e : null;
		await db.insert(siteEvents).values({
			host: hostOf(url),
			url,
			ok: 0,
			kind: fe?.kind ?? 'parse_failed',
			status: fe?.status ?? 502,
			message: fe?.message ?? (e instanceof Error ? e.message : 'Unknown error'),
		});
	} catch {
		// BEST-EFFORT.
	}
}

export async function recordMapUsage(host: string, usage: TranslationUsage): Promise<void> {
	try {
		await db.insert(aiUsage).values({
			kind: 'map',
			host,
			model: usage.model,
			promptTokens: usage.promptTokens,
			cachedTokens: usage.cachedTokens,
			completionTokens: usage.completionTokens,
			costUsd: usage.costUsd,
		});
	} catch {
		// BEST-EFFORT.
	}
}

// LEDGER ONE NON-TRANSLATION-CACHE MODEL CALL (kind = 'extract' | 'title' | 'term' | 'repair'). THESE ARE
// PER-CHAPTER PIPELINE EXPENSES THAT DON'T LAND IN THE translations CACHE ROW, SO WITHOUT THIS THEY WERE
// SPENT BUT NEVER COUNTED. PASS chapterId FOR CHAPTER-SCOPED CALLS SO THE STATS DIALOG CAN ATTRIBUTE THEM
// (NULL FOR BOOK/TEXT-LEVEL CALLS LIKE A TITLE BACKFILL). A ZERO-COST / NO-OP CALL (CACHED TITLE REUSE,
// NO-RESIDUE REPAIR) IS SKIPPED SO THE LEDGER STAYS MEANINGFUL.
export async function recordAiUsage(kind: string, usage: TranslationUsage, chapterId?: number | null): Promise<void> {
	if (!usage || (usage.promptTokens === 0 && usage.completionTokens === 0 && usage.costUsd === 0)) return;
	try {
		await db.insert(aiUsage).values({
			kind,
			chapterId: chapterId ?? null,
			model: usage.model,
			promptTokens: usage.promptTokens,
			cachedTokens: usage.cachedTokens,
			completionTokens: usage.completionTokens,
			costUsd: usage.costUsd,
		});
	} catch {
		// BEST-EFFORT — LEDGER WRITES MUST NEVER BREAK THE PIPELINE.
	}
}

// LEDGER ONE BILLED PAGE FETCH (CURRENTLY ZYTE). KEYED ON userId DIRECTLY (NOT chapterId) BECAUSE A FETCH
// HAPPENS DURING INGEST BEFORE THE CHAPTER ROW EXISTS — THE CHAPTER id IS ATTACHED WHEN KNOWN FOR THE STATS
// DIALOG. CALLED ONLY FOR costUsd > 0 (FREE node-fetch/curl FETCHES AREN'T BILLED), SO EVERY ROW HERE IS
// REAL SPEND.
export async function recordFetchUsage(
	userId: string,
	host: string,
	provider: string,
	costUsd: number,
	chapterId?: number | null,
): Promise<void> {
	try {
		await db.insert(fetchUsage).values({ userId, host, provider, costUsd, chapterId: chapterId ?? null });
	} catch {
		// BEST-EFFORT — BILLING LEDGER WRITES MUST NEVER BREAK A FETCH.
	}
}
