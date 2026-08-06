// UNIT TESTS FOR THE PURE OFFLINE LOGIC (src/lib/offline/outbox-core.ts) — RUN WITH `node --test`.
// NO FRAMEWORK, NO IndexedDB, NO NETWORK: THE IO-BOUND HALVES (db.ts/outbox.ts/sync.ts) ARE BROWSER-ONLY
// AND ARE COVERED BY THE EMULATOR MATRIX; THIS SUITE PINS DOWN THE DECISION LOGIC THAT MUST NOT DRIFT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyOutcome,
	mergeOfflineRows,
	filterOfflineRows,
	pageOfflineRows,
} from '../src/lib/offline/outbox-core.ts';

// -- classifyOutcome -- //

test('classifyOutcome: a permanent 4xx status is dropped', () => {
	const err = new Error('gone') as Error & { status: number };
	err.status = 404;
	assert.equal(classifyOutcome(err), 'drop');
	err.status = 409;
	assert.equal(classifyOutcome(err), 'drop');
	err.status = 410;
	assert.equal(classifyOutcome(err), 'drop');
	err.status = 422;
	assert.equal(classifyOutcome(err), 'drop');
});

test('classifyOutcome: transient 4xx statuses (401/408/425/429) are retried, not dropped', () => {
	// DROPPING THESE WOULD SILENTLY LOSE QUEUED OFFLINE WRITES — e.g. THE BOOT FLUSH HITTING 401 BEFORE THE
	// FIREBASE SESSION RESTORE FINISHES (authHeaders() HAS NO BEARER YET), OR 429 RATE LIMITS.
	for (const s of [401, 408, 425, 429]) {
		const err = new Error(`status ${s}`) as Error & { status: number };
		err.status = s;
		assert.equal(classifyOutcome(err), 'retry', `${s} must retry`);
	}
});

test('classifyOutcome: a network-type throw (no status) retries', () => {
	assert.equal(classifyOutcome(new TypeError('Failed to fetch')), 'retry');
	assert.equal(classifyOutcome(new Error('DNS error')), 'retry');
	assert.equal(classifyOutcome(undefined), 'retry');
	assert.equal(classifyOutcome('string error'), 'retry');
});

test('classifyOutcome: a 5xx status retries (server hiccup, not permanent)', () => {
	const err = new Error('boom') as Error & { status: number };
	err.status = 500;
	assert.equal(classifyOutcome(err), 'retry');
	err.status = 503;
	assert.equal(classifyOutcome(err), 'retry');
});

// -- mergeOfflineRows -- //

test('mergeOfflineRows: incoming rows replace same-id rows and keep others', () => {
	const existing = [
		{ id: 1, source: 'a' },
		{ id: 2, source: 'b' },
	];
	const incoming = [
		{ id: 2, source: 'b2' },
		{ id: 3, source: 'c' },
	];
	const merged = mergeOfflineRows(existing, incoming, 100);
	assert.equal(merged.length, 3);
	assert.equal(merged.find((r) => r.id === 2)?.source, 'b2');
	assert.equal(merged.find((r) => r.id === 1)?.source, 'a');
});

test('mergeOfflineRows: the window is capped at max', () => {
	const existing = Array.from({ length: 10 }, (_, i) => ({ id: i, source: `s${i}` }));
	const incoming = Array.from({ length: 10 }, (_, i) => ({ id: i + 10, source: `s${i + 10}` }));
	assert.equal(mergeOfflineRows(existing, incoming, 5).length, 5);
});

test('mergeOfflineRows: dedupes identical ids from existing', () => {
	const existing = [
		{ id: 1, source: 'a' },
		{ id: 1, source: 'a2' },
	];
	const merged = mergeOfflineRows(existing, [], 10);
	assert.equal(merged.length, 1);
});

// -- filterOfflineRows -- //

test('filterOfflineRows: empty query returns everything', () => {
	const rows = [
		{ source: 'Alpha', target: '甲' },
		{ source: 'Beta', target: '乙' },
	];
	assert.equal(filterOfflineRows(rows, '').length, 2);
	assert.equal(filterOfflineRows(rows, '   ').length, 2);
});

test('filterOfflineRows: matches source OR target, case-insensitive', () => {
	const rows = [
		{ source: 'Alpha', target: '甲' },
		{ source: 'Beta', target: '乙' },
	];
	assert.deepEqual(filterOfflineRows(rows, 'alpha').map((r) => r.source), ['Alpha']);
	assert.deepEqual(filterOfflineRows(rows, '乙').map((r) => r.source), ['Beta']);
	assert.equal(filterOfflineRows(rows, 'nope').length, 0);
});

// -- pageOfflineRows -- //

test('pageOfflineRows: 1-based pagination slices like the server', () => {
	const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
	assert.equal(pageOfflineRows(rows, 1, 10).length, 10);
	assert.equal(pageOfflineRows(rows, 2, 10)[0].id, 10);
	assert.equal(pageOfflineRows(rows, 3, 10).length, 5);
	assert.equal(pageOfflineRows(rows, 99, 10).length, 0);
});
