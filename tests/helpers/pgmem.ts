// PG-MEM IN-MEMORY POSTGRES + DRIZZLE FOR DB-DEPENDENT MODULE TESTS (account-usage, spend-guard, …).
//
// USAGE PATTERN (vi.mock REPLACES THE REAL $lib/server/db SINGLETON PER TEST FILE):
//   vi.mock('$lib/server/db', async () => ({ db: (await import('./helpers/pgmem')).createTestDb() }));
//   import { resetDb, seed* } from './helpers/pgmem';
//   beforeEach(() => resetDb(db));
//
// THE CREATE TABLE STATEMENTS MIRROR src/lib/server/db/schema.ts COLUMN-FOR-COLUMN (ONLY THE SUBSET THE
// AGGREGATIONS TOUCH) SO THE DRIZZLE QUERIES IN THE MODULES UNDER TEST RUN UNCHANGED.
import { newDb, type IMemoryDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/pg-proxy';

// A LOOSELY-TYPED TEST DB HANDLE (pg-proxy RETURNS DRIZZLE'S QUERY BUILDER; WE ONLY USE db.execute + db.insert).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestDb = any & { __pgmem: IMemoryDb };

// A PROCESS-WIDE SINGLETON STORED ON globalThis SO vi.resetModules() (NEEDED TO RELOAD ENV-DEPENDENT MODULES
// LIKE spend-guard — AND WHICH RE-CREATES THE HELPER MODULE ITSELF) KEEPS RETURNING THE SAME IN-MEMORY DB.
const KEY = '__xianslate_pgmem_test_db';
export function getTestDb(): TestDb {
	const g = globalThis as Record<string, TestDb | undefined>;
	g[KEY] ??= createTestDb();
	return g[KEY];
}

const DDL = [
	`CREATE TABLE users (
		id text PRIMARY KEY,
		email text NOT NULL UNIQUE,
		created_at bigint NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE books (
		id text PRIMARY KEY,
		user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		source_type text NOT NULL,
		source_lang text NOT NULL,
		target_lang text NOT NULL,
		title text NOT NULL DEFAULT '',
		title_target text,
		created_at bigint NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE chapters (
		id bigserial PRIMARY KEY,
		uuid text NOT NULL UNIQUE,
		book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
		seq integer NOT NULL,
		chapter_url text,
		title_source text NOT NULL DEFAULT '',
		content_source text NOT NULL DEFAULT '',
		created_at bigint NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE translations (
		id bigserial PRIMARY KEY,
		chapter_id bigint NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
		cache_key text,
		model text NOT NULL DEFAULT '',
		prompt_tokens integer NOT NULL DEFAULT 0,
		cached_tokens integer NOT NULL DEFAULT 0,
		completion_tokens integer NOT NULL DEFAULT 0,
		cost_usd double precision NOT NULL DEFAULT 0,
		created_at bigint NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE ai_usage (
		id bigserial PRIMARY KEY,
		kind text NOT NULL,
		host text,
		user_id text REFERENCES users(id) ON DELETE CASCADE,
		chapter_id bigint REFERENCES chapters(id) ON DELETE CASCADE,
		model text NOT NULL DEFAULT '',
		prompt_tokens integer NOT NULL DEFAULT 0,
		cached_tokens integer NOT NULL DEFAULT 0,
		completion_tokens integer NOT NULL DEFAULT 0,
		cost_usd double precision NOT NULL DEFAULT 0,
		created_at bigint NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE fetch_usage (
		id bigserial PRIMARY KEY,
		user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		chapter_id bigint REFERENCES chapters(id) ON DELETE CASCADE,
		host text,
		provider text NOT NULL DEFAULT '',
		cost_usd double precision NOT NULL DEFAULT 0,
		created_at bigint NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE glossary (
		id bigserial PRIMARY KEY,
		user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		scope text NOT NULL DEFAULT 'global',
		book_id text REFERENCES books(id) ON DELETE CASCADE,
		source_lang text NOT NULL,
		target_lang text NOT NULL,
		source text NOT NULL,
		target text NOT NULL,
		gender text NOT NULL DEFAULT 'neuter',
		context text,
		tags text,
		category text,
		pinned boolean NOT NULL DEFAULT false,
		status text NOT NULL DEFAULT 'ai',
		aliases text,
		first_chapter_id bigint,
		created_at bigint NOT NULL DEFAULT 0,
		updated_at bigint NOT NULL DEFAULT 0
	)`,
];

// A FRESH, SCHEMA-READY IN-MEMORY DB. CALL ONCE PER TEST FILE (THE vi.mock FACTORY RUNS ONCE PER GRAPH);
// RESET BETWEEN TESTS WITH resetDb(). THE DRIZZLE DRIVER IS pg-proxy BRIDGED TO PG-MEM (THE DOCUMENTED
// PATTERN — pg-mem's createPg() CLIENT IS NOT COMPATIBLE WITH drizzle-orm/node-postgres).
export function createTestDb(): TestDb {
	const mem = newDb();
	for (const ddl of DDL) mem.public.none(ddl);
	const db = drizzle(async (sqlText, params, method) => {
		// PG-MEM's public.many() DOESN'T BIND $N PARAMETER ARRAYS — INTERPOLATE THEM (TEST DATA ONLY: THE
		// VALUES COME FROM OUR SEEDS, AND STRINGS ARE QUOTED WITH DOUBLED APOSTROPHES SO NOTHING ESCAPES).
		// ONE-PASS /\$(\d+)/g (NOT replaceAll('$1', …)) SO A $10 PLACEHOLDER ISN'T CORRUPTED AS $1+0.
		const text =
			(params ?? []).length === 0
				? sqlText
				: sqlText.replace(/\$(\d+)/g, (m, n) => {
						const v = params[Number(n) - 1];
						if (v === undefined) return m; // UNKNOWN PLACEHOLDER — PG-MEM REJECTS IT LOUDLY
						return v === null
							? 'NULL'
							: typeof v === 'number' || typeof v === 'boolean'
								? String(v)
								: `'${String(v).replace(/'/g, "''")}'`;
					});
		if (method === 'execute') {
			mem.public.none(text);
			return { rows: [] as Record<string, unknown>[] };
		}
		return { rows: runSelect(text) };

		function runSelect(s: string): unknown[][] {
			// DRIZZLE's pg-proxy mapResultRow READS RESULT ROWS POSITIONALLY (row[columnIndex]) — THE
			// DOCUMENTED PG-MEM RECIPE USES rowMode:'array'. PG-MEM ALSO KEYS AGGREGATES BY FUNCTION NAME
			// ALONE (TWO coalesce(...) COLUMNS WOULD COLLIDE), SO WE REWRITE NON-COLUMN SELECT ITEMS WITH
			// UNIQUE ALIASES, EXECUTE, AND EMIT POSITIONAL ARRAYS IN ORIGINAL SELECT ORDER.
			// FAIL LOUDLY ON QUERY SHAPES THE BRIDGE CAN'T HANDLE (CTEs, DISTINCT, SUBQUERIES IN THE SELECT
			// LIST) — SILENTLY CORRUPTED RESULTS WOULD BE WORSE THAN A TEST FAILURE (A REVIEW FLAGGED THIS).
			if (!/^\s*select\b/i.test(s.trim())) {
				throw new Error('pg-mem bridge: unsupported SQL shape (only plain SELECT is bridged)');
			}
			if (/^\s*select\s+(distinct|all)\b/i.test(s.trim())) {
				throw new Error('pg-mem bridge: unsupported SELECT DISTINCT — rewrite the query or extend the bridge');
			}
			const m = /^\s*select\s+([\s\S]*?)\s+from\s/i.exec(s);
			if (!m) return mem.public.many(s) as unknown[][];
			const plan = splitTopLevel(m[1])
				.map((x) => x.trim())
				.map((it, i): { get: (row: Record<string, unknown>) => unknown; alias?: string; orig?: string; plain?: string } => {
					// PLAIN (POSSIBLY QUOTED, POSSIBLY QUALIFIED) COLUMN — PG-MEM KEYS IT BY THE UNQUALIFIED NAME.
					if (/^"?[a-zA-Z_][\w]*"?(\."?[a-zA-Z_][\w]*"?)?$/.test(it)) {
						const name = it.split('.').pop()!.replaceAll('"', '');
						return { plain: it, get: (row) => row[name] };
					}
					const alias = `x${i}`;
					return { alias, orig: it, get: (row) => row[alias] };
				});
			const rewritten = plan
				.map((p, i) => (p.alias ? `${p.orig} as "x${i}"` : p.plain))
				.join(', ');
			const sql2 = s.replace(m[1], rewritten);
			const objRows = mem.public.many(sql2) as Record<string, unknown>[];
			return objRows.map((row) => plan.map((p) => p.get(row)));
		}
	}) as TestDb;
	db.__pgmem = mem;
	return db;
}

// SPLIT A SELECT LIST ON TOP-LEVEL COMMAS (NOT INSIDE PARENTHESES).
function splitTopLevel(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of s) {
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		if (ch === ',' && depth === 0) {
			out.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	if (cur.trim()) out.push(cur);
	return out;
}

// WIPE EVERY TABLE (CASCADE ORDER) SO EACH TEST STARTS CLEAN.
export async function resetDb(db: TestDb): Promise<void> {
	for (const t of ['translations', 'ai_usage', 'fetch_usage', 'glossary', 'chapters', 'books', 'users']) {
		await db.execute(sql_unsafe(`DELETE FROM ${t}`));
	}
}

// RAW SQL HELPER (pg-mem + drizzle node-postgres EXECUTE RAW VIA sql TEMPLATE).
import { sql } from 'drizzle-orm';
export const sql_unsafe = (s: string) => sql.raw(s);

// -- SEED HELPERS (TYPED-LITE, KEY/COLUMN NAMES MATCH THE SCHEMA) -- //

export interface SeedUser {
	id: string;
	createdAt?: number;
}
export async function seedUser(db: TestDb, u: SeedUser): Promise<void> {
	await db.execute(
		sql_unsafe(
			`INSERT INTO users (id, email, created_at) VALUES ('${u.id}', '${u.id}@test.dev', ${u.createdAt ?? 0})`,
		),
	);
}

export async function seedBook(
	db: TestDb,
	b: { id: string; userId: string; sourceLang?: string; targetLang?: string },
): Promise<void> {
	await db.execute(
		sql_unsafe(
			`INSERT INTO books (id, user_id, source_type, source_lang, target_lang) VALUES ('${b.id}', '${b.userId}', 'web', '${b.sourceLang ?? 'zh-Hant'}', '${b.targetLang ?? 'en'}')`,
		),
	);
}

// RETURNS THE GENERATED chapter.id (bigserial).
export async function seedChapter(
	db: TestDb,
	c: { bookId: string; seq: number; uuid?: string; createdAt?: number },
): Promise<number> {
	const uuid = c.uuid ?? `u-${c.bookId}-${c.seq}`;
	await db.execute(
		sql_unsafe(
			`INSERT INTO chapters (uuid, book_id, seq, created_at) VALUES ('${uuid}', '${c.bookId}', ${c.seq}, ${c.createdAt ?? 0})`,
		),
	);
	// PG-PROXY's db.execute DOESN'T RETURN ROWS FOR SELECTs — QUERY PG-MEM DIRECTLY FOR THE GENERATED id.
	const rows = db.__pgmem.public.many(`SELECT id FROM chapters WHERE uuid = '${uuid}'`);
	return Number(rows[0].id);
}

export interface SeedTranslation {
	chapterId: number;
	model?: string;
	promptTokens?: number;
	cachedTokens?: number;
	completionTokens?: number;
	costUsd?: number;
	createdAt?: number;
}
export async function seedTranslation(db: TestDb, t: SeedTranslation): Promise<void> {
	await db.execute(
		sql_unsafe(
			`INSERT INTO translations (chapter_id, model, prompt_tokens, cached_tokens, completion_tokens, cost_usd, created_at)
			 VALUES (${t.chapterId}, '${t.model ?? 'm'}', ${t.promptTokens ?? 0}, ${t.cachedTokens ?? 0}, ${t.completionTokens ?? 0}, ${t.costUsd ?? 0}, ${t.createdAt ?? 0})`,
		),
	);
}

export interface SeedAi {
	kind: string;
	model?: string;
	userId?: string | null;
	chapterId?: number | null;
	promptTokens?: number;
	cachedTokens?: number;
	completionTokens?: number;
	costUsd?: number;
	createdAt?: number;
}
export async function seedAi(db: TestDb, a: SeedAi): Promise<void> {
	await db.execute(
		sql_unsafe(
			`INSERT INTO ai_usage (kind, model, user_id, chapter_id, prompt_tokens, cached_tokens, completion_tokens, cost_usd, created_at)
			 VALUES ('${a.kind}', '${a.model ?? 'm'}', ${a.userId ? `'${a.userId}'` : 'NULL'}, ${a.chapterId ?? 'NULL'}, ${a.promptTokens ?? 0}, ${a.cachedTokens ?? 0}, ${a.completionTokens ?? 0}, ${a.costUsd ?? 0}, ${a.createdAt ?? 0})`,
		),
	);
}

export async function seedFetch(
	db: TestDb,
	f: { userId: string; provider?: string; costUsd?: number; chapterId?: number | null; createdAt?: number },
): Promise<void> {
	await db.execute(
		sql_unsafe(
			`INSERT INTO fetch_usage (user_id, provider, cost_usd, chapter_id, created_at)
			 VALUES ('${f.userId}', '${f.provider ?? 'zyte'}', ${f.costUsd ?? 0}, ${f.chapterId ?? 'NULL'}, ${f.createdAt ?? 0})`,
		),
	);
}
