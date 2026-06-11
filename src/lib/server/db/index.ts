import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

// SINGLETON CLIENT — REUSED ACROSS REQUESTS / HMR RELOADS
const url = env.DATABASE_URL ?? 'file:./xianslate.db';

declare global {
	var __xianslateClient: Client | undefined;
}

const client = globalThis.__xianslateClient ?? createClient({ url });
if (!globalThis.__xianslateClient) {
	globalThis.__xianslateClient = client;
	// LOCAL FILE: ENABLE WAL FOR FAST CONCURRENT READS + FOREIGN KEYS FOR CASCADE DELETES (NO-OP FOR
	// REMOTE URLS). THESE MUST BE AWAITED *BEFORE* THE FIRST QUERY — OTHERWISE foreign_keys=ON MAY NOT
	// HAVE TAKEN EFFECT YET AND CASCADE DELETES (book→chapters→translations→glossary) SILENTLY ORPHAN
	// ROWS. TOP-LEVEL await GATES THE `db` EXPORT UNTIL THE PRAGMAS ARE APPLIED.
	if (url.startsWith('file:')) {
		await client.executeMultiple(
			'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;',
		);
	}
}

export const db = drizzle(client, { schema });
export { schema };
