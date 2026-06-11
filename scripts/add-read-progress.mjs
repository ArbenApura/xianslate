// ADD chapters.read_progress (REAL, NULLABLE) — TRACKS HOW MUCH OF EACH CHAPTER HAS ACTUALLY BEEN READ.
// SAFE, IDEMPOTENT: ADD COLUMN IS NON-DESTRUCTIVE AND SKIPPED IF ALREADY PRESENT. (NOT db:push — THAT
// RECREATES TABLES AND HAS DROPPED DATA HERE BEFORE.)
import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.DATABASE_URL ?? 'file:./xianslate.db' });
const cols = new Set((await c.execute(`PRAGMA table_info(chapters)`)).rows.map((r) => String(r.name)));
if (cols.has('read_progress')) {
	console.log('chapters.read_progress already exists — nothing to do.');
} else {
	await c.execute(`ALTER TABLE chapters ADD COLUMN read_progress REAL`);
	console.log('✓ added chapters.read_progress');
}
process.exit(0);
