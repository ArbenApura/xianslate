// ONE-TIME MIGRATION: zh→en HARDCODED SCHEMA → LANGUAGE-PAIR-AWARE SCHEMA.
//
// Renames the language-suffixed columns to source/target naming, adds source_lang/target_lang to
// books and glossary, and backfills every pre-existing row to the app's original direction
// (zh-Hant → en). Idempotent: each step checks the current column set first, so re-running is safe.
//
// Run with:  node scripts/migrate-langs.mjs
// (A timestamped DB backup should already exist; this script also refuses to run on a missing DB.)

import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';

const RAW_URL = process.env.DATABASE_URL ?? 'file:./xianslate.db';
const filePath = RAW_URL.startsWith('file:') ? RAW_URL.slice('file:'.length) : null;
if (filePath && !existsSync(filePath)) {
	console.error(`Database not found at ${filePath} — nothing to migrate.`);
	process.exit(1);
}

const DEFAULT_SOURCE = 'zh-Hant';
const DEFAULT_TARGET = 'en';

const client = createClient({ url: RAW_URL });

async function columns(table) {
	const res = await client.execute(`PRAGMA table_info(${table})`);
	return new Set(res.rows.map((r) => String(r.name)));
}

async function renameColumn(table, from, to) {
	const cols = await columns(table);
	if (cols.has(to)) {
		console.log(`  · ${table}.${to} already exists — skipping rename of ${from}`);
		return;
	}
	if (!cols.has(from)) {
		console.log(`  · ${table}.${from} not present — skipping`);
		return;
	}
	await client.execute(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
	console.log(`  ✓ ${table}.${from} → ${to}`);
}

async function addLangColumns(table) {
	const cols = await columns(table);
	// ADD AS NULLABLE FIRST (SQLite CAN'T ADD A NOT NULL COLUMN WITHOUT A CONSTANT DEFAULT TO EXISTING
	// ROWS CLEANLY), BACKFILL, THEN LEAVE NULLABLE AT THE SQLITE LEVEL — DRIZZLE ENFORCES notNull IN APP
	// CODE AND EVERY ROW IS POPULATED. NEW INSERTS ALWAYS SUPPLY BOTH.
	if (!cols.has('source_lang')) {
		await client.execute(`ALTER TABLE ${table} ADD COLUMN source_lang TEXT`);
		console.log(`  ✓ ${table}.source_lang added`);
	}
	if (!cols.has('target_lang')) {
		await client.execute(`ALTER TABLE ${table} ADD COLUMN target_lang TEXT`);
		console.log(`  ✓ ${table}.target_lang added`);
	}
	const r = await client.execute({
		sql: `UPDATE ${table} SET source_lang = COALESCE(source_lang, ?), target_lang = COALESCE(target_lang, ?)`,
		args: [DEFAULT_SOURCE, DEFAULT_TARGET],
	});
	console.log(`  ✓ ${table} backfilled (${r.rowsAffected} row(s) touched)`);
}

async function main() {
	console.log('Checkpointing WAL…');
	try {
		await client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
	} catch {
		// REMOTE URL OR NON-WAL — IGNORE.
	}

	console.log('books:');
	await renameColumn('books', 'title_en', 'title_target');
	await renameColumn('books', 'author_en', 'author_target');
	await addLangColumns('books');

	console.log('chapters:');
	await renameColumn('chapters', 'title_zh', 'title_source');
	await renameColumn('chapters', 'title_en', 'title_target');
	await renameColumn('chapters', 'content_zh', 'content_source');
	await renameColumn('chapters', 'content_en', 'content_target');

	console.log('translations:');
	await renameColumn('translations', 'content_en', 'content_target');

	console.log('glossary:');
	await renameColumn('glossary', 'raw', 'source');
	await renameColumn('glossary', 'translation', 'target');
	await addLangColumns('glossary');

	// THE OLD GLOBAL-UNIQUE INDEX WAS ON (raw); THE NEW ONE IS ON (source_lang, target_lang, source).
	// DROP THE STALE INDEXES SO drizzle-kit push CAN RECREATE THEM IN THEIR NEW SHAPE WITHOUT CONFLICT.
	console.log('indexes:');
	for (const idx of ['glossary_global_unq', 'glossary_book_unq']) {
		await client.execute(`DROP INDEX IF EXISTS ${idx}`);
		console.log(`  ✓ dropped ${idx} (push will recreate)`);
	}

	console.log('\nMigration complete. Now run: yarn db:push');
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error('\nMigration FAILED:', e);
		process.exit(1);
	});
