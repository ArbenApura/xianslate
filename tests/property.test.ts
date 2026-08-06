// PROPERTY TESTS — fast-check INVARIANTS OVER THE CORE DECISION FUNCTIONS.
//
// THESE ARE THE "HOLDS FOR EVERY INPUT" GUARANTEES: THE OUTBOX CLASSIFIER IS TOTAL, THE MERGE NEVER LOSES
// ROWS OR EXCEEDS ITS WINDOW, THE UTC BUDGET WINDOW IS A TRUE DAY PARTITION, THE READER'S SEEN FRACTION IS
// A PROPER 0..1 MONOTONIC VALUE, AND sanitizeMap IS A FIXPOINT (SAFE TO RUN TWICE).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyOutcome, mergeOfflineRows } from '$lib/offline/outbox-core';
import { utcDayStart, utcNextMidnight } from '$lib/server/spend-guard';
import { computeSeen } from '$lib/reader-progress';
import { sanitizeMap } from '$lib/server/site-parser';

const errWith = (status: number) => Object.assign(new Error('x'), { status });

describe('classifyOutcome — totality + permanence invariants', () => {
	it('maps EVERY http status to one of the three outcomes', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 599 }), (status) => {
				const outcome = classifyOutcome(errWith(status));
				expect(['success', 'retry', 'drop']).toContain(outcome);
			}),
		);
	});

	it('never drops a 5xx (server errors are transient)', () => {
		fc.assert(
			fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
				expect(classifyOutcome(errWith(status))).not.toBe('drop');
			}),
		);
	});

	it('the permanent-4xx drop set is exactly the documented statuses', () => {
		// 401/408/425/429 ARE TRANSIENT (RETRY); EVERY OTHER 4xx DROPS — INCLUDING 400 (A BAD REQUEST IS
		// PERMANENT: THE ROW OR REQUEST IS MEANINGLESS NOW).
		const transient = [401, 408, 425, 429];
		const alwaysDrop = [400, 402, 403, 404, 405, 406, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 422, 423, 451];
		for (const s of alwaysDrop) expect(classifyOutcome(errWith(s))).toBe('drop');
		for (const s of transient) expect(classifyOutcome(errWith(s))).toBe('retry');
	});
});

describe('mergeOfflineRows — window invariants', () => {
	it('never exceeds the window, never duplicates ids, and never invents rows', () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { maxLength: 30 }),
				fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { maxLength: 30 }),
				fc.integer({ min: 1, max: 50 }),
				(existingIds, incomingIds, max) => {
					const existing = existingIds.map((id) => ({ id }));
					const incoming = incomingIds.map((id) => ({ id }));
					const merged = mergeOfflineRows(existing, incoming, max);
					// WINDOW RESPECTED
					expect(merged.length).toBeLessThanOrEqual(max);
					// NO DUPLICATES (SAME-ID ROWS MERGE, NEVER APPEAR TWICE)
					const ids = merged.map((r) => r.id);
					expect(new Set(ids).size).toBe(ids.length);
					// EVERY ROW CAME FROM THE INPUTS — NOTHING INVENTED
					const allowed = new Set([...existingIds, ...incomingIds]);
					for (const id of ids) expect(allowed.has(id)).toBe(true);
					// NO ROW IS EVER LOST WHEN THE WINDOW FITS EVERYTHING
					if (allowed.size <= max) {
						expect(new Set(ids).size).toBe(allowed.size);
					}
				},
			),
		);
	});
});

describe('UTC budget window — a true day partition', () => {
	it('resets exactly at the next UTC midnight, with no gap or overlap', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1_000_000_000, max: 4_100_000_000_000 }), (now) => {
				const dayStart = utcDayStart(now);
				const next = utcNextMidnight(now);
				// THE WINDOW IS EXACTLY ONE UTC DAY
				expect(next - dayStart).toBe(86_400_000);
				// ONE MS BEFORE THE BOUNDARY IS STILL TODAY; ONE MS AFTER IS THE NEXT DAY
				expect(utcDayStart(next - 1)).toBe(dayStart);
				expect(utcDayStart(next)).toBe(dayStart + 86_400_000);
				// IDEMPOTENT
				expect(utcDayStart(dayStart)).toBe(dayStart);
			}),
		);
	});
});

describe('computeSeen — proper fraction invariants', () => {
	it('is always in [0,1] and monotonic in scrollTop', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 5_000_000 }),
				fc.integer({ min: 0, max: 5_000_000 }),
				fc.integer({ min: 0, max: 5_000_000 }),
				(scrollHeight, scrollTop, clientHeight) => {
					const seen = computeSeen(scrollHeight, scrollTop, clientHeight);
					expect(seen).toBeGreaterThanOrEqual(0);
					expect(seen).toBeLessThanOrEqual(1);
					// SCROLLING DOWN NEVER DECREASES THE SEEN FRACTION
					expect(computeSeen(scrollHeight, scrollTop + 1, clientHeight)).toBeGreaterThanOrEqual(seen);
					// A ZERO-HEIGHT CHAPTER IS 0
					if (scrollHeight === 0) expect(seen).toBe(0);
				},
			),
		);
	});
});

describe('sanitizeMap — a fixpoint (safe to run twice, JSON-stable)', () => {
	it('sanitizing an already-sanitized map is a no-op', () => {
		fc.assert(
			fc.property(
				fc.record({
					title: fc.constantFrom('h1.title', 'h2.chapter-title', 'a', 'div', 'span', ''),
					body: fc.constantFrom('div.article', '#content', 'article', 'body'),
					bookTitle: fc.constantFrom('span.title', 'a.logo', 'h1', ''),
					index: fc.record({ sel: fc.string(), text: fc.array(fc.string()) }),
					next: fc.record({ sel: fc.string(), text: fc.array(fc.string()) }),
					prev: fc.record({ sel: fc.string(), text: fc.array(fc.string()) }),
					idUrlPattern: fc.string(),
				}),
				(m) => {
					const once = sanitizeMap(m);
					const twice = sanitizeMap(once);
					expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
				},
			),
		);
	});
});
