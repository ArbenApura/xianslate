// PER-USER SPEND GUARD — THE QUOTA/RATE-LIMIT LAYER THE BILLED ENDPOINTS WERE MISSING.
//
// WITHOUT THIS, ONE AUTHENTICATED USER (OR A STOLEN TOKEN, OR A BOTNET OF SIGNUPS) CAN FIRE UNBOUNDED
// /api/translate (incl. force), /api/translate-text, /api/extract, /api/fetch, cover and chapter-refresh
// REQUESTs — EACH OF WHICH MAY BILL THE SHARED DEEPSEEK / ZYTE BUDGET — SATURATING THE SINGLE-INSTANCE
// QUEUE (CROSS-TENANT DoS) AND DRAINING THE OPERATOR'S API-KEY WALLET. THE ONLY PRIOR THROTTLES WERE
// PROCESS-GLOBAL (DeepSeek CONCURRENCY 64, ZYTE 2 rps), WHICH PROTECT THE KEYS' RATE LIMITS, NOT THE BUDGET.
//
// DESIGN (PROPORTIONATE TO A SINGLE-INSTANCE DEPLOY, ZERO NEW DEPENDENCIES):
//   1. A PER-USER SLIDING 60s WINDOW COUNT (IN-MEMORY) — STOPS REQUEST STORMS. IN-MEMORY IS CORRECT FOR
//      THE SINGLE-PROCESS ADAPTER-NODE DEPLOY; IT RESETS ON RESTART, WHICH IS ACCEPTABLE (THE DAILY BUDGET
//      BELOW IS DB-BACKED AND SURVIVES RESTARTS).
//   2. A DB-BACKED 24h SPEND CAP — SUMS THE REAL LEDGERS (translations + ai_usage + fetch_usage, THE SAME
//      ATTRIBUTION RULES AS account-usage.ts) AND REJECTS WHEN THE CONFIGURED DAILY BUDGET IS EXHAUSTED.
//      THE ENV KNOBS: AI_DAILY_BUDGET_USD (DEFAULT 5) AND AI_RPM_LIMIT (DEFAULT 30).
//
// A 429 IS RETURNED FOR BOTH — THE CLIENT ALREADY SURFACES server MESSAGES (apiJson), AND 429 IS THE
// SEMANTICALLY CORRECT STATUS FOR "TRY AGAIN LATER" (RateLimit). THE GUARD RUNS *BEFORE* ANY WORK STARTS.

// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { db } from './db';
import { aiUsage, books, chapters, fetchUsage, translations } from './db/schema';
import { error } from '@sveltejs/kit';

// -- CONSTANTS -- //

// HOW MUCH AI + FETCH SPEND (USD) A USER MAY INCUR PER ROLLING 24h BEFORE THE BILLED ENDPOINTS START
// RETURNING 429. TUNED VIA ENV; THE DEFAULT IS GENEROUS FOR NORMAL READING + TRANSLATION.
const DAILY_BUDGET_USD = Math.max(0, Number(env.AI_DAILY_BUDGET_USD ?? '5') || 5);

// HOW MANY BILLED REQUESTS A USER MAY START PER 60s SLIDING WINDOW (IN-MEMORY COUNTER).
const RPM_LIMIT = Math.max(1, Number(env.AI_RPM_LIMIT ?? '30') || 30);

const WINDOW_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// -- STATE -- //

// userId → TIMESTAMPS OF RECENT BILLED REQUESTS (SLIDING WINDOW). BOUNDED: WE PRUNE STALE ENTRIES ON EVERY
// LOOKUP, SO A BURST ONLY GROWS THIS TO RPM_LIMIT ENTRIES PER USER.
const recent = new Map<string, number[]>();

// -- FUNCTIONS -- //

// TOTAL USD SPENT BY THIS USER IN THE LAST 24h ACROSS ALL THREE LEDGERS, USING THE SAME ATTRIBUTION RULES
// AS account-usage.ts: translations + chapter-linked ai_usage VIA THE chapters→books CHAIN, PLUS
// STANDALONE ai_usage (chapterId NULL) AND fetch_usage VIA THE STAMPED userId.
export async function dailyAiSpendUsd(userId: string): Promise<number> {
	const since = Date.now() - DAY_MS;
	// BODY TRANSLATIONS VIA THE chapter → book CHAIN
	const [body] = await db
		.select({ total: sql<number>`coalesce(sum(${translations.costUsd}),0)` })
		.from(translations)
		.innerJoin(chapters, eq(translations.chapterId, chapters.id))
		.innerJoin(books, eq(chapters.bookId, books.id))
		.where(and(eq(books.userId, userId), gt(translations.createdAt, since)));
	// ai_usage: STANDALONE (userId, NO CHAPTER) + CHAPTER-LINKED VIA THE CHAIN
	const [ai] = await db
		.select({ total: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)` })
		.from(aiUsage)
		.leftJoin(chapters, eq(aiUsage.chapterId, chapters.id))
		.leftJoin(books, eq(chapters.bookId, books.id))
		.where(
			and(
				gt(aiUsage.createdAt, since),
				or(
					and(eq(aiUsage.userId, userId), isNull(aiUsage.chapterId)),
					and(ne(aiUsage.kind, 'map'), eq(books.userId, userId)),
				),
			),
		);
	// PAID FETCHES — KEYED DIRECTLY ON userId (A FETCH PRECEDES THE CHAPTER ROW).
	const [fetch] = await db
		.select({ total: sql<number>`coalesce(sum(${fetchUsage.costUsd}),0)` })
		.from(fetchUsage)
		.where(and(eq(fetchUsage.userId, userId), gt(fetchUsage.createdAt, since)));
	return Number(body?.total ?? 0) + Number(ai?.total ?? 0) + Number(fetch?.total ?? 0);
}

// CHECK THE RATE LIMIT + DAILY BUDGET FOR A USER BEFORE A BILLED OPERATION STARTS. THROWS A 429 error()
// WHEN EITHER IS EXCEEDED — THE CALLER (A REQUEST HANDLER) LETS IT PROPAGATE.
export async function assertWithinQuota(userId: string): Promise<void> {
	const now = Date.now();
	const arr = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
	if (arr.length >= RPM_LIMIT) {
		throw error(429, 'Too many requests — please wait a moment and try again.');
	}
	arr.push(now);
	recent.set(userId, arr);
	if (await dailyAiSpendUsd(userId) >= DAILY_BUDGET_USD) {
		throw error(429, "Today's translation budget is used up — new translations will resume tomorrow.");
	}
}
