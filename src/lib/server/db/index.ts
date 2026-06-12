// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
// IMPORTED MODULES
import * as schema from './schema';

// -- TYPES -- //

declare global {
	var __xianslatePg: { write: ReturnType<typeof postgres>; read: ReturnType<typeof postgres> } | undefined;
}

// -- CONSTANTS -- //

// POOLED PRIMARY (Neon `-pooler`, TRANSACTION MODE) FOR WRITES + READ-YOUR-WRITES. THE REPLICA ENDPOINT
// SERVES HEAVY READS — IT POINTS AT THE PRIMARY UNTIL A REAL REPLICA IS ADDED (SAME URL = NO-OP SPLIT).
const PRIMARY = env.DATABASE_URL ?? '';
const REPLICA = env.DATABASE_URL_REPLICA || PRIMARY;

// SINGLETON POOLS — REUSED ACROSS REQUESTS / HMR RELOADS. TRANSACTION-MODE POOLING REQUIRES prepare:false
// (THE POOLER GIVES A DIFFERENT BACKEND PER STATEMENT, SO SERVER-SIDE PREPARED STATEMENTS CAN'T BE REUSED).
// postgres.js IS LAZY — NO CONNECTION OPENS UNTIL THE FIRST QUERY — SO AN UNSET URL DOESN'T CRASH AT BOOT.
const pool = globalThis.__xianslatePg ?? {
	write: postgres(PRIMARY, { prepare: false, max: 10 }),
	read: postgres(REPLICA, { prepare: false, max: 10 }),
};
if (!globalThis.__xianslatePg) globalThis.__xianslatePg = pool;

// dbWrite = POOLED PRIMARY (writes + read-your-writes). dbRead = REPLICA ENDPOINT (heavy reads). MIGRATIONS
// RUN OUT-OF-BAND VIA THE THIRD ROLE — A DIRECT/SESSION-ENDPOINT `migrator` CLIENT (max:1) IN src/lib/server/db/migrate.ts
// (A STANDALONE node SCRIPT; $env/dynamic/private ISN'T AVAILABLE THERE, SO IT READS process.env DIRECTLY).
export const dbWrite = drizzle(pool.write, { schema });

export const dbRead = drizzle(pool.read, { schema });

// BACK-COMPAT: EXISTING CODE IMPORTS `db`. KEEP IT POINTING AT THE PRIMARY (CORRECT FOR BOTH READS + WRITES).
export const db = dbWrite;

export { schema };
