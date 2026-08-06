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
//   2. A DB-BACKED UTC-DAY SPEND CAP — SUMS THE REAL LEDGERS (translations + ai_usage + fetch_usage, THE SAME
//      ATTRIBUTION RULES AS account-usage.ts) OVER THE CURRENT UTC CALENDAR DAY AND REJECTS WHEN THE
//      CONFIGURED DAILY BUDGET IS EXHAUSTED. THE WINDOW RESETS AT 00:00 UTC — ONE UNMISTAKABLE ANSWER TO
//      "WHEN DOES THE BUDGET RESET?" FOR USERS IN ANY TIMEZONE. THE ENV KNOBS: AI_DAILY_BUDGET_USD (DEFAULT
//      5) AND AI_RPM_LIMIT (DEFAULT 30).
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

// HOW MUCH AI + FETCH SPEND (USD) A USER MAY INCUR PER UTC CALENDAR DAY BEFORE THE BILLED ENDPOINTS START
// RETURNING 429. THE WINDOW IS THE CURRENT UTC DAY (00:00–24:00 UTC) — IT RESETS AT 00:00 UTC, SO THE
// "WHEN DOES IT RESET?" QUESTION HAS ONE UNMISTAKABLE ANSWER REGARDLESS OF THE USER'S TIMEZONE. TUNED VIA
// ENV (AI_DAILY_BUDGET_USD); 0 DISABLES THE BUDGET CHECK, INVALID/UNSET FALLS BACK TO THE DEFAULT.
// NOTE: `Number(x) || DEFAULT` WOULD MAKE 0 FALL BACK TO THE DEFAULT — PARSE EXPLICITLY (A TEST PINNED THIS).
const _budget = Number(env.AI_DAILY_BUDGET_USD);
const DAILY_BUDGET_USD = Number.isFinite(_budget) && _budget >= 0 ? _budget : 5;

// HOW MANY BILLED REQUESTS A USER MAY START PER 60s SLIDING WINDOW (IN-MEMORY COUNTER).
const RPM_LIMIT = Math.max(1, Number(env.AI_RPM_LIMIT ?? '30') || 30);

const WINDOW_MS = 60_000;

// -- STATE -- //

// userId → TIMESTAMPS OF RECENT BILLED REQUESTS (SLIDING WINDOW). BOUNDED: WE PRUNE STALE ENTRIES ON EVERY
// LOOKUP, SO A BURST ONLY GROWS THIS TO RPM_LIMIT ENTRIES PER USER.
const recent = new Map<string, number[]>();

// -- FUNCTIONS -- //

// THE START OF THE CURRENT UTC CALENDAR DAY (ms EPOCH) — THE BUDGET WINDOW EDGE.
export function utcDayStart(now: number = Date.now()): number {
	const d = new Date(now);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// THE NEXT UTC MIDNIGHT — WHEN THE BUDGET RESETS (MS EPOCH).
export function utcNextMidnight(now: number = Date.now()): number {
	return utcDayStart(now) + 24 * 60 * 60 * 1000;
}

// TOTAL USD SPENT BY THIS USER IN THE CURRENT UTC DAY ACROSS ALL THREE LEDGERS, USING THE SAME ATTRIBUTION
// RULES AS account-usage.ts: translations + chapter-linked ai_usage VIA THE chapters→books CHAIN, PLUS
// STANDALONE ai_usage (chapterId NULL) AND fetch_usage VIA THE STAMPED userId.
export async function dailyAiSpendUsd(userId: string): Promise<number> {
	const since = utcDayStart();
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
	// AI_DAILY_BUDGET_USD=0 DISABLES THE BUDGET CHECK (RATE LIMIT STILL APPLIES).
	if (DAILY_BUDGET_USD > 0 && (await dailyAiSpendUsd(userId)) >= DAILY_BUDGET_USD) {
		throw error(429, "Today's translation budget is used up — new translations will resume tomorrow.");
	}
}

// THE READ-ONLY QUOTA STATE BEHIND THE ACCOUNT > USAGE PAGE — WHAT THE GUARD IS ENFORCING, AND HOW CLOSE
// THE USER IS TO EITHER LIMIT. PURE (NO INCREMENT): rpmUsed IS THE CURRENT SLIDING-WINDOW COUNT.
export interface QuotaStatus {
	// USD A USER MAY SPEND PER UTC DAY (env AI_DAILY_BUDGET_USD — 0 DISABLES THE BUDGET ENTIRELY).
	dailyBudgetUsd: number;
	// ACTUAL LEDGER SPEND (translations + ai_usage + fetch_usage) IN THE CURRENT UTC DAY.
	dailySpentUsd: number;
	// WHEN THE BUDGET RESETS (THE NEXT UTC MIDNIGHT, MS EPOCH) — SHOWN AS "Resets at 00:00 UTC".
	resetsAt: number;
	// BILLED REQUESTS ALLOWED PER 60s (env AI_RPM_LIMIT).
	rpmLimit: number;
	// BILLED REQUESTS STARTED IN THE CURRENT 60s WINDOW (IN-MEMORY — RESETS ON SERVER RESTART).
	rpmUsed: number;
	// TRUE WHEN EITHER LIMIT IS REACHED — THE BILLED ENDPOINTS WOULD RETURN 429 RIGHT NOW.
	blocked: boolean;
}

export async function quotaStatus(userId: string): Promise<QuotaStatus> {
	const now = Date.now();
	const rpmUsed = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS).length;
	const dailySpentUsd = await dailyAiSpendUsd(userId);
	return {
		dailyBudgetUsd: DAILY_BUDGET_USD,
		dailySpentUsd,
		resetsAt: utcNextMidnight(now),
		rpmLimit: RPM_LIMIT,
		rpmUsed,
		blocked: (DAILY_BUDGET_USD > 0 && dailySpentUsd >= DAILY_BUDGET_USD) || rpmUsed >= RPM_LIMIT,
	};
}
