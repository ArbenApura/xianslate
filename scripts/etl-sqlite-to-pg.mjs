// ONE-TIME ETL: COPY THE LOCAL libsql/SQLite LIBRARY INTO POSTGRES (NEON).
//
// RUN ORDER:
//   1. Provision Neon + set DATABASE_URL_DIRECT (+ DATABASE_URL) in .env (see .env.example).
//   2. npm run db:migrate          # creates the Postgres schema from ./drizzle
//   3. node --env-file=.env scripts/etl-sqlite-to-pg.mjs
//
// READS SQLITE FROM SQLITE_URL (default file:./xianslate.db); WRITES TO DATABASE_URL_DIRECT (Neon direct
// endpoint — NOT the transaction pooler). Idempotent-ish: it appends, so run it against a freshly migrated
// (empty) Postgres. After it succeeds you can `npm rm @libsql/client` (the app no longer uses libsql).
import { createClient } from '@libsql/client';
import postgres from 'postgres';

const SQLITE_URL = process.env.SQLITE_URL ?? 'file:./xianslate.db';
const PG_URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '';
if (!PG_URL) {
	console.error('Set DATABASE_URL_DIRECT (Neon direct endpoint) before running the ETL.');
	process.exit(1);
}

// PHASE 4 BACKFILL: THE OLD SINGLE-USER DATA HAS NO OWNER, SO ASSIGN IT ALL TO A SEED ADMIN. SET THESE TO
// *YOUR* FIREBASE uid + EMAIL SO YOUR EXISTING LIBRARY BELONGS TO YOUR ACCOUNT AFTER YOU SIGN IN; OTHERWISE
// A PLACEHOLDER ADMIN IS CREATED (RE-ASSIGN ITS uid LATER VIA SQL IF NEEDED).
const SEED_ADMIN_UID = process.env.SEED_ADMIN_UID ?? 'seed-admin';
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

// FK-DEPENDENCY ORDER — PARENTS BEFORE CHILDREN.
const TABLES = ['books', 'chapters', 'translations', 'glossary', 'site_adapters', 'site_events', 'ai_usage'];
// TABLES WHOSE bigserial id SEQUENCE MUST BE RESET AFTER EXPLICIT-id INSERTS (ELSE THE NEXT INSERT COLLIDES).
const SERIAL_TABLES = ['chapters', 'translations', 'glossary', 'site_events', 'ai_usage'];
const CHUNK = 500;

const lite = createClient({ url: SQLITE_URL });
const pg = postgres(PG_URL, { max: 1 });

try {
	// 1) SEED ADMIN USER — books/glossary.user_id IS NOT NULL + FK users.id, SO THE OWNER MUST EXIST FIRST.
	await pg`
		insert into users (id, email, email_verified, name, role, created_at)
		values (${SEED_ADMIN_UID}, ${SEED_ADMIN_EMAIL}, true, ${'Seed Admin'}, ${'admin'}, ${Date.now()})
		on conflict (id) do nothing
	`;
	console.log(`users: seed admin ${SEED_ADMIN_UID}`);

	// 2) COPY EVERY TABLE. books + glossary GET user_id = THE SEED ADMIN (THEY HAD NO OWNER ON SQLite).
	for (const table of TABLES) {
		const res = await lite.execute(`SELECT * FROM ${table}`);
		const cols = res.columns;
		// BUILD PLAIN OBJECTS KEYED BY THE SNAKE_CASE COLUMN NAMES (= THE POSTGRES COLUMN NAMES).
		let rows = res.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
		if (table === 'books' || table === 'glossary') rows = rows.map((row) => ({ ...row, user_id: SEED_ADMIN_UID }));
		if (rows.length === 0) {
			console.log(`${table}: 0 rows`);
			continue;
		}
		for (let i = 0; i < rows.length; i += CHUNK) {
			const slice = rows.slice(i, i + CHUNK);
			// postgres.js GENERATES THE COLUMN LIST + MULTI-ROW VALUES FROM THE OBJECT KEYS. TEXT uuid VALUES
			// CAST TO THE NATIVE uuid COLUMN VIA POSTGRES'S text->uuid ASSIGNMENT CAST.
			await pg`insert into ${pg(table)} ${pg(slice)}`;
		}
		console.log(`${table}: ${rows.length} rows`);
	}

	// RESET IDENTITY SEQUENCES SO FUTURE bigserial INSERTS START ABOVE THE COPIED ids.
	for (const table of SERIAL_TABLES) {
		const [{ max }] = await pg`select max(id)::bigint as max from ${pg(table)}`;
		if (max != null) await pg`select setval(pg_get_serial_sequence(${table}, 'id'), ${max})`;
	}
	console.log('ETL complete.');
} catch (e) {
	console.error('ETL failed:', e);
	process.exitCode = 1;
} finally {
	await pg.end();
	lite.close?.();
}
