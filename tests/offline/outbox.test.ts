// FLUSH-OUTBOX TESTS — THE P1 REPLAY LOOP ITSELF (drop-and-continue, transient-stop, offline-bail,
// success-removal, reentrancy). THE CLASSIFIER IS TESTED ELSEWHERE (outbox-core.test.ts); THIS SUITE PINS
// THE ORCHESTRATION: A PERMANENT 4xx MUST NOT BLOCK THE OPS AFTER IT, A TRANSIENT FAILURE MUST STOP AND
// KEEP EVERYTHING QUEUED, AND AN OFFLINE START MUST NOT TOUCH THE NETWORK.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { online } from '$lib/offline/network';

// apiFetch IS THE ONLY NETWORK SEAM — MOCKED; EVERYTHING ELSE (db, classifyOutcome, network store) IS REAL.
const apiFetch = vi.fn();
vi.mock('$lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { flushOutbox, pendingCount } from '$lib/offline/outbox';
import { outboxEnqueue, outboxPending, _closeForTests, type OutboxOp } from '$lib/offline/db';

async function wipeDb(): Promise<void> {
	_closeForTests();
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase('xianslate');
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}

function op(partial: Partial<OutboxOp>): OutboxOp {
	return { op: 'progress', payload: { uuid: 'c1', progress: 0.5 }, userId: 'u1', createdAt: Date.now(), attempts: 0, ...partial };
}

beforeEach(async () => {
	await wipeDb();
	apiFetch.mockReset();
	online.set(true);
});

describe('flushOutbox — success', () => {
	it('replays every pending op FIFO and removes them', async () => {
		apiFetch.mockResolvedValue({ ok: true, status: 200 });
		await outboxEnqueue(op({ payload: { uuid: 'c1', progress: 0.5 } }));
		await outboxEnqueue(op({ payload: { uuid: 'c2', progress: 0.8 } }));

		expect(await flushOutbox('u1')).toBe(2);
		expect(await pendingCount('u1')).toBe(0);
		// OLDEST FIRST: c1 BEFORE c2
		expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
			'/api/chapters/c1/progress',
			'/api/chapters/c2/progress',
		]);
		expect(apiFetch.mock.calls.every((c) => c[1]?.method === 'POST')).toBe(true);
	});
});

describe('flushOutbox — drop-and-continue (the P1 fix)', () => {
	it('a permanent 4xx op is dropped WITHOUT blocking the ops after it', async () => {
		apiFetch.mockImplementation(async (path: string) =>
			path.startsWith('/api/books/') ? { ok: false, status: 404 } : { ok: true, status: 200 },
		);
		await outboxEnqueue(op({ op: 'bookPatch', payload: { bookId: 'b1', patch: { title: 'X' } } }));
		await outboxEnqueue(op({ payload: { uuid: 'c2', progress: 0.9 } }));

		expect(await flushOutbox('u1')).toBe(1);
		// THE DROPPED OP IS GONE; THE SUCCESSFUL ONE RAN; NOTHING STUCK.
		expect(await pendingCount('u1')).toBe(0);
		expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/books/b1'), expect.anything());
		expect(apiFetch).toHaveBeenCalledWith('/api/chapters/c2/progress', expect.anything());
	});
});

describe('flushOutbox — transient stop', () => {
	it('a 5xx keeps the failing op AND everything after it queued', async () => {
		apiFetch.mockResolvedValue({ ok: false, status: 503 });
		await outboxEnqueue(op({ payload: { uuid: 'c1', progress: 0.5 } }));
		await outboxEnqueue(op({ payload: { uuid: 'c2', progress: 0.9 } }));

		expect(await flushOutbox('u1')).toBe(0);
		expect(await pendingCount('u1')).toBe(2); // NOTHING LOST — RETRIES NEXT TIME
		// ONLY THE FIRST OP WAS ATTEMPTED (STOP AT FIRST TRANSIENT FAILURE)
		expect(apiFetch).toHaveBeenCalledTimes(1);
	});

	it('a transient 429 also stops and keeps the queue (classifier agrees)', async () => {
		apiFetch.mockResolvedValue({ ok: false, status: 429 });
		await outboxEnqueue(op({}));
		expect(await flushOutbox('u1')).toBe(0);
		expect(await pendingCount('u1')).toBe(1);
	});

	it('recovers on a later flush once the server is reachable again (after the backoff window)', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			apiFetch.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, status: 200 });
			await outboxEnqueue(op({}));
			expect(await flushOutbox('u1')).toBe(0);
			expect(await pendingCount('u1')).toBe(1);
			// WITHIN THE BACKOFF WINDOW THE QUEUE HOLDS (NO REPLAY — SEE RETRY_BACKOFF_MS)…
			expect(await flushOutbox('u1')).toBe(0);
			expect(apiFetch).toHaveBeenCalledTimes(1);
			// …ONCE THE WINDOW ELAPSES THE OP IS REPLAYED AND SUCCEEDS.
			vi.setSystemTime(Date.now() + 61_000);
			expect(await flushOutbox('u1')).toBe(1);
			expect(await pendingCount('u1')).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('flushOutbox — transient backoff', () => {
	it('a transiently-failed op is not replayed within the backoff window, then retries after it', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
			await outboxEnqueue(op({}));
			expect(await flushOutbox('u1')).toBe(0);
			// THE FAILURE IS REMEMBERED (attempts/lastAttemptAt) — THE OP IS NEVER DROPPED.
			expect((await outboxPending('u1'))[0]).toMatchObject({ attempts: 1 });
			// A RE-FLUSH WITHIN THE WINDOW MAKES NO NETWORK CALL (BACKOFF HOLDS).
			expect(await flushOutbox('u1')).toBe(0);
			expect(apiFetch).toHaveBeenCalledTimes(1);
			// AFTER THE WINDOW ELAPSES, THE OP IS REPLAYED AND FLUSHED.
			vi.setSystemTime(Date.now() + 61_000);
			apiFetch.mockResolvedValue({ ok: true, status: 200 });
			expect(await flushOutbox('u1')).toBe(1);
			expect(await pendingCount('u1')).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('flushOutbox — offline bail', () => {
	it('returns 0 and touches no network when offline', async () => {
		online.set(false);
		await outboxEnqueue(op({}));
		expect(await flushOutbox('u1')).toBe(0);
		expect(apiFetch).not.toHaveBeenCalled();
		expect(await pendingCount('u1')).toBe(1);
	});

	it('a network-type throw (no status) marks the queue for later and keeps ops', async () => {
		apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
		await outboxEnqueue(op({}));
		expect(await flushOutbox('u1')).toBe(0);
		expect(await pendingCount('u1')).toBe(1);
	});
});

describe('flushOutbox — reentrancy', () => {
	it('a second concurrent flush returns 0 without touching the queue', async () => {
		apiFetch.mockResolvedValue({ ok: true, status: 200 });
		await outboxEnqueue(op({}));
		const [a, b] = await Promise.all([flushOutbox('u1'), flushOutbox('u1')]);
		expect(a + b).toBe(1); // EXACTLY ONE FLUSH RAN
		expect(await pendingCount('u1')).toBe(0);
	});
});
