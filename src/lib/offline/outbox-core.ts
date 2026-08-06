// PURE, DEPENDENCY-FREE OUTBOX LOGIC — EXTRACTED SO IT CAN BE UNIT-TESTED WITHOUT IndexedDB/FETCH.
// (The IO-bound halves — enqueueWrite/flushOutbox — live in outbox.ts and call these functions.)

export type OutboxStatus = 'success' | 'retry' | 'drop';

// CLASSIFY THE OUTCOME OF ONE REPLAYED OP:
//   - success  → REMOVE THE OP AND MOVE ON
//   - retry    → KEEP THE OP, STOP THE FLUSH (NETWORK GONE / 5xx / UNKNOWN — TRY AGAIN ON NEXT ONLINE)
//   - drop     → REMOVE THE OP (PERMANENT 4xx — THE ROW IS GONE OR THE REQUEST IS MEANINGLESS NOW)
export function classifyOutcome(e: unknown): OutboxStatus {
	if (!(e instanceof Error)) return 'retry';
	const status = (e as Error & { status?: number }).status;
	if (typeof status === 'number') {
		if (status >= 400 && status < 500) return 'drop';
		return 'retry'; // 5xx OR ANY 2xx-3xx RANGE WE NEVER THROW — RETRY TO BE SAFE
	}
	return 'retry'; // NETWORK-TYPE THROW (NO STATUS) — OFFLINE, RETRY LATER
}

// MERGE A FRESHLY-FETCHED PAGE OF ROWS INTO THE CACHED WINDOW: REPLACE SAME-PAGE/SAME-ID ROWS, KEEP
// OTHERS, AND CAP THE WINDOW SO THE CACHE CANNOT GROW UNBOUNDED.
export function mergeOfflineRows<T extends { id: number }>(
	existing: T[],
	incoming: T[],
	max: number,
): T[] {
	const byId = new Map<number, T>();
	for (const r of existing) byId.set(r.id, r);
	for (const r of incoming) byId.set(r.id, r);
	return [...byId.values()].slice(0, max);
}

// CLIENT-SIDE SEARCH OVER CACHED GLOSSARY ROWS (SOURCE OR TARGET CONTAINS THE QUERY).
export function filterOfflineRows<T extends { source: string; target: string }>(
	rows: T[],
	query: string,
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter((r) => r.source.toLowerCase().includes(q) || r.target.toLowerCase().includes(q));
}

// PAGINATE A LOCAL ROW SET THE SAME WAY THE SERVER DOES (1-BASED page, pageSize SLICE).
export function pageOfflineRows<T>(rows: T[], page: number, pageSize: number): T[] {
	return rows.slice((page - 1) * pageSize, page * pageSize);
}
