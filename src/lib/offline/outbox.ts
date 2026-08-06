// OFFLINE WRITE QUEUE (OUTBOX) — WRITES THE USER MAKES WHILE OFFLINE ARE QUEUED IN IndexedDB AND REPLAYED
// IN ORDER WHEN THE NETWORK RETURNS, SO NOTHING (PROGRESS, PIN/ARCHIVE, GLOSSARY EDITS, …) IS SILENTLY
// LOST. ONLINE WRITES KEEP THEIR EXACT CURRENT BEHAVIOUR (DIRECT REQUEST) — THE OUTBOX IS ONLY THE
// FAILURE/OFFLINE PATH.
//
// ORDERING: OPS REPLAY STRICTLY FIFO (PER USER) BECAUSE SEQUENCE MATTERS (e.g. read→unread, THEN delete).
// CONFLICTS: THE SERVER IS THE TRUTH — ITS MONOTONIC progress MAX AND LAST-WRITE-WINS EDITS APPLY AS
// NORMAL; A QUEUED DELETE ALWAYS WINS (THE ROW IS GONE EITHER WAY). REVALIDATION (NEXT ONLINE LOAD)
// REPLACES STALE CACHES.

import { apiFetch } from '$lib/api';
import { isOnline } from '$lib/offline/network';
import { classifyOutcome } from '$lib/offline/outbox-core';
import { outboxEnqueue, outboxPending, outboxRemove, type OutboxOp } from '$lib/offline/db';

// -- TYPES -- //

export type OutboxOpName = OutboxOp['op'];

// -- STATE -- //

let flushing = false;

// -- FUNCTIONS -- //

// QUEUE A WRITE OP FOR LATER REPLAY. RETURNS true WHEN QUEUED (IndexedDB AVAILABLE); false WHEN THE
// QUEUE IS UNAVAILABLE — CALLERS THEN FALL THROUGH TO THEIR EXISTING BEST-EFFORT DIRECT WRITE.
export async function enqueueWrite(userId: string, op: OutboxOpName, payload: Record<string, unknown>): Promise<boolean> {
	const id = await outboxEnqueue({
		op,
		payload,
		userId,
		createdAt: Date.now(),
		attempts: 0,
	});
	return id !== null;
}

// REPLAY ONE QUEUED OP AGAINST THE LIVE API. THROWS ON TRANSIENT FAILURE (KEEP + RETRY); PERMANENT
// ERRORS (4xx — E.G. THE BOOK WAS DELETED ELSEWHERE) ARE DROPPED SILENTLY BY THE FLUSHER.
async function runOp(op: OutboxOp): Promise<void> {
	const p = op.payload;
	const send = async (path: string, init: RequestInit = {}) => {
		const res = await apiFetch(path, init);
		if (!res.ok) {
			// CARRY THE STATUS SO THE FLUSHER CAN DROP PERMANENT FAILURES (4xx) AND RETRY TRANSIENT ONES.
			const err = new Error(`outbox op ${op.op} failed: ${res.status}`) as Error & { status: number };
			err.status = res.status;
			throw err;
		}
		return res;
	};
	switch (op.op) {
		case 'progress':
			await send(`/api/chapters/${encodeURIComponent(String(p.uuid))}/progress`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ progress: p.progress }),
			});
			break;
		case 'read':
			await send(`/api/books/${encodeURIComponent(String(p.bookId))}/read`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uuid: p.uuid, scope: p.scope ?? 'this', read: p.read }),
			});
			break;
		case 'resume':
			// THE SERVER MOVES THE BOOK'S RESUME POINTER AS A SIDE EFFECT OF A resume=1 CHAPTER VIEW.
			await send(`/api/chapter?id=${encodeURIComponent(String(p.uuid))}&resume=1`);
			break;
		case 'bookPatch':
			await send(`/api/books/${encodeURIComponent(String(p.bookId))}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(p.patch ?? {}),
			});
			break;
		case 'bookDelete':
			await send(`/api/books/${encodeURIComponent(String(p.bookId))}`, { method: 'DELETE' });
			break;
		case 'chapterPatch':
			await send(`/api/chapters/${encodeURIComponent(String(p.uuid))}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(p.patch ?? {}),
			});
			break;
		case 'chapterDelete':
			await send(`/api/chapters/${encodeURIComponent(String(p.uuid))}`, { method: 'DELETE' });
			break;
		case 'reorder':
			await send(`/api/books/${encodeURIComponent(String(p.bookId))}/chapters`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ order: p.order ?? [] }),
			});
			break;
		case 'glossaryUpsert':
			if (p.id !== undefined && p.id !== null) {
				await send(`/api/glossary/${encodeURIComponent(String(p.id))}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(p.patch ?? {}),
				});
			} else {
				await send('/api/glossary', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(p.body ?? {}),
				});
			}
			break;
		case 'glossaryDelete':
			await send(`/api/glossary/${encodeURIComponent(String(p.id))}`, { method: 'DELETE' });
			break;
	}
}

// FLUSH THE PENDING QUEUE FOR A USER, OLDEST FIRST. STOPS AT THE FIRST TRANSIENT FAILURE (THE REST
// STAYS QUEUED FOR THE NEXT ATTEMPT). PERMANENT 4xx OPS ARE DROPPED SO THEY DON'T BLOCK THE QUEUE.
// RETURNS HOW MANY OPS WERE FLUSHED.
export async function flushOutbox(userId: string): Promise<number> {
	if (flushing) return 0;
	flushing = true;
	let flushed = 0;
	try {
		const pending = await outboxPending(userId);
		for (const op of pending) {
			// THE QUEUE ONLY REPLAYS WHEN THE NETWORK IS (BELIEVED) UP — A FAILED FETCH BELOW MARKS
			// OFFLINE VIA apiFetch, SO THE NEXT RUN PICKUP IS THE ONLINE EVENT.
			if (!isOnline()) break;
			try {
				await runOp(op);
				await outboxRemove(op.id ?? 0);
				flushed++;
			} catch (e) {
				// PERMANENT 4xx (BOOK/TERM DELETED ELSEWHERE, ETC.) → DROP IT AND KEEP FLUSHING (A DROPPED OP
				// MUST NOT BLOCK THE OPS AFTER IT — THE MODULE CONTRACT AT THE TOP OF THIS FUNCTION).
				// ANYTHING ELSE (NETWORK, 5xx, TRANSIENT 4xx) → KEEP IT AND STOP: THE NEXT ONLINE EVENT RETRIES.
				if (classifyOutcome(e) === 'drop') {
					await outboxRemove(op.id ?? 0);
					continue;
				}
				break;
			}
		}
		return flushed;
	} finally {
		flushing = false;
	}
}

// HOW MANY OPS ARE STILL WAITING (FOR AN OFFLINE INDICATOR / BADGE).
export async function pendingCount(userId: string): Promise<number> {
	const ops = await outboxPending(userId);
	return ops.length;
}
