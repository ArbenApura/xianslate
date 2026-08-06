// PURE READING-PROGRESS MATH, EXTRACTED FROM THE READER SO THE ADVANCEMENT RULES ARE UNIT-TESTABLE.
//
// THE READER'S onScroll USES THESE. THE RULES ARE THE BUG-FIX CONTRACT: THE CHAPTER IS ONLY MARKED MORE
// "READ" WHEN (a) THE SCROLL IS NOT A SYNTHETIC RESTORE EVENT, (b) THE TRANSLATION STREAM IS NOT ACTIVE
// (WHILE STREAMING THE PAGE IS SHORTER THAN IT WILL BE — SCROLLING TO THE TEMP BOTTOM MUST NOT CLAMP THE
// PROGRESS TO 100%), AND (c) THE SEEN FRACTION ACTUALLY GREW (MONOTONIC).
export function computeSeen(scrollHeight: number, scrollTop: number, clientHeight: number): number {
	return scrollHeight > 0 ? Math.min(1, (scrollTop + clientHeight) / scrollHeight) : 0;
}

export function shouldAdvanceProgress(opts: {
	restoring: boolean;
	translating: boolean;
	seen: number;
	chapterMax: number;
}): boolean {
	return !opts.restoring && !opts.translating && opts.seen > opts.chapterMax;
}
