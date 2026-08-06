// SPEND-GUARD TESTS — THE QUOTA/RATE-LIMIT LAYER, AGAINST PG-MEM.
//
// REGRESSION PINS: (a) THE BUDGET WINDOW IS THE UTC CALENDAR DAY (RESETS AT 00:00 UTC) — A SPEND AT
// 23:59:59.999 UTC COUNTS, 00:00:00.001 THE NEXT DAY DOESN'T; (b) THE DAILY-SPEND SUM USES THE SAME
// ATTRIBUTION AS account-usage (STANDALONE VIA STAMPED userId + CHAPTER-LINKED VIA THE CHAIN + FETCH BY
// userId); (c) THE RPM WINDOW REJECTS AT THE LIMIT; (d) AI_DAILY_BUDGET_USD=0 DISABLES THE BUDGET CHECK.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, resetDb, seedAi, seedBook, seedChapter, seedFetch, seedTranslation, seedUser, type TestDb } from '../helpers/pgmem';

vi.mock('$lib/server/db', async () => ({ db: (await import('../helpers/pgmem')).getTestDb() }));

let db: TestDb;

beforeEach(async () => {
	db = getTestDb();
	await resetDb(db);
	vi.unstubAllEnvs();
	vi.resetModules(); // RELOAD spend-guard SO EACH TEST READS ITS OWN STUBBED ENV
});

// IMPORT THE MODULE AFTER STUBBING THE ENV (THE BUDGET/RPM CONSTANTS ARE READ AT IMPORT TIME).
async function loadGuard(env: Record<string, string>) {
	for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
	return import('$lib/server/spend-guard');
}

describe('UTC budget window', () => {
	it('starts at 00:00 UTC and resets at the next UTC midnight', async () => {
		const { utcDayStart, utcNextMidnight } = await loadGuard({ AI_DAILY_BUDGET_USD: '5' });
		const now = new Date('2026-08-06T14:30:00.000Z').getTime();
		expect(new Date(utcDayStart(now)).toISOString()).toBe('2026-08-06T00:00:00.000Z');
		expect(new Date(utcNextMidnight(now)).toISOString()).toBe('2026-08-07T00:00:00.000Z');
		// ROLLOVER AT THE BOUNDARY
		const before = utcNextMidnight(now) - 1; // 23:59:59.999 UTC
		expect(utcDayStart(before)).toBe(utcDayStart(now)); // STILL THE SAME DAY
		const after = utcNextMidnight(now) + 1; // 00:00:00.001 UTC
		expect(utcDayStart(after)).toBe(utcDayStart(now) + 86_400_000); // NEW DAY
	});

	it('counts only the current UTC day in dailyAiSpendUsd', async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0 });
		const dayStart = Date.UTC(2026, 7, 6);
		await seedTranslation(db, { chapterId: c1, costUsd: 0.5, createdAt: dayStart + 60_000 }); // TODAY
		await seedTranslation(db, { chapterId: c1, costUsd: 9.0, createdAt: dayStart - 1 }); // YESTERDAY 23:59:59.999
		const { dailyAiSpendUsd } = await loadGuard({ AI_DAILY_BUDGET_USD: '5' });
		// THE MODULE COMPUTES ITS OWN WINDOW FROM Date.now() — FORCE IT TO A KNOWN DAY VIA vi.setSystemTime.
		vi.useFakeTimers();
		vi.setSystemTime(dayStart + 86_400_000 / 2); // 2026-08-06T12:00:00Z
		const spent = await dailyAiSpendUsd('u1');
		vi.useRealTimers();
		expect(spent).toBeCloseTo(0.5, 6);
	});
});

describe('dailyAiSpendUsd attribution', () => {
	it('sums standalone (stamped) + chapter-linked + fetch spend for the user only', async () => {
		await seedUser(db, { id: 'u1' });
		await seedUser(db, { id: 'u2' });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0 });
		await seedBook(db, { id: 'b2', userId: 'u2' });
		const c2 = await seedChapter(db, { bookId: 'b2', seq: 0 });
		const day = Date.UTC(2026, 7, 6, 12);
		// u1: CHAPTER-LINKED + STANDALONE + FETCH
		await seedAi(db, { kind: 'extract', chapterId: c1, costUsd: 0.01, createdAt: day });
		await seedAi(db, { kind: 'title', userId: 'u1', costUsd: 0.02, createdAt: day });
		await seedFetch(db, { userId: 'u1', costUsd: 0.03, createdAt: day });
		// u2 AND LEGACY-UNSTAMPED ROWS MUST NOT LEAK
		await seedAi(db, { kind: 'extract', chapterId: c2, costUsd: 8.0, createdAt: day });
		await seedAi(db, { kind: 'title', userId: 'u2', costUsd: 7.0, createdAt: day });
		await seedAi(db, { kind: 'title', userId: null, costUsd: 6.0, createdAt: day });
		await seedFetch(db, { userId: 'u2', costUsd: 5.0, createdAt: day });

		vi.useFakeTimers();
		vi.setSystemTime(day);
		const { dailyAiSpendUsd } = await loadGuard({ AI_DAILY_BUDGET_USD: '5' });
		expect(await dailyAiSpendUsd('u1')).toBeCloseTo(0.01 + 0.02 + 0.03, 6);
		vi.useRealTimers();
	});
});

describe('assertWithinQuota', () => {
	it('passes when under both limits', async () => {
		await seedUser(db, { id: 'u1' });
		const { assertWithinQuota } = await loadGuard({ AI_DAILY_BUDGET_USD: '5', AI_RPM_LIMIT: '30' });
		await expect(assertWithinQuota('u1')).resolves.toBeUndefined();
	});

	it('rejects with 429 when the per-minute request limit is reached', async () => {
		await seedUser(db, { id: 'u1' });
		const { assertWithinQuota } = await loadGuard({ AI_DAILY_BUDGET_USD: '5', AI_RPM_LIMIT: '2' });
		await assertWithinQuota('u1');
		await assertWithinQuota('u1');
		await expect(assertWithinQuota('u1')).rejects.toMatchObject({ status: 429 });
	});

	it('rejects with 429 when the UTC-day budget is exhausted', async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0 });
		await seedTranslation(db, { chapterId: c1, costUsd: 0.01, createdAt: Date.UTC(2026, 7, 6, 12) });
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 7, 6, 12));
		const { assertWithinQuota } = await loadGuard({ AI_DAILY_BUDGET_USD: '0.005', AI_RPM_LIMIT: '30' });
		await expect(assertWithinQuota('u1')).rejects.toMatchObject({ status: 429 });
		vi.useRealTimers();
	});

	it('AI_DAILY_BUDGET_USD=0 disables the budget check (rate limit still applies)', async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0 });
		await seedTranslation(db, { chapterId: c1, costUsd: 9.99, createdAt: Date.UTC(2026, 7, 6, 12) });
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 7, 6, 12));
		const { assertWithinQuota } = await loadGuard({ AI_DAILY_BUDGET_USD: '0', AI_RPM_LIMIT: '30' });
		await expect(assertWithinQuota('u1')).resolves.toBeUndefined();
		vi.useRealTimers();
	});

	it('an EMPTY budget string means DEFAULT 5, NOT disabled (`Number("")` is 0 — pinned edge)', async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0 });
		await seedTranslation(db, { chapterId: c1, costUsd: 9.99, createdAt: Date.UTC(2026, 7, 6, 12) });
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 7, 6, 12));
		const { assertWithinQuota } = await loadGuard({ AI_DAILY_BUDGET_USD: '', AI_RPM_LIMIT: '30' });
		// DEFAULT $5 → THE $9.99 SPEND IS OVER BUDGET → 429 (AN EMPTY STRING MUST NOT BYPASS THE CAP).
		await expect(assertWithinQuota('u1')).rejects.toMatchObject({ status: 429 });
		vi.useRealTimers();
	});

	it('an empty/invalid RPM string falls back to the default 30 (pinned edge)', async () => {
		await seedUser(db, { id: 'u1' });
		const { assertWithinQuota } = await loadGuard({ AI_DAILY_BUDGET_USD: '5', AI_RPM_LIMIT: '' });
		// 3 QUICK CALLS << 30 — THE FALLBACK MUST HAVE APPLIED (0 OR NaN WOULD BLOCK/EXPLODE).
		await assertWithinQuota('u1');
		await assertWithinQuota('u1');
		await assertWithinQuota('u1');
	});
});
