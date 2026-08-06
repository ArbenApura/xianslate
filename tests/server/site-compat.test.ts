// REAL-WORLD SITE COMPATIBILITY TESTS — CHAPTER PAGES SAVED FROM ACTUAL CHINESE WEB-NOVEL SITES, RUN
// THROUGH THE APP'S OWN PARSER PATHS.
//
// WHY FIXTURES: THE SITES THEMSELVES ARE UNREACHABLE/ANTI-BOT FROM A CI NETWORK (probe results in
// TESTING.md), AND LIVE PAGES MOVE — SAVED SNAPSHOTS MAKE THE TESTS DETERMINISTIC. THE PROSE IS TRIMMED TO
// A FEW HUNDRED CHARS (PARSER TESTS NEED STRUCTURE, NOT THE COPYRIGHTED NOVEL TEXT); THE GBK FIXTURE IS A
// RAW BYTE SLICE SO THE CHARSET DECODER GETS REAL NON-UTF-8 BYTES.
//
// COMPATIBILITY CONTRACT: A SITE IS "COMPATIBLE" WHEN BOTH (a) THE AI-LEARNED MAP PATH (applyAdapter) AND
// (b) THE ZERO-COST FALLBACK (findBestContentHtml + extractProse) extract a real title + ≥ MIN_BODY_CHARS
// of prose. A JS-RENDERED SPA SHELL (js-shell.html) MUST FAIL BOTH — THAT IS WHAT ROUTES THE PAGE TO THE
// AI LEARNER INSTEAD OF SHIPPING GARBAGE TO THE READER.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { applyAdapter, findBestContentHtml, extractProse, MIN_BODY_CHARS, type SelectorMap } from '$lib/server/site-parser';
import { decodeTextBytes } from '$lib/server/charset';

const page = (name: string): string =>
	readFileSync(fileURLToPath(new URL(`../fixtures/pages/${name}`, import.meta.url)), 'utf8');

const gbkBytes = (): Uint8Array =>
	new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/pages/shubaow-gbk-slice.bin', import.meta.url))));

// THE REAL MAP THE AI LEARNED FOR QIMAO (PERSISTED IN site_adapters DURING PRODUCTION — THE SAME SHAPE
// applyAdapter CONSUMES AFTER A LEARN).
const QIMAO_MAP: SelectorMap = {
	title: 'h2.chapter-title',
	body: 'div.article',
	bookTitle: 'span.title',
	next: { sel: 'a.next', text: ['下一章'] },
};

const SHUBAOW_MAP: SelectorMap = {
	title: 'h1',
	body: '#content',
	next: { sel: 'a[href^="/book/"]' },
};

// JAPANESE SITES — THE SELECTORS THE APP'S AI LEARNS FOR EACH (VERIFIED AGAINST LIVE PAGES):
// syosetu (小説家になろう): h1.p-novel__title / div.js-novel-text / a[rel=next]
// kakuyomu (カクヨム):      .widget-episodeTitle / div.widget-episodeBody / the "次のエピソード" anchor
const SYOSETU_MAP: SelectorMap = {
	title: 'h1.p-novel__title',
	body: 'div.js-novel-text',
	next: { sel: 'a[rel=next]' },
};

const KAKUYOMU_MAP: SelectorMap = {
	title: '.widget-episodeTitle',
	body: 'div.widget-episodeBody',
	next: { text: ['次のエピソード'] },
};

describe('site compatibility — qimao.com (SSR, UTF-8)', () => {
	it('applyAdapter with the learned map extracts title, body, and the next chapter link', () => {
		const root = parse(page('qimao-chapter.html'));
		const parsed = applyAdapter(root, '', QIMAO_MAP, 'https://www.qimao.com/shuku/2021524-17498700030001/');
		expect(parsed).not.toBeNull();
		expect(parsed!.titleSource).toContain('他是人还是诡异');
		expect(parsed!.contentSource.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
		expect(parsed!.nextUrl).toMatch(/^https:\/\/www\.qimao\.com\/shuku\/\d+-/);
	});

	it('the zero-cost fallback also extracts real prose (no AI needed)', () => {
		const root = parse(page('qimao-chapter.html'));
		const candidate = findBestContentHtml(root);
		expect(candidate).not.toBeNull();
		expect(extractProse(candidate!).length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
	});
});

describe('site compatibility — shubaow.net (SSR, GBK-encoded)', () => {
	it('applyAdapter with a plain h1/#content map extracts title + body', () => {
		const root = parse(page('shubaow-chapter.html'));
		const parsed = applyAdapter(root, '', SHUBAOW_MAP, 'https://www.shubaow.net/book/422/65192.html');
		expect(parsed).not.toBeNull();
		expect(parsed!.titleSource).toContain('宣姬戚容');
		expect(parsed!.contentSource.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
	});

	it('the zero-cost fallback extracts real prose', () => {
		const root = parse(page('shubaow-chapter.html'));
		const candidate = findBestContentHtml(root);
		expect(candidate).not.toBeNull();
		expect(extractProse(candidate!).length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
	});

	it('decodeTextBytes decodes the raw GBK bytes correctly (mojibake guard)', () => {
		const decoded = decodeTextBytes(gbkBytes(), true, ['zh-CN']);
		expect(decoded).toContain('第247章');
		// NO U+FFFD REPLACEMENT CHARS — THE SIGNATURE OF A WRONG DECODE
		expect(decoded).not.toContain('\uFFFD');
	});
});

describe('site compatibility — syosetu.com (JP, 小説家になろう)', () => {
	it('applyAdapter with the learned map extracts the episode title, prose, and next-chapter link', () => {
		const root = parse(page('syosetu-chapter.html'));
		const parsed = applyAdapter(root, '', SYOSETU_MAP, 'https://ncode.syosetu.com/n2267be/1/');
		expect(parsed).not.toBeNull();
		expect(parsed!.titleSource).toContain('プロローグ');
		expect(parsed!.contentSource.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
		expect(parsed!.nextUrl).toBe('https://ncode.syosetu.com/n2267be/2/');
	});

	it('the zero-cost fallback extracts real prose (no AI needed)', () => {
		const root = parse(page('syosetu-chapter.html'));
		const candidate = findBestContentHtml(root);
		expect(candidate).not.toBeNull();
		expect(extractProse(candidate!).length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
	});
});

describe('site compatibility — kakuyomu.jp (JP, カクヨム)', () => {
	it('applyAdapter extracts the EPISODE title (not the book h1), prose, and the 次のエピソード link', () => {
		const root = parse(page('kakuyomu-chapter.html'));
		const parsed = applyAdapter(root, '', KAKUYOMU_MAP, 'https://kakuyomu.jp/works/16816927861337057957/episodes/16817330655646256273');
		expect(parsed).not.toBeNull();
		// KAKUYOMU's <h1> IS THE BOOK TITLE — THE EPISODE TITLE LIVES IN .widget-episodeTitle
		expect(parsed!.titleSource).toContain('Web版と書籍版');
		expect(parsed!.titleSource).not.toContain('山暮らし');
		expect(parsed!.contentSource.length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
		// THE NEXT LINK IS THE "次のエピソード" ANCHOR — NOT THE TWITTER SHARE BUTTON (WHOSE URL CONTAINS
		// "episodes" AND WOULD MATCH A NAIVE a[href*=episodes] RULE — THE TEXT-BASED RULE MUST WIN).
		expect(parsed!.nextUrl).toMatch(/kakuyomu\.jp\/works\/\d+\/episodes\/\d+$/);
	});

	it('the zero-cost fallback extracts real prose', () => {
		const root = parse(page('kakuyomu-chapter.html'));
		const candidate = findBestContentHtml(root);
		expect(candidate).not.toBeNull();
		expect(extractProse(candidate!).length).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
	});
});

describe('incompatible pages — JS-rendered SPA shells', () => {
	it('a shell page yields no content candidate and no prose (routes to the AI learner)', () => {
		const root = parse(page('js-shell.html'));
		expect(findBestContentHtml(root)).toBeNull();
		expect(extractProse(root.toString()).length).toBeLessThan(MIN_BODY_CHARS);
	});
});
