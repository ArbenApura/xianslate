// CREATE THE LANGUAGE-PAIR-AWARE PARTIAL UNIQUE INDEXES THE GLOSSARY UPSERTS RELY ON.
// (drizzle-kit push is interactive in this environment; this does the one piece the app NEEDS at runtime
// — the onConflict targets in mergeGlossary/addTerm require these exact indexes to exist.)
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.DATABASE_URL ?? 'file:./xianslate.db' });

await client.execute(
	`CREATE UNIQUE INDEX IF NOT EXISTS glossary_global_unq ON glossary (source_lang, target_lang, source) WHERE scope = 'global'`,
);
await client.execute(
	`CREATE UNIQUE INDEX IF NOT EXISTS glossary_book_unq ON glossary (book_id, source) WHERE scope = 'book'`,
);

const idx = await client.execute(`PRAGMA index_list('glossary')`);
console.log(
	'glossary indexes:',
	idx.rows.map((r) => r.name).join(', '),
);
console.log('Done.');
process.exit(0);
