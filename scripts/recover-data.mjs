// RECOVER books + glossary (WIPED BY drizzle-kit push's TABLE-RECREATE) FROM THE PRE-MIGRATION BACKUP,
// TRANSFORMING THE OLD SCHEMA INTO THE NEW ONE (title_en→title_target, raw/translation→source/target,
// + sourceLang/targetLang = zh-Hant/en). chapters + translations survived and are left untouched.
import { createClient } from '@libsql/client';

const SRC = 'zh-Hant';
const TGT = 'en';

const bak = createClient({ url: 'file:./recover.db' });
await bak.execute('PRAGMA wal_checkpoint(TRUNCATE)');
const live = createClient({ url: 'file:./xianslate.db' });

const liveBooks = (await live.execute('SELECT count(*) n FROM books')).rows[0].n;
const liveGloss = (await live.execute('SELECT count(*) n FROM glossary')).rows[0].n;
console.log(`live before: books=${liveBooks} glossary=${liveGloss}`);
if (Number(liveBooks) > 0 || Number(liveGloss) > 0) {
	console.log('Live tables are NOT empty — aborting to avoid clobbering. Inspect manually.');
	process.exit(1);
}

const books = (await bak.execute('SELECT * FROM books')).rows;
const gloss = (await bak.execute('SELECT * FROM glossary')).rows;
console.log(`backup: books=${books.length} glossary=${gloss.length}`);

// --- BOOKS ---
const bookStmts = books.map((b) => ({
	sql: `INSERT INTO books (id, source_type, title, author, source_url, cover_url, last_chapter_id, created_at, title_target, last_read_at, author_target, source_lang, target_lang)
	      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	args: [
		b.id,
		b.source_type,
		b.title,
		b.author ?? null,
		b.source_url ?? null,
		b.cover_url ?? null,
		b.last_chapter_id ?? null,
		b.created_at,
		b.title_en ?? null, // → title_target
		b.last_read_at ?? null,
		b.author_en ?? null, // → author_target
		SRC,
		TGT,
	],
}));
await live.batch(bookStmts, 'write');
console.log(`restored ${bookStmts.length} book(s)`);

// --- GLOSSARY (batched) ---
const rows = gloss.map((g) => ({
	sql: `INSERT INTO glossary (id, scope, book_id, source, target, gender, tags, created_at, updated_at, context, source_lang, target_lang)
	      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
	args: [
		g.id,
		g.scope,
		g.book_id ?? null,
		g.raw, // → source
		g.translation, // → target
		g.gender ?? 'neuter',
		g.tags ?? null,
		g.created_at,
		g.updated_at,
		g.context ?? null,
		SRC,
		TGT,
	],
}));
const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
	await live.batch(rows.slice(i, i + CHUNK), 'write');
	process.stdout.write(`\r glossary ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
}
console.log(`\nrestored ${rows.length} glossary term(s)`);

// KEEP AUTOINCREMENT SEQUENCE AHEAD OF THE RESTORED MAX id SO NEW INSERTS DON'T COLLIDE.
const maxId = (await live.execute('SELECT coalesce(max(id),0) m FROM glossary')).rows[0].m;
await live.execute({
	sql: `INSERT INTO sqlite_sequence (name, seq) VALUES ('glossary', ?)
	      ON CONFLICT(name) DO UPDATE SET seq = excluded.seq`,
	args: [maxId],
});

// --- INTEGRITY ---
const fk = (await live.execute('PRAGMA foreign_key_check')).rows;
console.log('foreign_key_check violations:', fk.length);
console.log('final: books=', (await live.execute('SELECT count(*) n FROM books')).rows[0].n,
	'chapters=', (await live.execute('SELECT count(*) n FROM chapters')).rows[0].n,
	'translations=', (await live.execute('SELECT count(*) n FROM translations')).rows[0].n,
	'glossary=', (await live.execute('SELECT count(*) n FROM glossary')).rows[0].n);
process.exit(0);
