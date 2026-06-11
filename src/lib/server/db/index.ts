// IMPORTED DEP-TYPES
import { type Client } from '@libsql/client';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
// IMPORTED MODULES
import * as schema from './schema';

// -- TYPES -- //

declare global {
	var __xianslateClient: Client | undefined;
}

// -- CONSTANTS -- //

// SINGLETON CLIENT — REUSED ACROSS REQUESTS / HMR RELOADS
const url = env.DATABASE_URL ?? 'file:./xianslate.db';

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
