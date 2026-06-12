// IMPORTED DEP-MODULES
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// THE THIRD CONNECTION ROLE: A DIRECT/SESSION-ENDPOINT MIGRATOR CLIENT (max:1). DDL + drizzle's migration
// BOOKKEEPING NEED A STABLE SESSION, SO THIS USES THE DIRECT URL (NOT THE TRANSACTION POOLER). RUN VIA
// `npm run db:migrate` (node --env-file=.env), SO IT READS process.env — $env/dynamic/private IS A
// SvelteKit-RUNTIME-ONLY IMPORT AND ISN'T AVAILABLE IN A STANDALONE node SCRIPT.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '';
if (!url) {
	console.error('Set DATABASE_URL_DIRECT (or DATABASE_URL) before running migrations.');
	process.exit(1);
}

const migrator = postgres(url, { max: 1 });

await migrate(drizzle(migrator), { migrationsFolder: './drizzle' });
await migrator.end();

console.log('Migrations applied.');
