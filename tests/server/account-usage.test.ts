// ACCOUNT-USAGE AGGREGATION TESTS — THE STATS BEHIND /app/account/usage, EXERCISED AGAINST PG-MEM.
//
// REGRESSION PINS: (a) STANDALONE ai_usage (chapterId NULL, userId-STAMPED — MANAGE-PAGE TITLE BACKFILLS,
// GLOBAL GLOSSARY TERMS) MUST APPEAR IN THE HEADLINE TOTALS; (b) A STAMPED 'map' ROW MUST BE COUNTED IN THE
// map BUCKET ONLY — NEVER ALSO IN pipeline (THE DOUBLE-COUNT THE FIX CLOSED); (c) OTHER USERS' SPEND (BY
// CHAIN OR BY userId) MUST NOT LEAK IN; (d) LEGACY UNSTAMPED STANDALONE ROWS STAY EXCLUDED (PREDATE
// ATTRIBUTION).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, seedAi, seedBook, seedChapter, seedFetch, seedTranslation, seedUser, type TestDb } from '../helpers/pgmem';

// THE MODULES UNDER TEST GET THE PG-MEM DB INSTEAD OF THE REAL SINGLETON.
vi.mock('$lib/server/db', async () => ({ db: (await import('../helpers/pgmem')).createTestDb() }));

// IMPORT AFTER THE MOCK IS REGISTERED.
const { getAccountUsage } = await import('$lib/server/account-usage');

let db: TestDb;

beforeEach(async () => {
	// THE SAME INSTANCE THE MOCK RETURNS (ONE PER FILE) — WIPE IT BETWEEN TESTS.
	db = (await import('$lib/server/db')).db as TestDb;
	await resetDb(db);
});

const NOW = 1_800_000_000_000;

describe('getAccountUsage — totals reconcile with the ledgers', () => {
	it('sums body + pipeline + map + fetch into the headline total, with no double counting', async () => {
		await seedUser(db, { id: 'u1', createdAt: NOW });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0, createdAt: NOW });
		// BODY: TWO TRANSLATION RUNS ON c1
		await seedTranslation(db, { chapterId: c1, costUsd: 0.10, promptTokens: 1000, completionTokens: 500, createdAt: NOW });
		await seedTranslation(db, { chapterId: c1, costUsd: 0.05, promptTokens: 400, completionTokens: 200, createdAt: NOW });
		// PIPELINE (CHAPTER-LINKED): EXTRACT + TITLE ON c1
		await seedAi(db, { kind: 'extract', chapterId: c1, costUsd: 0.01, promptTokens: 50, completionTokens: 10, createdAt: NOW });
		await seedAi(db, { kind: 'title', chapterId: c1, costUsd: 0.005, promptTokens: 20, completionTokens: 5, createdAt: NOW });
		// MAP (STAMPED, GLOBAL): MUST LAND IN THE map BUCKET ONLY
		await seedAi(db, { kind: 'map', userId: 'u1', costUsd: 0.02, promptTokens: 30, completionTokens: 0, createdAt: NOW });
		// FETCH (USER-KEYED)
		await seedFetch(db, { userId: 'u1', costUsd: 0.04, createdAt: NOW });

		const u = await getAccountUsage('u1');
		expect(u.totalCostUsd).toBeCloseTo(0.10 + 0.05 + 0.01 + 0.005 + 0.02 + 0.04, 6);
		expect(u.body.runs).toBe(2);
		expect(u.body.costUsd).toBeCloseTo(0.15, 6);
		expect(u.map.calls).toBe(1);
		expect(u.map.costUsd).toBeCloseTo(0.02, 6);
		expect(u.fetch.items.reduce((s, r) => s + Number(r.calls), 0)).toBe(1);
		// THE map ROW MUST NOT ALSO BE IN pipeline:
		expect(u.pipeline.items.map((i) => i.kind)).not.toContain('map');
		// TOKENS: PROMPT = 1000+400+50+20+30 (=1500), COMPLETION = 500+200+10+5 (=715)
		expect(u.promptTokens).toBe(1500);
		expect(u.completionTokens).toBe(715);
		expect(u.totalTokens).toBe(1500 + 715);
		expect(u.cacheHitRate).toBe(0);
	});

	it('counts standalone (userId-stamped, chapterId NULL) title/term spend in the headline totals', async () => {
		await seedUser(db, { id: 'u1', createdAt: NOW });
		// NO BOOK/CHAPTER AT ALL — PURE STANDALONE SPEND (MANAGE-PAGE TITLE BACKFILL + GLOBAL TERM)
		await seedAi(db, { kind: 'title', userId: 'u1', costUsd: 0.003, promptTokens: 40, completionTokens: 4, createdAt: NOW });
		await seedAi(db, { kind: 'term', userId: 'u1', costUsd: 0.002, promptTokens: 30, completionTokens: 3, createdAt: NOW });

		const u = await getAccountUsage('u1');
		expect(u.totalCostUsd).toBeCloseTo(0.005, 6);
		expect(u.promptTokens).toBe(70);
		const kinds = u.pipeline.items.map((i) => i.kind);
		expect(kinds).toContain('title');
		expect(kinds).toContain('term');
		// NO BOOK ATTACHED → NOT IN PER-BOOK, BUT IN PER-MODEL
		expect(u.books).toHaveLength(0);
		expect(u.models.reduce((s, m) => s + Number(m.costUsd), 0)).toBeCloseTo(0.005, 6);
	});

	it('excludes legacy unstamped standalone rows (they predate attribution) and other users entirely', async () => {
		await seedUser(db, { id: 'u1', createdAt: NOW });
		await seedUser(db, { id: 'u2', createdAt: NOW });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0, createdAt: NOW });
		await seedBook(db, { id: 'b2', userId: 'u2' });
		const c2 = await seedChapter(db, { bookId: 'b2', seq: 0, createdAt: NOW });
		// LEGACY: STANDALONE ROW WITH NO userId (PRE-STAMP) — MUST STAY INVISIBLE
		await seedAi(db, { kind: 'title', userId: null, costUsd: 9.99, promptTokens: 999, createdAt: NOW });
		// ANOTHER USER'S CHAIN + STANDALONE — MUST NOT LEAK
		await seedAi(db, { kind: 'extract', chapterId: c2, costUsd: 8.0, createdAt: NOW });
		await seedAi(db, { kind: 'title', userId: 'u2', costUsd: 7.0, createdAt: NOW });
		await seedTranslation(db, { chapterId: c2, costUsd: 6.0, createdAt: NOW });
		await seedFetch(db, { userId: 'u2', costUsd: 5.0, createdAt: NOW });
		// AND ONE LEGIT ROW FOR u1 SO WE KNOW THE AGGREGATION IS LIVE
		await seedTranslation(db, { chapterId: c1, costUsd: 0.25, createdAt: NOW });

		const u = await getAccountUsage('u1');
		expect(u.totalCostUsd).toBeCloseTo(0.25, 6);
		expect(u.pipeline.items).toHaveLength(0);
		expect(u.map.calls).toBe(0);
		expect(u.fetch.items).toHaveLength(0);
		expect(u.books).toHaveLength(1);
		expect(u.books[0].costUsd).toBeCloseTo(0.25, 6);
	});

	it('computes cacheHitRate as cached/prompt on a cache-hit run', async () => {
		await seedUser(db, { id: 'u1', createdAt: NOW });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0, createdAt: NOW });
		await seedTranslation(db, { chapterId: c1, promptTokens: 1000, cachedTokens: 600, completionTokens: 300, createdAt: NOW });

		const u = await getAccountUsage('u1');
		expect(u.promptTokens).toBe(1000); // PROMPT INCLUDES THE CACHED PORTION (DEEPSEEK SEMANTICS)
		expect(u.cacheHitRate).toBeCloseTo(0.6, 6);
	});

	it('books breakdown attributes chapter-linked spend to the owning book', async () => {
		await seedUser(db, { id: 'u1', createdAt: NOW });
		await seedBook(db, { id: 'b1', userId: 'u1' });
		const c1 = await seedChapter(db, { bookId: 'b1', seq: 0, createdAt: NOW });
		await seedTranslation(db, { chapterId: c1, costUsd: 0.10, promptTokens: 500, completionTokens: 100, createdAt: NOW });
		await seedAi(db, { kind: 'extract', chapterId: c1, costUsd: 0.01, createdAt: NOW });

		const u = await getAccountUsage('u1');
		expect(u.books).toHaveLength(1);
		expect(u.books[0].bookId).toBe('b1');
		expect(u.books[0].costUsd).toBeCloseTo(0.11, 6);
		expect(u.books[0].promptTokens).toBe(500);
	});
});
