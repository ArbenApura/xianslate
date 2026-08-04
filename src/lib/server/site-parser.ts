// PURE, FRAMEWORK-FREE PARSING + AI-MAPPING LOGIC FOR SCRAPED CHAPTER PAGES.
//
// THIS MODULE HAS NO DEPENDENCY ON THE DB, $env, OR THE DEEPSEEK CLIENT — IT ONLY KNOWS HOW TO TURN
// HTML + A SelectorMap INTO A ParsedChapter, AND HOW TO DESCRIBE A PAGE TO A MODEL SO THE MODEL CAN
// PRODUCE A SelectorMap. KEEPING IT PURE LETS THE TEST HARNESS BUNDLE AND EXERCISE THE *REAL* ENGINE
// AGAINST LIVE SITES WITHOUT BOOTING SvelteKit. THE STATEFUL ORCHESTRATION (CACHE, DB, MODEL CALL,
// SELF-HEAL) LIVES IN site-adapter.ts.

// IMPORTED TYPES
import type { ParsedChapter } from '$lib/types';
// IMPORTED DEP-MODULES
import { parse, type HTMLElement } from 'node-html-parser';

// -- TYPES -- //

// A NAVIGATION LINK RULE: A CSS SELECTOR AND/OR THE VISIBLE ANCHOR LABEL(S) TO MATCH (THE TEXT FALLBACK
// SURVIVES CLASS RENAMES, WHICH IS WHY WE KEEP BOTH). `attr` NAMES WHERE THE URL LIVES WHEN IT ISN'T AN
// <a href> — A HIDDEN-INPUT `value`, A `data-*`, OR `onclick` (A URL IS PARSED OUT OF THE JS). DEFAULT href.
// THIS IS WHAT LETS THE LEARNER MAP JS-DRIVEN SPA NAVIGATION (e.g. NOVELPIA), NOT JUST ANCHOR LINKS.
export type NavRule = { sel?: string; text?: string[]; attr?: string };

// THE PERSISTED, AI-LEARNED SHAPE OF ONE SITE. SELECTORS USE node-html-parser CSS (tag/.class/#id +
// DESCENDANT COMBINATORS ONLY). title/body MAY BE COMMA-SEPARATED FALLBACK LISTS, TRIED IN ORDER.
export type SelectorMap = {
	title: string;
	body: string;
	prev?: NavRule;
	next?: NavRule;
	index?: NavRule;
	// author.sel = ELEMENT TEXT; author.scriptRegex = GROUP 1 OF A REGEX RUN OVER THE RAW HTML (LEGACY
	// SITES EMBED THE AUTHOR IN AN INLINE SCRIPT RATHER THAN VISIBLE MARKUP).
	author?: { sel?: string; scriptRegex?: string };
	// REGEX WITH TWO CAPTURE GROUPS (bookId, chapterId) MATCHED AGAINST THE CHAPTER URL.
	idUrlPattern?: string;
};

// -- CONSTANTS -- //

// A BODY SHORTER THAN THIS ISN'T A REAL CHAPTER — TREAT AS A PARSE MISS (TRIGGERS SELF-HEAL).
export const MIN_BODY_CHARS = 200;

// SIZE OF THE PAGE DIGEST FED TO THE MODEL. STRUCTURE + SHORT PREVIEWS, NOT FULL PROSE.
const DIGEST_BUDGET = 12_000;

// SELECTORS A TITLE MAY NOT BE — TOO BROAD OR THE DOCUMENT <title>.
const TITLE_BAD = new Set(['html', 'body', 'head', 'title', '*', ':root', 'main', 'article']);

// SELECTORS A BODY MAY NOT BE. NOTE body/main ARE ALLOWED: SOME SITES PUT THE PROSE LOOSE IN <body>
// WITH NO WRAPPER, AND WE EXTRACT IT VIA CHROME-STRIPPING READABILITY (SEE extractProse).
const BODY_BAD = new Set(['html', 'head', 'title', '*', ':root']);

// ELEMENTS THAT ARE NEVER STORY PROSE — REMOVED BEFORE EXTRACTION AND IGNORED AS CONTENT CANDIDATES.
const CHROME_TAGS = [
	'script',
	'style',
	'ins',
	'head',
	'title',
	'nav',
	'header',
	'footer',
	'aside',
	'form',
	'select',
	'textarea',
	'button',
	'noscript',
	'iframe',
	'svg',
];

// CONTENT-CANDIDATE TAGS TO SKIP (CHROME OR LIST CONTAINERS THAT ARE ALMOST NEVER THE PROSE BLOCK).
const SKIP_TAGS = new Set([...CHROME_TAGS, 'html', 'body', 'head', 'figure', 'ul', 'ol']);

// LABELS THAT IDENTIFY REAL CHAPTER NAVIGATION — PRIORITISED IN THE DIGEST AHEAD OF SITE-MENU LINKS,
// AND USED TO RECOGNISE MENU ITEMS THAT SHOULD NOT BE OFFERED AS TITLE CANDIDATES.
const NAV_NAV =
	/(上一[章页頁节節]|下一[章页頁节節]|前一[章页頁]|后一[章页頁]|上一篇|下一篇|返回?目[录錄]|章节?目[录錄]|返回书[页頁]|目[录錄]|前へ|次へ|目次|이전|다음|목차|prev|next|index|contents|table of contents|toc)/i;

// A SHORT STANDALONE LINE THAT IS REALLY A NAV/CONTROL LABEL, NOT PROSE — DROPPED FROM THE BODY TEXT.
// THE 소설…/커버…/로딩… ALTERNATIVES ARE KOREAN-READER CHROME (A "loading novel content" PLACEHOLDER, A
// COVER COLLAPSE/EXPAND TOGGLE, EPISODE NAV) THAT LEAK INTO THE SCRAPED BODY OF JS-RENDERED KOREAN SITES.
const NAV_LINE =
	/^(字体|大|中|小|换手|關燈|关灯|开灯|上一[章页頁节節]|下一[章页頁节節]|前一[章页頁]|后一[章页頁]|返回目[录錄]|返回書?[页頁]|返回顶部|回到顶部|目[录錄]|章节目[录錄]|存书签|加入书[签籤架]|推荐本?[书書]|收藏本?[书書]|手机阅读|手機閱讀|章节错误.*|.*点此举报.*|第\(\d+\/\d+\)页|上一篇|下一篇|prev(ious)?|next|index|contents?|table of contents|toc|報錯|报错|分享|收藏|書架|书架|目錄|繁體|簡體|简体|繁体|소설\s*내용을\s*불러오고\s*있습니다\.?|커버\s*접기|커버\s*펼치기|이전\s*화(\s*보기)?|다음\s*화(\s*보기)?|목록(\s*보기)?|목차|로딩\s*중\.*|\d{1,4}\s*\/\s*\d{1,4})$/i;

// A BODY WHOSE TEXT *STARTS* LIKE THIS IS CHROME (A NO-JS NOTICE, MENU, OR LOGIN WALL), NOT A CHAPTER.
const CHROME_START =
	/^(您的浏览器|您的瀏覽器|由于您的|請開啟|请开启|javascript|登录|登錄|注册|註冊|排行榜|首页|首頁|加入收藏|手机版|手機版)/i;

export const MAP_SYSTEM = `You are mapping a web-novel CHAPTER page so a scraper can extract it. The page may be in any language (Chinese, Japanese, Korean, English, …) — rely on STRUCTURE and the previews, not on the language. The page may be a JS-rendered SPA (e.g. a Korean reader) whose navigation isn't ordinary links.
You are given up to four lists derived from the page: TITLE CANDIDATES, CONTENT CANDIDATES (each with its text length and a short preview of its text), NAV LINKS, and — when present — NAV CONTROLS (JS/SPA navigation held in a hidden input, data-* attribute, or onclick).

Return ONLY a JSON object, no markdown and no prose:
{"title":"<css>","body":"<css>","prev":{"sel":"<css>","text":["..."],"attr":"<attr>"},"next":{"sel":"<css>","text":["..."],"attr":"<attr>"},"index":{"sel":"<css>","text":["..."],"attr":"<attr>"},"author":{"sel":"<css>"},"idUrlPattern":"<regex or empty>"}

Rules:
- Choose selectors from the candidate lists. Selectors may use ONLY tag names, .class, #id and spaces (descendant combinator). NO :pseudo-classes and NO [attribute] selectors.
- "body": choose the ONE CONTENT CANDIDATE whose preview reads as the actual chapter STORY TEXT — never a menu, sidebar, comment list, announcement, or the whole page. Prefer the TIGHTEST block that still holds the prose. A candidate marked "(loose-text fallback)" means the page puts the chapter loosely in the body with no wrapper — choose it (it will be "body") ONLY when no other candidate's preview is the story prose.
- "title": the chapter's heading from TITLE CANDIDATES — the one naming THIS chapter (often contains a chapter number/word like 第…章/章/卷/话/회/chapter), NOT the book's overall title. NEVER answer "title".
- "prev","next","index": previous-chapter, next-chapter, and table-of-contents/book-index links. Match the label in ANY language: previous = 上一章/上一頁/上一页/前一章 · 前へ/前章 · 이전/이전화 · prev/previous/back; next = 下一章/下一頁/下一页/后一章 · 次へ/次章 · 다음/다음화 · next/forward; index = 目录/目錄/章节目录/返回目录 · 目次/一覧 · 목차/목록 · index/contents/toc. From NAV LINKS, put the matched label(s) in "text"; add "sel" ONLY when a SPECIFIC selector exists — one carrying a #id or .class (e.g. "a.next"). NEVER give a bare tag like "a"/"div"/"li" as a nav "sel": it matches the FIRST such element on the page (a header link or a href="#" toggle), not the neighbour — when unsure, omit "sel" and rely on "text". "index" must be the book's table-of-contents / detail page (often the breadcrumb book-title link), NOT an in-page "#" dropdown toggle. From NAV CONTROLS (a JS/SPA site with no link for that direction), copy its selector into "sel" AND set "attr" to the named attribute (e.g. "value", "onclick", a data-* name) so the scraper reads the URL from there. OMIT any direction that is genuinely absent (e.g. no previous on chapter 1).
- "author": a TITLE CANDIDATE selector whose text is the author's name, if any; otherwise omit the field.
- "idUrlPattern": a regex with EXACTLY TWO capture groups (book id, then chapter id) matching the chapter URL, or "" if the URL has no such ids. Backslashes MUST be JSON-escaped, e.g. "novelid=(\\\\d+)&chapterid=(\\\\d+)".`;

// -- FUNCTIONS -- //

function clean(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

// SAFELY TURN A NUMERIC CODEPOINT INTO A CHAR — A MALFORMED &#1114112; (> 0x10FFFF) WOULD OTHERWISE
// THROW RangeError AND ABORT THE WHOLE PARSE; FALL BACK TO THE LITERAL ENTITY INSTEAD.
function codePointOr(cp: number, literal: string): string {
	if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return literal;
	try {
		return String.fromCodePoint(cp);
	} catch {
		return literal;
	}
}

function decodeEntities(s: string): string {
	return s.replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, (m) => {
		if (ENTITIES[m]) return ENTITIES[m];
		const dec = /^&#(\d+);$/.exec(m);
		if (dec) return codePointOr(Number(dec[1]), m);
		const hex = /^&#x([0-9a-fA-F]+);$/.exec(m);
		if (hex) return codePointOr(parseInt(hex[1], 16), m);
		return m;
	});
}

const ENTITIES: Record<string, string> = {
	'&emsp;': '　',
	'&ensp;': ' ',
	'&nbsp;': ' ',
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&apos;': "'",
	'&ldquo;': '"',
	'&rdquo;': '"',
};

// CONSTRUCTED FROM AN ESCAPE (NOT A LITERAL U+3000) TO AVOID A no-irregular-whitespace LINT ERROR.
const IDEOGRAPHIC_SPACE_RE = new RegExp('\\u3000', 'g');

// ZERO-WIDTH / INVISIBLE FORMATTING CHARS (ZWSP, ZWNJ, ZWJ, WORD-JOINER, BOM). SOME SITES PUT A ZERO-WIDTH-
// SPACE <p> SPACER BETWEEN EVERY REAL PARAGRAPH (COMMON ON KOREAN READERS); BECAUSE THESE SURVIVE .trim() THE
// SPACER BECOMES A BOGUS LENGTH-1 "PARAGRAPH" THAT DOUBLES THE PARAGRAPH COUNT AND FEEDS THE TRANSLATOR JUNK.
// BUILT FROM ESCAPES (NOT LITERAL INVISIBLE CHARS) TO AVOID A no-irregular-whitespace LINT ERROR.
const ZERO_WIDTH_RE = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'gu');

// MOST A COALESCED PARAGRAPH MAY GROW TO BEFORE WE FORCE A BREAK EVEN MID-SENTENCE — STOPS A PUNCTUATION-LESS
// PAGE FROM COLLAPSING INTO ONE GIANT BLOCK.
const MAX_COALESCED_CHARS = 2000;

// CHARACTERS THAT END A SENTENCE/PARAGRAPH ACROSS THE SCRIPTS WE SCRAPE (LATIN + CJK TERMINATORS + CLOSING
// QUOTES/BRACKETS + KOREAN TRAILING ~). A FRAGMENT NOT ENDING IN ONE WAS ALMOST CERTAINLY SPLIT MID-SENTENCE
// (A <br>-PER-LINE/PHRASE SITE) AND IS RE-JOINED TO THE NEXT BY coalesceFragments. THE CJK CURLY QUOTES
// (U+201C/D “”, U+2018/9 ‘’) AND THE FULLWIDTH TILDE (U+FF5E ～) ARE SPELLED AS \u ESCAPES — A BARE LITERAL
// HERE IS FRAGILE (AN EDITOR/FORMATTER ONCE NORMALISED THEM TO ASCII " ', WHICH SILENTLY DROPPED ” AS A
// TERMINATOR AND FORCE-MERGED EVERY DIALOGUE PARAGRAPH ON CHINESE SITES).
const SENTENCE_END = new RegExp(
	'[.!?\\u2026\\u3002\\uFF01\\uFF1F\\u2025"\\u0027\\u201C\\u201D\\u2018\\u2019\\u300D\\u300F\\uFF09\\u300B\\u3009)~\\uFF5E\\]]$',
	'u',
);

// TURN A CONTENT-ELEMENT'S innerHTML INTO CLEAN PARAGRAPH TEXT.
function htmlToParagraphs(html: string): string {
	const noScripts = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<ins[\s\S]*?<\/ins>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '');
	const withBreaks = noScripts.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d)>/gi, '\n');
	const noTags = withBreaks.replace(/<[^>]+>/g, '');
	const decoded = decodeEntities(noTags);
	return decoded
		.split('\n')
		.map((l) => l.replace(IDEOGRAPHIC_SPACE_RE, ' ').replace(ZERO_WIDTH_RE, '').trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
}

// COLLAPSE A PATHOLOGICALLY OVER-FRAGMENTED BODY INTO SANE PARAGRAPHS. (1) STRIP ZERO-WIDTH SPACER CHARS SO
// A ZERO-WIDTH-SPACE <p> SPACER STOPS COUNTING AS A PARAGRAPH; (2) RE-JOIN A FRAGMENT INTO THE PREVIOUS WHEN
// THAT PARAGRAPH DIDN'T END A SENTENCE (A MID-SENTENCE <br> SPLIT), CAPPED SO A PUNCTUATION-LESS PAGE CAN'T
// MERGE INTO ONE GIANT BLOCK. WITHOUT THIS, A SITE THAT EMITS HUNDREDS OF MICRO-PARAGRAPHS IN A SHORT
// CHAPTER OVERWHELMS THE TRANSLATOR'S 1:1 NUMBERED-TAG SCHEME (THE MODEL ABANDONS PER-TAG DISCIPLINE AND
// REPEATS WHOLE-CHAPTER PROSE UNDER MANY TAGS). EXPORTED + REUSED BY THE TRANSLATOR SO A CHAPTER STORED
// FRAGMENTED BEFORE THIS FIX STILL TRANSLATES CLEANLY ON A RE-RUN, NOT ONLY ON A FRESH FETCH.
// A SCENE-BREAK SYMBOL (▽, ◇, ◆, * * *, ---, ETC.) IS ONLY SYMBOLS — NO LETTERS — SO IT MUST NEVER BE
// TREATED AS A MID-SENTENCE FRAGMENT AND MERGED WITH THE NEXT PARAGRAPH. REQUIRE prev TO CONTAIN AT LEAST
// ONE LETTER / IDEOGRAPH (\p{L}) BEFORE COALESCING, KEEPING SYMBOL-ONLY PARAGRAPHS STANDALONE.
const HAS_LETTER = /\p{L}/u;
export function coalesceFragments(text: string): string {
	const paras = text
		.replace(ZERO_WIDTH_RE, '')
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (paras.length === 0) return '';
	const out: string[] = [];
	for (const p of paras) {
		const prev = out.length ? out[out.length - 1] : null;
		if (
			prev !== null &&
			HAS_LETTER.test(prev) &&
			!SENTENCE_END.test(prev) &&
			prev.length + 1 + p.length <= MAX_COALESCED_CHARS
		) {
			out[out.length - 1] = `${prev} ${p}`;
		} else {
			out.push(p);
		}
	}
	return out.join('\n\n');
}

// DROP SHORT PARAGRAPHS THAT ARE REALLY NAV/CONTROL LABELS (字体/上一章/第(1/3)页/…) — THE LAST LINE OF
// DEFENCE WHEN A CHOSEN CONTAINER STILL CARRIES A CONTROL BAR. LONG PROSE IS ALWAYS KEPT.
function filterChromeLines(text: string): string {
	return text
		.split('\n\n')
		.filter((p) => {
			const c = clean(p);
			if (!c) return false;
			if (c.length <= 36 && NAV_LINE.test(c)) return false;
			return true;
		})
		.join('\n\n');
}

// NORMALISE ALREADY-EXTRACTED BODY TEXT: DROP CONTROL-LABEL LINES, THEN COALESCE FRAGMENTS. SHARED BY THE
// SCRAPER (ON FRESH HTML) *AND* THE TRANSLATOR (ON STORED contentSource) SO A CHAPTER SAVED FRAGMENTED OR
// WITH LEAKED CHROME BEFORE THIS FIX SELF-HEALS ON A RE-TRANSLATE — NO RE-FETCH NEEDED.
export function normalizeBodyText(text: string): string {
	return coalesceFragments(filterChromeLines(text));
}

// READABILITY EXTRACTION: RE-PARSE AN HTML FRAGMENT (SO WE NEVER MUTATE THE SHARED TREE), STRIP CHROME
// ELEMENTS AND LINK-DENSE CONTROL BLOCKS, THEN FLATTEN TO PARAGRAPHS. WORKS FOR BOTH A WRAPPED CONTENT
// DIV *AND* A WHOLE-PAGE/<body> SCOPE WHERE THE PROSE SITS LOOSE BETWEEN NAV BARS.
export function extractProse(fragmentHtml: string): string {
	const scope = parse(fragmentHtml);
	for (const tag of CHROME_TAGS) for (const el of scope.querySelectorAll(tag)) el.remove();
	// REMOVE SMALL, LINK-DENSE BLOCKS (MENUS / NAV BARS / TOOLBARS).
	for (const el of scope.querySelectorAll('div,p,span,table,ul,ol,center,dl,h1,h2,h3,h4')) {
		const t = clean(el.text);
		if (!t) continue;
		let linkLen = 0;
		for (const a of el.querySelectorAll('a')) linkLen += clean(a.text).length;
		if (t.length <= 240 && linkLen / t.length > 0.4) el.remove();
	}
	return normalizeBodyText(htmlToParagraphs(scope.innerHTML));
}

export function abs(href: string | undefined | null, base: string): string | null {
	if (!href) return null;
	try {
		return new URL(href, base).href;
	} catch {
		return null;
	}
}

// title/body MAY BE A COMMA-SEPARATED FALLBACK LIST — TRY EACH IN ORDER, FIRST MATCH WINS.
function splitSel(sel: string): string[] {
	return sel
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function allParts(sel: string, bad: Set<string>): boolean {
	const parts = splitSel(sel);
	return parts.length === 0 || parts.every((p) => bad.has(p.toLowerCase()));
}

function isLooseBody(sel: string): boolean {
	return splitSel(sel).some((p) => ['body', 'html', 'main'].includes(p.toLowerCase()));
}

function pickEl(root: HTMLElement, sel: string): HTMLElement | null {
	for (const part of splitSel(sel)) {
		try {
			const el = root.querySelector(part);
			if (el) return el;
		} catch {
			// AN INVALID SELECTOR (e.g. AN ATTRIBUTE SELECTOR node-html-parser CAN'T PARSE) → SKIP IT.
		}
	}
	return null;
}

function pickText(root: HTMLElement, sel: string): string {
	for (const part of splitSel(sel)) {
		try {
			const t = root.querySelector(part)?.text?.trim();
			if (t) return t;
		} catch {
			// IGNORE AN UNPARSEABLE SELECTOR PART.
		}
	}
	return '';
}

// A QUOTED http(s) URL OR ABSOLUTE /path EMBEDDED IN A JS HANDLER (e.g. onclick="pageload('/viewer/123',1)").
const ONCLICK_URL = /['"]((?:https?:\/\/|\/)[^'"]+)['"]/;

// SAFE NAV-URL ATTRIBUTE NAMES THE MODEL MAY NAME ON A NavRule (BEYOND THE DEFAULT href): A HIDDEN-INPUT
// value, A src, ANY data-*, OR onclick (A URL IS PARSED OUT OF THE JS). ANYTHING ELSE FALLS BACK TO href.
const SAFE_ATTR = /^(?:href|value|src|onclick|data-[\w-]+)$/i;

// READ A URL OFF AN ELEMENT VIA A NAMED ATTRIBUTE — onclick IS PARSED FOR AN EMBEDDED PATH/URL.
function attrUrl(el: HTMLElement, attr: string): string | null {
	if (attr.toLowerCase() === 'onclick') return el.getAttribute('onclick')?.match(ONCLICK_URL)?.[1] ?? null;
	return el.getAttribute(attr) ?? null;
}

// A RESOLVED NAV CANDIDATE MUST POINT AT A REAL NEIGHBOUR PAGE. STRIP ANY #fragment (NAV TARGETS ARE PAGES,
// NOT IN-PAGE ANCHORS) AND REJECT A NON-PAGE (javascript:/mailto:/tel:) OR A LINK BACK TO THIS PAGE ITSELF
// (href="#", "?", OR THE SAME path+query) — e.g. jjwxc'S "目录" DROPDOWN IS A href="#oneboolt" TOGGLE, NOT A
// CHAPTER. WITHOUT THIS, A NAV rule THAT RESOLVES TO SUCH A TOGGLE POISONS indexUrl (→ THE WRONG COVER/TITLE).
function stripHash(u: string): string {
	const i = u.indexOf('#');
	return i >= 0 ? u.slice(0, i) : u;
}

function isNavTarget(u: string, base: string): boolean {
	if (/^(?:javascript:|mailto:|tel:)/i.test(u)) return false;
	try {
		const a = new URL(u);
		const b = new URL(base);
		if (a.origin === b.origin && a.pathname === b.pathname && a.search === b.search) return false;
	} catch {
		return false;
	}
	return true;
}

function resolveNav(root: HTMLElement, rule: NavRule | undefined, base: string): string | null {
	if (!rule) return null;
	// FINALISE A RAW href/attr VALUE → AN ABSOLUTE, FRAGMENT-STRIPPED NEIGHBOUR URL, OR null IF IT'S JUNK.
	const finalize = (raw: string | null | undefined): string | null => {
		const u = raw ? abs(raw, base) : null;
		if (!u) return null;
		const clean = stripHash(u);
		return isNavTarget(clean, base) ? clean : null;
	};
	if (rule.sel) {
		// HONOUR rule.attr (value / data-* / onclick) FOR JS-SPA NAV THAT ISN'T AN <a href>; DEFAULT TO href.
		const attr = rule.attr && SAFE_ATTR.test(rule.attr) ? rule.attr : 'href';
		for (const part of splitSel(rule.sel)) {
			try {
				const el = root.querySelector(part);
				const u = el ? finalize(attrUrl(el, attr)) : null;
				if (u) return u;
			} catch {
				// IGNORE AN UNPARSEABLE SELECTOR PART.
			}
		}
	}
	if (rule.text?.length) {
		// EXACT LABEL MATCH FIRST, THEN A CONTAINS MATCH (LABELS OFTEN SIT INSIDE "« 上一章" ETC). SKIP A MATCH
		// THAT RESOLVES TO JUNK (A href="#" TOGGLE) AND KEEP SCANNING FOR A REAL NEIGHBOUR LINK.
		for (const a of root.querySelectorAll('a')) {
			if (rule.text.includes(a.text.trim())) {
				const u = finalize(a.getAttribute('href'));
				if (u) return u;
			}
		}
		for (const a of root.querySelectorAll('a')) {
			const t = a.text.trim();
			if (t.length <= 20 && rule.text.some((label) => t.includes(label))) {
				const u = finalize(a.getAttribute('href'));
				if (u) return u;
			}
		}
	}
	return null;
}

// URL-BEARING ATTRIBUTES TO CHECK ON A FALLBACK NAV CANDIDATE (BEYOND href). JS-DRIVEN SPA SITES STASH THE
// NEIGHBOUR EPISODE URL IN A HIDDEN-INPUT value, A data-* ATTRIBUTE, OR AN onclick CALL — e.g. NOVELPIA'S
// <input id="next_epi_auto_url" value="/viewer/123"> AND <div onclick="pageload('/viewer/123',1)">.
const NAV_ATTRS = ['href', 'value', 'data-url', 'data-href', 'data-link', 'content'];

// DIRECTION KEYWORDS FOR id/name/class/rel HINTS. LATIN TOKENS ARE BOUNDED BY START/END OR A SEPARATOR
// (so "feedback" ISN'T A PREV AND "context" ISN'T A NEXT); CJK/KOREAN LABELS STAND ALONE.
const FALLBACK_PREV = /(?:^|[\s_\-/])(?:prev|previous|back|before)(?:[\s_\-/]|$)|上一|前一|이전/i;
const FALLBACK_NEXT = /(?:^|[\s_\-/])(?:next|forward|after)(?:[\s_\-/]|$)|下一|后一|다음/i;
const FALLBACK_INDEX = /(?:^|[\s_\-/])(?:index|contents|catalog|toc|booklist)(?:[\s_\-/]|$)|目[录錄]|목록|목차/i;

// A PATH THAT IS UNMISTAKABLY A BOOK / SERIES INDEX PAGE (NOT A CHAPTER) — RECOVERS THE INDEX LINK ON SPA
// SITES WHOSE "BACK TO BOOK" CONTROL IS A JS onclick TO THE BOOK PAGE, NOT AN <a href> (e.g. /novel/{id}).
const BOOK_PATH = /\/(?:novel|book|series|fiction|work|comic|webtoon|story|title)\/\d+/i;

// PULL THE FIRST PATH/URL OUT OF AN ELEMENT'S URL-BEARING ATTRS (INCLUDING A /path INSIDE onclick). A BARE
// NUMERIC ID (e.g. Novelpia's content_no_next="5515272") IS REJECTED — ONLY A REAL URL OR ABSOLUTE PATH WINS.
function navUrlOf(el: HTMLElement): string | null {
	for (const a of NAV_ATTRS) {
		const v = el.getAttribute(a);
		if (v && (/^https?:\/\//i.test(v) || v.startsWith('/'))) return v;
	}
	return el.getAttribute('onclick')?.match(ONCLICK_URL)?.[1] ?? null;
}

// NORMALISE A RESOLVED NEIGHBOUR URL'S TRAILING SLASH TO base's CONVENTION — A SITE WHOSE OWN LINKS OMIT THE
// SLASH (NOVELPIA: /viewer/123) MUST STILL MATCH A CHAPTER THE USER PASTED WITH ONE (/viewer/123/), OR
// Prev/Next WOULD RE-FETCH A DUPLICATE INSTEAD OF RESOLVING THE EXISTING CHAPTER.
function matchBaseSlash(u: string, base: string): string {
	try {
		const nu = new URL(u);
		const baseSlash = new URL(base).pathname.endsWith('/');
		if (baseSlash && !nu.pathname.endsWith('/')) nu.pathname += '/';
		else if (!baseSlash && nu.pathname.length > 1 && nu.pathname.endsWith('/'))
			nu.pathname = nu.pathname.slice(0, -1);
		return nu.href;
	} catch {
		return u;
	}
}

// FIND A PREV / NEXT / INDEX LINK WHEN THE LEARNED NavRule RESOLVED NOTHING — FOR JS-DRIVEN SPA SITES WHOSE
// NAVIGATION ISN'T AN <a href>. CHECKS <link rel> FIRST, THEN ANY ELEMENT WHOSE id/name/class/rel MARKS THE
// DIRECTION AND CARRIES A NEIGHBOUR URL (HIDDEN-INPUT value / data-* / onclick), THEN ANCHOR TEXT AS A
// LABEL-MATCH FALLBACK FOR TRADITIONAL SITES WHOSE LINKS CARRY NO HINT ATTRIBUTE. RETURNS null IF NONE FOUND.
export function fallbackNav(root: HTMLElement, base: string, dir: 'prev' | 'next' | 'index'): string | null {
	const want = dir === 'prev' ? FALLBACK_PREV : dir === 'next' ? FALLBACK_NEXT : FALLBACK_INDEX;
	const avoid = dir === 'prev' ? FALLBACK_NEXT : dir === 'next' ? FALLBACK_PREV : null;
	const rel = dir === 'prev' ? /^(?:prev|previous)$/i : dir === 'next' ? /^next$/i : /^(?:up|index|contents)$/i;
	// DIRECTION-SPECIFIC ANCHOR-TEXT MATCHERS (SAME MULTI-LANGUAGE SCOPE AS NAV_NAV).
	const textPrev = /^(?:前[へ章]|上一[章页頁]|前一[章页頁]|이전화?(?:\s*보기)?|prev(?:ious)?|back)$/i;
	const textNext = /^(?:次[へ章]|下一[章页頁]|后一[章页頁]|다음화?(?:\s*보기)?|next|forward)$/i;
	const textIndex = /^(?:目[次录錄]|章节目[录錄]|목[록차](?:\s*보기)?|index|contents?|toc|一覧|table of contents)$/i;
	const textWant = dir === 'prev' ? textPrev : dir === 'next' ? textNext : textIndex;
	// 1. STANDARD <link rel="next/prev/up"> IN THE HEAD.
	for (const link of root.querySelectorAll('link')) {
		if (rel.test((link.getAttribute('rel') ?? '').trim())) {
			const u = abs(link.getAttribute('href'), base);
			if (u && u !== base) return matchBaseSlash(u, base);
		}
	}
	// 2. A DIRECTION-TAGGED ELEMENT CARRYING A NEIGHBOUR URL.
	for (const el of root.querySelectorAll('a,input,div,span,button,li')) {
		const hint = `${el.getAttribute('id') ?? ''} ${el.getAttribute('name') ?? ''} ${el.getAttribute('class') ?? ''} ${el.getAttribute('rel') ?? ''}`;
		if (!want.test(hint) || (avoid && avoid.test(hint))) continue;
		const u = abs(navUrlOf(el), base);
		if (u && u !== base) return matchBaseSlash(u, base);
	}
	// 3. ANCHOR TEXT LABEL MATCH — A TRADITIONAL <a href> WHOSE VISIBLE LABEL IS A NAVIGATION WORD EVEN
	// THOUGH ITS id/class/rel CARRY NO HINT (COMMON ON SIMPLE JAPANESE NOVEL SITES LIKE syosetu).
	for (const a of root.querySelectorAll('a')) {
		const t = a.text.trim();
		if (t && t.length <= 20 && textWant.test(t)) {
			const u = abs(a.getAttribute('href'), base);
			if (u && u !== base) return matchBaseSlash(u, base);
		}
	}
	// 4. INDEX ONLY: A LINK WHOSE TARGET PATH IS UNMISTAKABLY THE BOOK'S OWN PAGE (e.g. NOVELPIA'S TITLE CLICK
	// <div onclick="pageload('/novel/419368')">), WHICH CARRIES NO index KEYWORD BUT A BOOK-PAGE URL.
	if (dir === 'index') {
		for (const el of root.querySelectorAll('a,div,span,button,li')) {
			const raw = navUrlOf(el);
			if (raw && BOOK_PATH.test(raw) && !BOOK_PATH.test(base)) {
				const u = abs(raw, base);
				if (u && u !== base) return matchBaseSlash(u, base);
			}
		}
	}
	return null;
}

// TRUE WHEN url's HOST IS (A SUBDOMAIN OF) `host` — FOR THE FEW JS-SPA HOSTS THAT NEED A TARGETED FIX-UP.
function isHost(url: string, host: string): boolean {
	try {
		const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
		return h === host || h.endsWith(`.${host}`);
	} catch {
		return false;
	}
}

// APPLY A SelectorMap TO ALREADY-PARSED HTML. RETURNS null (NOT THROWS) WHEN THE SELECTORS DON'T RESOLVE
// A REAL CHAPTER — THAT null IS THE SELF-HEAL SIGNAL. REJECTS DEGENERATE TITLES AND CHROME-ONLY BODIES.
export function applyAdapter(root: HTMLElement, html: string, m: SelectorMap, url: string): ParsedChapter | null {
	if (allParts(m.body, BODY_BAD) || allParts(m.title, TITLE_BAD)) return null;

	const title = pickText(root, m.title);
	if (!title || title.length > 200) return null;

	// RESOLVE NAV / META *BEFORE* EXTRACTION (extractProse RE-PARSES A FRAGMENT, SO root IS UNTOUCHED). FALL
	// BACK TO THE SPA HEURISTIC (HIDDEN-INPUT / data-* / onclick / <link rel>) WHEN THE LEARNED <a href> RULE
	// RESOLVES NOTHING — JS-DRIVEN SITES LIKE NOVELPIA HAVE NO ANCHOR-BASED PREV/NEXT FOR THE MODEL TO MAP.
	let prevUrl = resolveNav(root, m.prev, url) ?? fallbackNav(root, url, 'prev');
	let nextUrl = resolveNav(root, m.next, url) ?? fallbackNav(root, url, 'next');
	let indexUrl = resolveNav(root, m.index, url) ?? fallbackNav(root, url, 'index');
	if (prevUrl && indexUrl && prevUrl === indexUrl) prevUrl = null;
	if (nextUrl && indexUrl && nextUrl === indexUrl) nextUrl = null;
	if (prevUrl === url) prevUrl = null;
	if (nextUrl === url) nextUrl = null;

	// BODY: A WRAPPED ELEMENT, OR — FOR LOOSE-TEXT PAGES — THE WHOLE DOCUMENT, CHROME-STRIPPED.
	let fragment: string;
	if (isLooseBody(m.body)) {
		fragment = html;
	} else {
		const bodyEl = pickEl(root, m.body);
		if (!bodyEl) return null;
		fragment = bodyEl.innerHTML;
	}
	const contentZh = extractProse(fragment);
	if (contentZh.length < MIN_BODY_CHARS) return null;
	if (CHROME_START.test(clean(contentZh).slice(0, 24))) return null;

	let bookId: string | null = null;
	let siteChapterId: string | null = null;
	if (m.idUrlPattern) {
		try {
			const mm = new RegExp(m.idUrlPattern).exec(url);
			bookId = mm?.[1] ?? null;
			siteChapterId = mm?.[2] ?? null;
		} catch {
			// A BAD STORED PATTERN MUST NOT KILL THE PARSE — IDS ARE OPTIONAL.
		}
	}

	let author: string | null = null;
	if (m.author?.sel) author = pickText(root, m.author.sel) || null;
	else if (m.author?.scriptRegex) {
		try {
			const mm = new RegExp(m.author.scriptRegex).exec(html);
			author = mm?.[1]?.trim().replace(/^["']|["']$/g, '') || null;
		} catch {
			// IGNORE A MALFORMED STORED REGEX.
		}
	}
	// AUTHOR SHOULD BE A SHORT NAME, NOT A PARAGRAPH OR A COPY OF THE TITLE.
	if (author && (author.length > 40 || author === title || title.includes(author) || author.includes(title))) {
		author = null;
	}

	// BOOK TITLE FROM THE BREADCRUMB ANCHOR THAT LINKS TO THE INDEX (BUT ISN'T THE "目錄" LABEL ITSELF).
	let bookTitle: string | null = null;
	if (indexUrl) {
		const skip = new Set(m.index?.text ?? []);
		for (const a of root.querySelectorAll('a')) {
			const t = a.text.trim();
			if (t && t.length <= 60 && !skip.has(t) && abs(a.getAttribute('href'), url) === indexUrl) {
				bookTitle = t;
				break;
			}
		}
	}
	// NOVELPIA (JS SPA) STASHES THE INDEX + BOOK NAME WHERE NO SELECTOR/BREADCRUMB REACHES: A HIDDEN #novel_no
	// INPUT (→ /novel/{id}) AND A SITE-PREFIXED og:title. THESE TWO SIGNALS GENUINELY NEED SITE KNOWLEDGE.
	if (isHost(url, 'novelpia.com')) {
		const novelNo = root.querySelector('#novel_no')?.getAttribute('value');
		if (novelNo && /^\d+$/.test(novelNo)) indexUrl = `https://novelpia.com/novel/${novelNo}`;
		const og = (metaMap(html)['og:title'] ?? '').trim();
		const t = og.replace(/^노벨피아\s*-\s*[^-]+-\s*/, '').trim();
		if (t && t.length <= 120 && t !== og) bookTitle = t;
	}

	return {
		titleSource: title,
		contentSource: contentZh,
		siteChapterId,
		chapterUrl: url,
		prevUrl,
		nextUrl,
		indexUrl,
		bookId,
		bookTitle,
		author,
	};
}

function validIdent(s: string | undefined | null): string | null {
	if (!s) return null;
	const t = s.trim();
	return /^[A-Za-z][\w-]*$/.test(t) && t.length <= 40 ? t : null;
}

// A DISTINCTIVE SELECTOR FOR THIS ELEMENT ALONE (tag#id OR tag.class), OR null IF IT HAS NEITHER.
function ownSelector(el: HTMLElement): string | null {
	const tag = el.rawTagName?.toLowerCase();
	if (!tag) return null;
	const id = validIdent(el.getAttribute('id'));
	if (id) return `${tag}#${id}`;
	const cls = (el.getAttribute('class') ?? '')
		.split(/\s+/)
		.map((c) => validIdent(c))
		.find((c): c is string => Boolean(c));
	return cls ? `${tag}.${cls}` : null;
}

// A USABLE SELECTOR FOR AN ELEMENT: ITS OWN id/class, ELSE A DESCENDANT PATH FROM A DISTINCTIVE ANCESTOR.
function selectorFor(el: HTMLElement): string {
	const own = ownSelector(el);
	if (own) return own;
	const tag = el.rawTagName?.toLowerCase() ?? 'div';
	let cur = el.parentNode as HTMLElement | null;
	for (let i = 0; cur && i < 4; i++) {
		const anc = ownSelector(cur);
		if (anc) return `${anc} ${tag}`;
		cur = cur.parentNode as HTMLElement | null;
	}
	return tag;
}

function isDescendant(node: HTMLElement, anc: HTMLElement): boolean {
	let cur = node.parentNode as HTMLElement | null;
	while (cur) {
		if (cur === anc) return true;
		cur = cur.parentNode as HTMLElement | null;
	}
	return false;
}

// TEXT IN AN ELEMENT'S *DIRECT* CHILD TEXT NODES ONLY (NOT DESCENDANTS) — HIGH FOR A LOOSE-TEXT BODY.
function ownTextLen(el: HTMLElement): number {
	let s = 0;
	for (const n of el.childNodes) if (n.nodeType === 3) s += clean((n as { rawText?: string }).rawText ?? '').length;
	return s;
}

// DESCRIBE THE PAGE TO THE MODEL AS THREE RANKED SHORTLISTS — TITLE CANDIDATES, CONTENT CANDIDATES (BY
// TEXT DENSITY, SO THE STORY BLOCK SURFACES NO MATTER HOW FAR DOWN THE PAGE IT SITS, AND PREFERRING THE
// TIGHTEST CONTAINER), AND NAV LINKS. A SYNTHETIC "body" CANDIDATE IS ADDED FOR LOOSE-TEXT PAGES.
export function buildSkeleton(root: HTMLElement): string {
	const all = root.querySelectorAll('*');

	// SHORT ANCHOR TEXTS = SITE-MENU / NAV LABELS; USED TO KEEP MENU ITEMS OUT OF TITLE CANDIDATES.
	const navText = new Set<string>();
	for (const a of root.querySelectorAll('a')) {
		const t = clean(a.text);
		if (t && t.length <= 20) navText.add(t);
	}

	// TITLE CANDIDATES: HEADINGS + ELEMENTS WHOSE id/class HINTS AT A TITLE/NAME, RANKED SO REAL HEADINGS
	// AND CHAPTER-LOOKING TEXT BEAT SITE-MENU HEADERS (WHICH OTHERWISE BURY THE CHAPTER TITLE).
	type TCand = { sel: string; text: string; rank: number };
	const tcands: TCand[] = [];
	const titleSeen = new Set<string>();
	for (const el of all) {
		const tag = el.rawTagName?.toLowerCase() ?? '';
		const hint = `${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`.toLowerCase();
		const heading = tag === 'h1' || tag === 'h2' || tag === 'h3';
		const hinted = /title|name|chapter|bookname|headline/.test(hint);
		if (!heading && !hinted) continue;
		const t = clean(el.text);
		if (!t || t.length > 80) continue;
		if (navText.has(t) || NAV_NAV.test(t)) continue; // A MENU LABEL, NOT A CHAPTER TITLE
		const sel = selectorFor(el);
		const key = `${sel}|${t}`;
		if (titleSeen.has(key)) continue;
		titleSeen.add(key);
		const chapterish = /第\s*[\d〇零一二三四五六七八九十百千两]+\s*[章节節回卷話话部]|chapter|第\d+話/i.test(t);
		tcands.push({ sel, text: t, rank: (heading ? 2 : 0) + (chapterish ? 1 : 0) });
	}
	tcands.sort((a, b) => b.rank - a.rank);
	const titleLines = tcands.slice(0, 14).map((c) => `  ${c.sel}  "${c.text.slice(0, 60)}"`);

	// CONTENT CANDIDATES: HIGH TEXT, LOW LINK-TEXT, NOT CHROME. RANKED BY DENSITY (text MINUS link text).
	type Cand = { el: HTMLElement; sel: string; len: number; density: number; preview: string };
	const cands: Cand[] = [];
	for (const el of all) {
		const tag = el.rawTagName?.toLowerCase() ?? '';
		if (SKIP_TAGS.has(tag)) continue;
		const txt = clean(el.text);
		if (txt.length < 400) continue;
		let linkLen = 0;
		for (const a of el.querySelectorAll('a')) linkLen += clean(a.text).length;
		const density = txt.length - linkLen;
		if (density < 300) continue; // MOSTLY LINKS → A MENU, NOT PROSE
		cands.push({ el, sel: selectorFor(el), len: txt.length, density, preview: txt.slice(0, 90) });
	}
	cands.sort((a, b) => b.density - a.density);
	// PREFER THE TIGHTEST CONTAINER: WHEN A CANDIDATE AND ONE OF ITS ANCESTORS HAVE COMPARABLE DENSITY,
	// KEEP THE DESCENDANT (THE STORY DIV) AND DROP THE ANCESTOR (THE WRAPPER THAT ALSO HOLDS CHROME).
	const kept: Cand[] = [];
	const keptSel = new Set<string>();
	for (const c of cands) {
		if (keptSel.has(c.sel)) continue;
		if (kept.some((k) => isDescendant(k.el, c.el) && k.density >= c.density * 0.7)) continue;
		for (let i = kept.length - 1; i >= 0; i--) {
			if (isDescendant(c.el, kept[i].el) && c.density >= kept[i].density * 0.7) {
				keptSel.delete(kept[i].sel);
				kept.splice(i, 1);
			}
		}
		kept.push(c);
		keptSel.add(c.sel);
	}
	kept.sort((a, b) => b.density - a.density);
	const top = kept.slice(0, 12);

	// LOOSE-TEXT FALLBACK: IF THE PROSE SITS DIRECTLY IN AN ELEMENT (NO TIGHT WRAPPER), THE BEST CONTENT
	// CANDIDATE WON'T HOLD MUCH OF IT. OFFER A SYNTHETIC "body" CANDIDATE PREVIEWING THE CHROME-STRIPPED
	// PAGE TEXT SO THE MODEL CAN STILL POINT AT IT.
	let maxOwn = 0;
	for (const el of all) {
		const tag = el.rawTagName?.toLowerCase() ?? '';
		if (tag === 'script' || tag === 'style') continue;
		const o = ownTextLen(el);
		if (o > maxOwn) maxOwn = o;
	}
	const bestKept = top[0]?.len ?? 0;
	if (maxOwn >= 400 && maxOwn > bestKept * 1.1) {
		const loosePreview = clean(extractProse(root.innerHTML)).slice(0, 90);
		top.push({
			el: root,
			sel: 'body',
			len: maxOwn,
			density: maxOwn,
			preview: `(loose-text fallback) ${loosePreview}`,
		});
	}

	// NAV LINKS: SHORT ANCHOR TEXT WITH AN href. CHAPTER-NAV LABELS (上一章/下一章/目录/…) ARE COLLECTED
	// FIRST SO A SITE WITH A HUGE TOP MENU CAN'T BURY THEM PAST THE CAP.
	const navLines: string[] = [];
	const navSeen = new Set<string>();
	const anchors = root.querySelectorAll('a');
	const pushNav = (a: HTMLElement): void => {
		const t = clean(a.text);
		const href = a.getAttribute('href');
		if (!t || t.length > 16 || !href) return;
		if (navSeen.has(t)) return;
		navSeen.add(t);
		navLines.push(`  "${t}" -> ${href.slice(0, 90)}`);
	};
	for (const a of anchors) if (NAV_NAV.test(clean(a.text))) pushNav(a);
	for (const a of anchors) {
		if (navLines.length >= 60) break;
		pushNav(a);
	}

	// NAV CONTROLS: NON-ANCHOR / JS-DRIVEN NAVIGATION THE <a href> LIST ABOVE CAN'T EXPRESS — A HIDDEN-INPUT
	// value, A data-*/onclick BUTTON. EACH LINE GIVES THE DIRECTION, A SELECTOR, THE ATTRIBUTE HOLDING THE URL,
	// AND THE URL, SO THE MODEL CAN MAP e.g. {"sel":"input#next_epi_auto_url","attr":"value"} ON A SPA SITE.
	const ctrlLines: string[] = [];
	const ctrlSeen = new Set<string>();
	const dirOf = (hint: string): 'prev' | 'next' | 'index' | null =>
		FALLBACK_PREV.test(hint) && !FALLBACK_NEXT.test(hint)
			? 'prev'
			: FALLBACK_NEXT.test(hint) && !FALLBACK_PREV.test(hint)
				? 'next'
				: FALLBACK_INDEX.test(hint)
					? 'index'
					: null;
	for (const el of root.querySelectorAll('a,input,div,span,button,li')) {
		if (ctrlLines.length >= 24) break;
		const hint = `${el.getAttribute('id') ?? ''} ${el.getAttribute('name') ?? ''} ${el.getAttribute('class') ?? ''} ${el.getAttribute('rel') ?? ''}`;
		let attr = '';
		let raw = '';
		for (const a of ['href', 'value', 'data-url', 'data-href', 'data-link']) {
			const v = el.getAttribute(a);
			if (v && (/^https?:\/\//i.test(v) || v.startsWith('/'))) {
				attr = a;
				raw = v;
				break;
			}
		}
		if (!raw) {
			const oc = el.getAttribute('onclick')?.match(ONCLICK_URL)?.[1];
			if (oc) {
				attr = 'onclick';
				raw = oc;
			}
		}
		if (!raw) continue;
		// PLAIN ANCHOR href IS ALREADY IN "NAV LINKS" — ONLY SURFACE WHAT THAT LIST CAN'T (NON-href / NON-<a>).
		if (attr === 'href' && el.rawTagName?.toLowerCase() === 'a') continue;
		const dir = dirOf(hint) ?? (BOOK_PATH.test(raw) ? 'index' : null);
		if (!dir) continue;
		const sel = ownSelector(el); // ONLY A CLEAN tag#id / tag.class SELECTOR THE MODEL IS ALLOWED TO USE
		if (!sel) continue;
		const key = `${dir}|${sel}|${attr}`;
		if (ctrlSeen.has(key)) continue;
		ctrlSeen.add(key);
		ctrlLines.push(`  ${dir}: ${sel} @${attr} -> ${raw.slice(0, 80)}`);
	}

	const out = [
		'TITLE CANDIDATES (selector  "text"):',
		...titleLines,
		'',
		'CONTENT CANDIDATES (selector | chars | preview) — the chapter BODY is the one whose preview is narrative prose, not a menu/comments:',
		...top.map((c) => `  ${c.sel} | ${c.len} | "${c.preview}"`),
		'',
		'NAV LINKS (text -> href):',
		...navLines,
		...(ctrlLines.length
			? [
					'',
					'NAV CONTROLS (JS/SPA navigation — direction: selector @attribute -> url). Use these for prev/next/index when no NAV LINK fits; copy the selector AND set "attr" to the named attribute:',
					...ctrlLines,
				]
			: []),
	].join('\n');
	return out.length > DIGEST_BUDGET ? out.slice(0, DIGEST_BUDGET) : out;
}

// FIND THE BEST CONTENT CANDIDATE ON A PAGE (THE ELEMENT WHOSE TEXT HAS THE HIGHEST DENSITY — HIGH TEXT,
// LOW LINK-TEXT — FROM THE SAME CANDIDATE-PICKING LOGIC AS buildSkeleton). RETURN ITS innerHTML, OR null
// IF NO CANDIDATE MEETS THE THRESHOLD. USED AS A ZERO-COST FALLBACK WHEN AI SELECTOR-LEARNING FAILS: THE
// SYSTEM CAN STILL EXTRACT THE CHAPTER FROM THE MOST LIKELY CONTENT BLOCK WITHOUT ANOTHER MODEL CALL.
export function findBestContentHtml(root: HTMLElement): string | null {
	const all = root.querySelectorAll('*');
	const cands: { el: HTMLElement; density: number }[] = [];
	for (const el of all) {
		const tag = el.rawTagName?.toLowerCase() ?? '';
		if (SKIP_TAGS.has(tag)) continue;
		const txt = clean(el.text);
		if (txt.length < 400) continue;
		let linkLen = 0;
		for (const a of el.querySelectorAll('a')) linkLen += clean(a.text).length;
		const density = txt.length - linkLen;
		if (density < 300) continue;
		cands.push({ el, density });
	}
	cands.sort((a, b) => b.density - a.density);
	// PREFER THE TIGHTEST CONTAINER (SAME ANCESTOR-DEDUP AS buildSkeleton).
	const kept: { el: HTMLElement; density: number }[] = [];
	for (const c of cands) {
		if (kept.some((k) => isDescendant(k.el, c.el) && k.density >= c.density * 0.7)) continue;
		for (let i = kept.length - 1; i >= 0; i--) {
			if (isDescendant(c.el, kept[i].el) && c.density >= kept[i].density * 0.7) {
				kept.splice(i, 1);
			}
		}
		kept.push(c);
	}
	kept.sort((a, b) => b.density - a.density);
	return kept[0]?.el?.innerHTML ?? null;
}

// PARSE ALL <meta> TAGS INTO A property/name → content MAP (FOR og:image / twitter:image COVER LOOKUP).
function metaMap(html: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /<meta\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const tag = m[0];
		const key = (tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
		const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
		if (key && content) out[key] = content;
	}
	return out;
}

// SCORE THE PAGE'S <img> TAGS AND RETURN THE MOST COVER-LIKE ONE (BIG RASTER IMAGE WITH A BOOK/COVER
// HINT), SKIPPING LOGOS / ICONS / DECORATIONS. USED WHEN A PAGE HAS NO og:image.
function scoreCoverImage(root: HTMLElement, baseUrl: string): string | null {
	let best: string | null = null;
	let bestScore = 1; // REQUIRE A POSITIVE SIGNAL — DON'T RETURN A RANDOM ICON
	for (const img of root.querySelectorAll('img')) {
		const raw =
			img.getAttribute('src') ||
			img.getAttribute('data-src') ||
			img.getAttribute('data-original') ||
			img.getAttribute('_src') ||
			'';
		const url = abs(raw, baseUrl);
		if (!url) continue;
		const lower = url.toLowerCase();
		const hint =
			`${img.getAttribute('id') ?? ''} ${img.getAttribute('class') ?? ''} ${img.getAttribute('itemprop') ?? ''} ${img.getAttribute('alt') ?? ''}`.toLowerCase();
		let score = 0;
		if (img.getAttribute('itemprop') === 'image') score += 6;
		if (/cover|book|novel|thumb|bookimg|pic/.test(hint)) score += 5;
		if (/\.(jpe?g|png|webp)(\?|$|#)/.test(lower)) score += 2;
		if (/\.(gif|svg)(\?|$|#)/.test(lower)) score -= 4; // LOGOS / SPACERS / DECORATIONS
		if (/logo|icon|avatar|sprite|banner|button|blank|loading|spacer|qrcode|\bads?\b/.test(lower)) score -= 5;
		const w = Number(img.getAttribute('width')) || 0;
		const h = Number(img.getAttribute('height')) || 0;
		if (w >= 80 && h >= 100) score += 3; // PORTRAIT, COVER-SIZED
		if (w && w < 40) score -= 3; // TINY → AN ICON
		if (score > bestScore) {
			bestScore = score;
			best = url;
		}
	}
	return best;
}

// EXTRACT A BOOK COVER URL FROM AN INDEX/BOOK PAGE: og:image / twitter:image / link[image_src] FIRST
// (THE COMMON CASE), THEN A SCORED <img> SCAN. RETURNS AN ABSOLUTE URL OR null.
export function extractCover(html: string, baseUrl: string): string | null {
	const meta = metaMap(html);
	const og = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
	if (og) return abs(og, baseUrl);
	const link = html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)?.[1];
	if (link) return abs(link, baseUrl);
	return scoreCoverImage(parse(html), baseUrl);
}

// STRIP A SITE-NAME BOILERPLATE SEGMENT FROM A META TITLE — A LEADING "Site - " / "Site | " / "Site: " OR A
// TRAILING " - Site" / " | Site" (THE SITE NAME COMES FROM og:site_name). KEEPS THE TITLE IF STRIPPING EMPTIES IT.
function stripSiteName(title: string, site: string): string {
	const s = site.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (!s) return title;
	const sep = '\\s*[-|:·–—]\\s*';
	const out = title
		.replace(new RegExp(`^${s}${sep}`, 'i'), '')
		.replace(new RegExp(`${sep}${s}$`, 'i'), '')
		.trim();
	return out || title;
}

// EXTRACT THE BOOK'S OWN TITLE FROM ITS INDEX/BOOK PAGE — og:title (THE CLEAN BOOK NAME, WITHOUT THE
// CHAPTER OR SITE SUFFIX), twitter:title AS A FALLBACK, BOILERPLATE-STRIPPED VIA og:site_name WHEN PRESENT.
// THE AUTHORITATIVE SOURCE WHEN A CHAPTER PAGE'S HEADING MASHES BOOK + CHAPTER TOGETHER (e.g. faloo) AND THE
// BREADCRUMB BOOK-LINK DOESN'T RESOLVE TO THE INDEX. WE DELIBERATELY DON'T FALL BACK TO <title> — IT'S USUALLY
// POLLUTED WITH "…最新章节,…txt下载_站名" BOILERPLATE. RETURNS null SO THE CALLER KEEPS WHAT IT HAD.
export function extractBookTitle(html: string): string | null {
	const meta = metaMap(html);
	let t = (meta['og:title'] || meta['twitter:title'] || '').trim();
	const site = (meta['og:site_name'] || meta['application-name'] || '').trim();
	if (t && site) t = stripSiteName(t, site);
	return t && t.length <= 120 ? t : null;
}

// BUILD AN IMAGE-CANDIDATE DIGEST FOR THE AI COVER FALLBACK — EACH <img>'s ABSOLUTE URL + ITS HINTS,
// SO THE MODEL CAN PICK THE COVER ON A SITE WHERE THE HEURISTICS ABOVE FOUND NOTHING.
export function buildImageDigest(html: string, baseUrl: string): string {
	const root = parse(html);
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const img of root.querySelectorAll('img')) {
		const raw =
			img.getAttribute('src') ||
			img.getAttribute('data-src') ||
			img.getAttribute('data-original') ||
			img.getAttribute('_src') ||
			'';
		const url = abs(raw, baseUrl);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		const w = img.getAttribute('width') ?? '?';
		const h = img.getAttribute('height') ?? '?';
		const hint = clean(
			`${img.getAttribute('class') ?? ''} ${img.getAttribute('id') ?? ''} ${img.getAttribute('alt') ?? ''}`,
		).slice(0, 40);
		lines.push(`  ${url}  [${w}x${h}]${hint ? ` "${hint}"` : ''}`);
		if (lines.length >= 30) break;
	}
	return lines.join('\n');
}

export const COVER_SYSTEM = `You are given a list of images from a web-novel's BOOK page (absolute URL, [width x height], and any class/alt hints).
Return ONLY JSON: {"cover":"<absolute URL of the book cover image, or empty string if none>"}.
The cover is the book's portrait artwork — a sizeable raster image (jpg/png/webp), often with a "cover"/"book"/"novel" hint or itemprop=image. NEVER pick a site logo, icon, avatar, banner, ad, button, or spacer/decoration (often .gif). If no image is clearly a book cover, return "".`;

// COERCE THE AI COVER REPLY → AN ABSOLUTE http(s) URL OR null.
export function coerceCover(text: string): string | null {
	try {
		const o = JSON.parse(text) as { cover?: unknown };
		const c = typeof o.cover === 'string' ? o.cover.trim() : '';
		return /^https?:\/\//i.test(c) ? c : null;
	} catch {
		return null;
	}
}

function coerceNav(v: unknown): NavRule | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const o = v as { sel?: unknown; text?: unknown; attr?: unknown };
	const sel = typeof o.sel === 'string' && o.sel.trim() ? o.sel.trim() : undefined;
	const text = Array.isArray(o.text)
		? o.text.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
		: undefined;
	// attr IS ONLY MEANINGFUL ALONGSIDE A sel, AND ONLY IF IT NAMES A SAFE URL-BEARING ATTRIBUTE.
	const attr =
		typeof o.attr === 'string' && o.attr.trim() && SAFE_ATTR.test(o.attr.trim())
			? o.attr.trim().toLowerCase()
			: undefined;
	if (!sel && !(text && text.length)) return undefined;
	return { sel, text: text && text.length ? text : undefined, attr: sel ? attr : undefined };
}

// SAFE SELECTOR GRAMMAR (MATCHES THE MAP_SYSTEM CONTRACT): tag / .class / #id TOKENS JOINED BY DESCENDANT
// SPACES, OPTIONALLY A COMMA-SEPARATED FALLBACK LIST. THE MODEL SOMETIMES IGNORES THE CONTRACT AND EMITS
// [attribute] / :pseudo / OVERFIT href SELECTORS (e.g. a[href*='16453567'] HARD-CODED TO ONE SAMPLE
// CHAPTER) — THOSE RESOLVE THE WRONG ELEMENT ON EVERY OTHER PAGE (NEXT POINTING AT AN EARLIER CHAPTER),
// SO WE STRIP THEM. NAV STILL WORKS VIA ITS LANGUAGE-STANDARD text LABELS (下一章 / next / 次へ / …).
const SAFE_SEL_TOKEN = /^[a-zA-Z][\w-]*(?:[.#][\w-]+)*$|^[.#][\w-]+$/;

function isSafeSelectorPart(part: string): boolean {
	const t = part.trim();
	if (!t) return false;
	const tokens = t.split(/\s+/);
	return tokens.length > 0 && tokens.every((tok) => SAFE_SEL_TOKEN.test(tok));
}

function safeSelector(sel: string | undefined): string | undefined {
	if (!sel) return undefined;
	const parts = splitSel(sel).filter(isSafeSelectorPart);
	return parts.length ? parts.join(', ') : undefined;
}

// A NAV sel MUST BE *SPECIFIC* — EVERY PART HAS TO CARRY A #id OR .class. A BARE-TAG NAV SELECTOR (e.g. "a",
// "div", "li") MATCHES THE FIRST SUCH ELEMENT IN THE DOCUMENT — ALMOST ALWAYS A HEADER LINK OR A href="#"
// TOGGLE, NEVER THE REAL prev/next/index NEIGHBOUR — SO resolveNav WOULD LOCK ONTO IT AND SKIP THE RELIABLE
// LANGUAGE-STANDARD text LABEL (下一章 / 目录 / next / …). DROP IT (KEEPING text) SO THE LABEL MATCH WINS.
// SPA NAV CONTROLS STILL WORK: THEIR SELECTOR IS A REAL #id (e.g. input#next_epi_auto_url), WHICH SURVIVES.
function navSelector(sel: string | undefined): string | undefined {
	const safe = safeSelector(sel);
	if (!safe) return undefined;
	const parts = splitSel(safe).filter((p) => /[.#]/.test(p));
	return parts.length ? parts.join(', ') : undefined;
}

function safeNav(rule: NavRule | undefined): NavRule | undefined {
	if (!rule) return undefined;
	const sel = navSelector(rule.sel);
	const text = rule.text?.filter((t) => t && t.trim());
	if (!sel && !(text && text.length)) return undefined;
	// KEEP attr ONLY WHEN A SAFE sel SURVIVED AND attr IS A RECOGNISED URL-BEARING ATTRIBUTE.
	const attr = sel && rule.attr && SAFE_ATTR.test(rule.attr) ? rule.attr : undefined;
	return { sel, text: text && text.length ? text : undefined, attr };
}

// DROP UNSAFE / OVERFIT SELECTORS FROM A MAP (KEEPING NAV text LABELS). APPLIED BOTH WHEN LEARNING A NEW
// MAP AND WHEN READING A STORED ONE, SO ALREADY-PERSISTED OVERFIT MAPS SELF-CORRECT ON THE NEXT FETCH.
export function sanitizeMap(m: SelectorMap): SelectorMap {
	// title/body MUST STAY SELECTORS; IF SANITIZE EMPTIES THEM, KEEP THE RAW VALUE — applyAdapter REJECTS A
	// TRULY-BROKEN ONE AND TRIGGERS A RE-LEARN RATHER THAN US SILENTLY GUESSING.
	const out: SelectorMap = { title: safeSelector(m.title) ?? m.title, body: safeSelector(m.body) ?? m.body };
	const prev = safeNav(m.prev);
	if (prev) out.prev = prev;
	const next = safeNav(m.next);
	if (next) out.next = next;
	const index = safeNav(m.index);
	if (index) out.index = index;
	if (m.author) {
		const sel = safeSelector(m.author.sel);
		if (sel) out.author = { sel };
		else if (m.author.scriptRegex) out.author = { scriptRegex: m.author.scriptRegex };
	}
	if (m.idUrlPattern) out.idUrlPattern = m.idUrlPattern;
	return out;
}

// COERCE A RAW MODEL JSON STRING INTO A VALIDATED + SANITIZED SelectorMap. THROWS A PLAIN Error (THE CALLER
// MAPS IT TO A FetchError) WHEN title/body ARE MISSING OR THE JSON IS UNUSABLE.
export function coerceMap(text: string): SelectorMap {
	let o: {
		title?: unknown;
		body?: unknown;
		prev?: unknown;
		next?: unknown;
		index?: unknown;
		author?: unknown;
		idUrlPattern?: unknown;
	};
	try {
		o = JSON.parse(text);
	} catch {
		throw new Error('Model returned invalid JSON.');
	}
	const title = typeof o.title === 'string' ? o.title.trim() : '';
	const body = typeof o.body === 'string' ? o.body.trim() : '';
	if (!title || !body) throw new Error('Model omitted title/body.');
	const m: SelectorMap = { title, body };
	const prev = coerceNav(o.prev);
	if (prev) m.prev = prev;
	const next = coerceNav(o.next);
	if (next) m.next = next;
	const index = coerceNav(o.index);
	if (index) m.index = index;
	const authorSel = (o.author as { sel?: unknown } | undefined)?.sel;
	if (typeof authorSel === 'string' && authorSel.trim()) m.author = { sel: authorSel.trim() };
	if (typeof o.idUrlPattern === 'string' && o.idUrlPattern.trim()) m.idUrlPattern = o.idUrlPattern.trim();
	// STRIP ANY [attr] / :pseudo / OVERFIT SELECTORS THE MODEL SLIPPED IN BEFORE WE PERSIST THE MAP.
	return sanitizeMap(m);
}
