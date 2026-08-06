// READER-PROGRESS MATH TESTS — THE BUG-FIX CONTRACT (DON'T MARK "READ" WHILE STREAMING / RESTORING).
import { describe, expect, it } from 'vitest';
import { computeSeen, shouldAdvanceProgress } from '$lib/reader-progress';

describe('computeSeen', () => {
	it('is the fraction from the top of the chapter to the viewport bottom, clamped to 1', () => {
		expect(computeSeen(1000, 0, 500)).toBeCloseTo(0.5, 9);
		expect(computeSeen(1000, 500, 500)).toBe(1); // AT THE REAL END
		expect(computeSeen(1000, 999, 500)).toBe(1); // CLAMPED
	});

	it('returns 0 for an empty/zero-height chapter', () => {
		expect(computeSeen(0, 10, 500)).toBe(0);
	});

	it('a chapter that fits one screen is immediately seen as 1', () => {
		expect(computeSeen(400, 0, 500)).toBe(1);
	});
});

describe('shouldAdvanceProgress — the streaming/restore guard', () => {
	const base = { restoring: false, translating: false, seen: 0.5, chapterMax: 0.3 };

	it('advances when a normal scroll grew the seen fraction', () => {
		expect(shouldAdvanceProgress(base)).toBe(true);
	});

	it('does NOT advance while the translation stream is active (the P1 fix)', () => {
		expect(shouldAdvanceProgress({ ...base, translating: true })).toBe(false);
	});

	it('does NOT advance while restoring a saved scroll position', () => {
		expect(shouldAdvanceProgress({ ...base, restoring: true })).toBe(false);
	});

	it('never goes backwards (monotonic — seen must exceed the max)', () => {
		expect(shouldAdvanceProgress({ ...base, seen: 0.2, chapterMax: 0.5 })).toBe(false);
		expect(shouldAdvanceProgress({ ...base, seen: 0.5, chapterMax: 0.5 })).toBe(false);
	});
});
