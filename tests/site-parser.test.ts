// UNIT TESTS FOR THE PURE PARSING ENGINE (src/lib/server/site-parser.ts) — RUN WITH `node --test`.
// THE MODULE IS FRAMEWORK-FREE (ONLY node-html-parser; NO DB / $env / DEEPSEEK), SO THE REAL ENGINE IS
// EXERCISED DIRECTLY — SAME HARNESS THE OUTBOX TESTS USE.
//
// REGRESSION: THE AI-LEARNED TITLE SELECTOR "a" RESOLVED THE *FIRST* ANCHOR ON THE PAGE — THE HEADER
// "返回" BACK BUTTON — MAKING "返回" THE CHAPTER/BOOK TITLE (AND "I'll translate the title once you
// provide it." THE TRANSLATED TITLE). THESE TESTS PIN THE THREE LAYERS OF THE FIX:
//   1. BARE-TAG TITLE SELECTORS (a/div/span/…) ARE REJECTED OUTRIGHT.
//   2. A TITLE WHOSE TEXT IS EXACTLY A NAV LABEL (返回 / back / …) IS REJECTED EVEN WITH A SPECIFIC SELECTOR.
//   3. REAL HEADINGS (INCLUDING ONES CONTAINING nav WORDS) STILL PARSE, AND 返回-LABELED LINKS ARE NAV.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { applyAdapter, fallbackNav } from '$lib/server/site-parser';

// A CHAPTER PAGE WHOSE FIRST ANCHOR IS THE "返回" BACK BUTTON — THE EXACT SCENARIO THAT PRODUCED THE BUG.
const PROSE = '字'.repeat(400);
const backButtonHtml = `<html><body>
<a href="/">返回</a>
<header><h1>第一章 起点</h1></header>
<article><p>${PROSE}</p></article>
</body></html>`;

// -- LAYER 1: BARE-TAG TITLE SELECTORS -- //

test('applyAdapter: a bare-tag title selector ("a") is rejected, never resolved to the first anchor', () => {
	const root = parse(backButtonHtml);
	// title: "a" WOULD RESOLVE THE HEADER 返回 LINK — TITLE_BAD MUST KILL IT SO THE MAP IS NEVER PERSISTED.
	const m = { title: 'a', body: 'article' };
	assert.equal(applyAdapter(root, backButtonHtml, m, 'https://example.com/1.html'), null);
});

test('applyAdapter: other bare chrome tags are rejected as title selectors too', () => {
	const root = parse(backButtonHtml);
	for (const tag of ['div', 'span', 'li', 'button', 'p', 'header']) {
		assert.equal(applyAdapter(root, backButtonHtml, { title: tag, body: 'article' }, 'https://example.com/1.html'), null, `bare ${tag} title selector must be rejected`);
	}
});

test('applyAdapter: a specific title selector (a.novel-title / #title) still works', () => {
	const html = `<html><body><header><h1 id="title">第一章 起点</h1></header><article><p>${PROSE}</p></article></body></html>`;
	const root = parse(html);
	const parsed = applyAdapter(root, html, { title: '#title', body: 'article' }, 'https://example.com/1.html');
	assert.ok(parsed);
	assert.equal(parsed.titleSource, '第一章 起点');
});

// -- LAYER 2: NAV-LABEL TITLES -- //

test('applyAdapter: a specific selector that resolves a nav label (返回) is rejected', () => {
	const root = parse(backButtonHtml);
	// a.back IS SPECIFIC (PASSES LAYER 1) BUT RESOLVES THE BACK BUTTON — THE NAV_LINE TITLE GUARD MUST CATCH IT.
	const m = { title: 'a.back', body: 'article' };
	assert.equal(applyAdapter(root, backButtonHtml, m, 'https://example.com/1.html'), null);
});

test('applyAdapter: a real heading still parses when the first anchor is a back button', () => {
	const root = parse(backButtonHtml);
	const m = { title: 'header h1', body: 'article' };
	const parsed = applyAdapter(root, backButtonHtml, m, 'https://example.com/1.html');
	assert.ok(parsed);
	assert.equal(parsed.titleSource, '第一章 起点');
});

test('applyAdapter: a title containing a nav word is not rejected (anchored guard only)', () => {
	const html = `<html><body><header><h1>The Next Chapter</h1></header><article><p>${'x'.repeat(400)}</p></article></body></html>`;
	const root = parse(html);
	const parsed = applyAdapter(root, html, { title: 'header h1', body: 'article' }, 'https://example.com/1.html');
	assert.ok(parsed);
	assert.equal(parsed.titleSource, 'The Next Chapter');
});

// -- LAYER 3: 返回/后退 ARE RECOGNISED NAVIGATION LABELS -- //

test('fallbackNav: an anchor labelled 返回 is a prev link', () => {
	const html = `<html><body><a href="/0.html">返回</a><h1>第二章</h1><p>${PROSE}</p></body></html>`;
	const root = parse(html);
	assert.equal(fallbackNav(root, 'https://example.com/1.html', 'prev'), 'https://example.com/0.html');
});

test('fallbackNav: an anchor labelled 后退 is a prev link', () => {
	const html = `<html><body><a href="/0.html">后退</a><h1>第二章</h1><p>${PROSE}</p></body></html>`;
	const root = parse(html);
	assert.equal(fallbackNav(root, 'https://example.com/1.html', 'prev'), 'https://example.com/0.html');
});
