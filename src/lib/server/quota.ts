// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { and, eq, gte, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { dbRead } from './db';
import { aiUsage, books, chapters, translations } from './db/schema';

// -- CONSTANTS -- //

// PER-USER COST GUARDRAIL — BOUNDS LLM SPEND PER ROLLING WINDOW. DEFAULTS: $0.50 / 24h (≈ 250 fresh
// chapters/day at ~$0.002 each — generous for a reader, but caps a runaway/abusive account). BOTH ARE
// ENV-OVERRIDABLE; A LIMIT <= 0 DISABLES THE GATE (UNLIMITED). RE-READS ARE FREE (contentTarget FAST PATH),
// SO ONLY *FRESH* TRANSLATION / EXTRACTION SPEND COUNTS AGAINST THE BUDGET.
const WINDOW_MS = Math.max(60_000, Number(env.QUOTA_WINDOW_MS ?? String(24 * 60 * 60 * 1000)) || 24 * 60 * 60 * 1000);

const LIMIT_USD = Number(env.QUOTA_USD_PER_WINDOW ?? '0.50');

// -- FUNCTIONS -- //

// THIS USER'S LLM SPEND IN THE CURRENT WINDOW = body-translation cost (translations) + non-cache pipeline
// cost (ai_usage: extract/title/term/repair). BOTH ARE SCOPED TO THE USER VIA THE chapters→books FK CHAIN.
// ('map' ai_usage HAS NO chapterId, SO IT'S NATURALLY EXCLUDED — IT'S GLOBAL SELECTOR-LEARNING SPEND.)
export async function userSpendUsd(userId: string, windowMs = WINDOW_MS): Promise<number> {
	const since = Date.now() - windowMs;
	const [ai] = await dbRead
		.select({ s: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)` })
		.from(aiUsage)
		.innerJoin(chapters, eq(chapters.id, aiUsage.chapterId))
		.innerJoin(books, eq(books.id, chapters.bookId))
		.where(and(eq(books.userId, userId), gte(aiUsage.createdAt, since)));
	const [tr] = await dbRead
		.select({ s: sql<number>`coalesce(sum(${translations.costUsd}), 0)` })
		.from(translations)
		.innerJoin(chapters, eq(chapters.id, translations.chapterId))
		.innerJoin(books, eq(books.id, chapters.bookId))
		.where(and(eq(books.userId, userId), gte(translations.createdAt, since)));
	return Number(ai?.s ?? 0) + Number(tr?.s ?? 0);
}

// THROW A 429 (FRIENDLY MESSAGE) IF THE USER IS OVER BUDGET. CALL *BEFORE* ENQUEUEING ANY BILLED WORK
// (TRANSLATE / FETCH). NO-OP WHEN THE LIMIT IS DISABLED.
export async function assertWithinBudget(userId: string): Promise<void> {
	if (!(LIMIT_USD > 0)) return;
	const spent = await userSpendUsd(userId);
	if (spent >= LIMIT_USD) {
		const hours = Math.round(WINDOW_MS / 3_600_000);
		throw error(
			429,
			`You've reached your translation budget ($${LIMIT_USD.toFixed(2)} per ${hours}h). It refreshes as older usage ages out — try again later.`,
		);
	}
}
