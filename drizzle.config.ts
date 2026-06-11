import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL ?? 'file:./xianslate.db';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'turso',
	dbCredentials: { url },
});
