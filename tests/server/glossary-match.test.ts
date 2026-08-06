// GLOSSARY-MATCHING TESTS — THE LONGEST-MATCH / WORD-BOUNDARY / ALIAS LOGIC BEHIND TERM EXTRACTION AND THE
// "NEW TO THIS CHAPTER" BADGE, AGAINST PG-MEM.
//
// REGRESSION PINS: (a) THE COVERAGE-AWARE LONGEST-MATCH RULE — 齊天 MUST SURVIVE WHEN IT ALSO APPEARS ON
// ITS OWN ALONGSIDE 齊天神丹 (THE BUG THAT ERASED PROPER NOUNS); (b) A TRUE FRAGMENT (ONLY EVER INSIDE A
// LONGER TERM) IS DROPPED; (c) WORD-DELIMITED LANGUAGES DON'T MATCH INSIDE WORDS ("art" in "start");
// (d) CJK MATCHES SUBSTRING-WISE; (e) ALIASES MATCH AND RENDER TO THE SAME TERM.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, resetDb, seedBook, seedUser, sql_unsafe, type TestDb } from '../helpers/pgmem';

vi.mock('$lib/server/db', async () => ({ db: (await import('../helpers/pgmem')).getTestDb() }));

const { matchTerms, sourcesPresentIn, invalidateBook } = await import('$lib/server/glossary-match');

let db: TestDb;

beforeEach(async () => {
	db = getTestDb();
	await resetDb(db);
});

async function seedTerm(b: { userId: string; bookId?: string; scope: 'global' | 'book'; sourceLang: string; targetLang: string; source: string; aliases?: string[]; status?: string }) {
	const aliasesJson = b.aliases?.length ? JSON.stringify(b.aliases) : null;
	const bookId = b.bookId ? `'${b.bookId}'` : 'NULL';
	await db.execute(sql_unsafe(
		`INSERT INTO glossary (user_id, scope, book_id, source_lang, target_lang, source, target, status, aliases)
		 VALUES ('${b.userId}', '${b.scope}', ${bookId}, '${b.sourceLang}', '${b.targetLang}', '${b.source}', 'X', '${b.status ?? 'user'}', ${aliasesJson ? `'${aliasesJson.replace(/'/g, "''")}'` : 'NULL'})`,
	));
}

describe('matchTerms — CJK (substring) matching + coverage-aware longest match', () => {
	beforeEach(async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1', sourceLang: 'zh-Hant', targetLang: 'en' });
	});

	it('keeps a term that appears both alone and inside a longer matched term (齊天 regression)', async () => {
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'zh-Hant', targetLang: 'en', source: '齊天' });
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'zh-Hant', targetLang: 'en', source: '齊天神丹' });
		invalidateBook('b1');
		const terms = await matchTerms('b1', '齊天 與 齊天神丹 齊天');
		const sources = terms.map((t) => t.source).sort();
		expect(sources).toContain('齊天');
		expect(sources).toContain('齊天神丹');
	});

	it('drops a term whose every occurrence sits inside a longer matched term (true fragment)', async () => {
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'zh-Hant', targetLang: 'en', source: '山' });
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'zh-Hant', targetLang: 'en', source: '高山' });
		invalidateBook('b1');
		const terms = await matchTerms('b1', '高山之上');
		expect(terms.map((t) => t.source)).toEqual(['高山']);
	});

	it('matches substring-wise for CJK (scriptura continua)', async () => {
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'zh-Hant', targetLang: 'en', source: '劍' });
		invalidateBook('b1');
		expect((await matchTerms('b1', '長劍出鞘')).map((t) => t.source)).toEqual(['劍']);
	});
});

describe('matchTerms — word-delimited languages', () => {
	beforeEach(async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1', sourceLang: 'en', targetLang: 'zh-Hant' });
	});

	it('does NOT match "art" inside "start" (word boundary required)', async () => {
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'en', targetLang: 'zh-Hant', source: 'art' });
		invalidateBook('b1');
		expect(await matchTerms('b1', 'this is the start of the story')).toHaveLength(0);
	});

	it('matches "art" as a standalone word and at punctuation boundaries', async () => {
		await seedTerm({ userId: 'u1', bookId: 'b1', scope: 'book', sourceLang: 'en', targetLang: 'zh-Hant', source: 'art' });
		invalidateBook('b1');
		expect((await matchTerms('b1', 'The art of war; art!')).map((t) => t.source)).toEqual(['art']);
	});
});

describe('aliases', () => {
	beforeEach(async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1', sourceLang: 'zh-Hant', targetLang: 'en' });
	});

	it('matches an alias and resolves to the owning term', async () => {
		await seedTerm({
			userId: 'u1',
			bookId: 'b1',
			scope: 'book',
			sourceLang: 'zh-Hant',
			targetLang: 'en',
			source: '齊天大聖',
			aliases: ['孫悟空', '大聖'],
		});
		invalidateBook('b1');
		const terms = await matchTerms('b1', '孫悟空與齊天大聖');
		expect(terms).toHaveLength(1);
		expect(terms[0].source).toBe('齊天大聖');
	});
});

describe('sourcesPresentIn — the "new to this chapter" set', () => {
	beforeEach(async () => {
		await seedUser(db, { id: 'u1' });
		await seedBook(db, { id: 'b1', userId: 'u1', sourceLang: 'en', targetLang: 'zh-Hant' });
	});

	it('returns exactly the candidate sources present, honoring word boundaries', async () => {
		const present = await sourcesPresentIn('b1', 'the sword and the shield of kings', ['sword', 'king', 'art']);
		expect([...present].sort()).toEqual(['king', 'sword']);
	});
});
