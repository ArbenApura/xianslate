import { defineConfig } from 'drizzle-kit';

// MIGRATIONS RUN AGAINST THE DIRECT/SESSION ENDPOINT (NOT THE TRANSACTION POOLER) SO DDL + drizzle-kit
// INTROSPECTION BEHAVE. `drizzle-kit generate` IS OFFLINE (NO CONNECTION); ONLY push/migrate USE THE URL.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url },
});
