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
// SURVIVES CLASS RENAMES, WHICH IS WHY WE KEEP BOTH).
export type NavRule = { sel?: string; text?: string[] };

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
const NAV_LINE =
	/^(字体|大|中|小|换手|關燈|关灯|开灯|上一[章页頁节節]|下一[章页頁节節]|前一[章页頁]|后一[章页頁]|返回目[录錄]|返回書?[页頁]|返回顶部|回到顶部|目[录錄]|章节目[录錄]|存书签|加入书[签籤架]|推荐本?[书書]|收藏本?[书書]|手机阅读|手機閱讀|章节错误.*|.*点此举报.*|第\(\d+\/\d+\)页|上一篇|下一篇|prev(ious)?|next|index|contents?|table of contents|toc|報錯|报错|分享|收藏|書架|书架|目錄|繁體|簡體|简体|繁体)$/i;

// A BODY WHOSE TEXT *STARTS* LIKE THIS IS CHROME (A NO-JS NOTICE, MENU, OR LOGIN WALL), NOT A CHAPTER.
const CHROME_START =
	/^(您的浏览器|您的瀏覽器|由于您的|請開啟|请开启|javascript|登录|登錄|注册|註冊|排行榜|首页|首頁|加入收藏|手机版|手機版)/i;

export const MAP_SYSTEM = `You are mapping a web-novel CHAPTER page so a scraper can extract it. The page may be in any language (Chinese, Japanese, Korean, English, …) — rely on STRUCTURE and the previews, not on the language.
You are given three lists derived from the page: TITLE CANDIDATES, CONTENT CANDIDATES (each with its text length and a short preview of its text), and NAV LINKS.

Return ONLY a JSON object, no markdown and no prose:
{"title":"<css>","body":"<css>","prev":{"sel":"<css>","text":["..."]},"next":{"sel":"<css>","text":["..."]},"index":{"sel":"<css>","text":["..."]},"author":{"sel":"<css>"},"idUrlPattern":"<regex or empty>"}

Rules:
- Choose selectors from the candidate lists. Selectors may use ONLY tag names, .class, #id and spaces (descendant combinator). NO :pseudo-classes and NO [attribute] selectors.
- "body": choose the ONE CONTENT CANDIDATE whose preview reads as the actual chapter STORY TEXT — never a menu, sidebar, comment list, announcement, or the whole page. Prefer the TIGHTEST block that still holds the prose. A candidate marked "(loose-text fallback)" means the page puts the chapter loosely in the body with no wrapper — choose it (it will be "body") ONLY when no other candidate's preview is the story prose.
- "title": the chapter's heading from TITLE CANDIDATES — the one naming THIS chapter (often contains a chapter number/word like 第…章/章/卷/话/회/chapter), NOT the book's overall title. NEVER answer "title".
- "prev","next","index": from NAV LINKS — previous-chapter, next-chapter, and table-of-contents/book-index links. Match the label in ANY language: previous = 上一章/上一頁/上一页/前一章 · 前へ/前章 · 이전/이전화 · prev/previous/back; next = 下一章/下一頁/下一页/后一章 · 次へ/次章 · 다음/다음화 · next/forward; index = 目录/目錄/章节目录/返回目录 · 目次/一覧 · 목차/목록 · index/contents/toc. Put the matched label(s) in "text"; add "sel" only if an obvious stable selector exists. OMIT any link that is genuinely absent (e.g. no previous on chapter 1).
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
		.map((l) => l.replace(IDEOGRAPHIC_SPACE_RE, ' ').trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
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

// READABILITY EXTRACTION: RE-PARSE AN HTML FRAGMENT (SO WE NEVER MUTATE THE SHARED TREE), STRIP CHROME
// ELEMENTS AND LINK-DENSE CONTROL BLOCKS, THEN FLATTEN TO PARAGRAPHS. WORKS FOR BOTH A WRAPPED CONTENT
// DIV *AND* A WHOLE-PAGE/<body> SCOPE WHERE THE PROSE SITS LOOSE BETWEEN NAV BARS.
function extractProse(fragmentHtml: string): string {
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
	return filterChromeLines(htmlToParagraphs(scope.innerHTML));
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

function resolveNav(root: HTMLElement, rule: NavRule | undefined, base: string): string | null {
	if (!rule) return null;
	if (rule.sel) {
		for (const part of splitSel(rule.sel)) {
			try {
				const href = root.querySelector(part)?.getAttribute('href');
				if (href) return abs(href, base);
			} catch {
				// IGNORE AN UNPARSEABLE SELECTOR PART.
			}
		}
	}
	if (rule.text?.length) {
		// EXACT LABEL MATCH FIRST, THEN A CONTAINS MATCH (LABELS OFTEN SIT INSIDE "« 上一章" ETC).
		for (const a of root.querySelectorAll('a')) {
			if (rule.text.includes(a.text.trim())) return abs(a.getAttribute('href'), base);
		}
		for (const a of root.querySelectorAll('a')) {
			const t = a.text.trim();
			if (t.length <= 20 && rule.text.some((label) => t.includes(label)))
				return abs(a.getAttribute('href'), base);
		}
	}
	return null;
}

// APPLY A SelectorMap TO ALREADY-PARSED HTML. RETURNS null (NOT THROWS) WHEN THE SELECTORS DON'T RESOLVE
// A REAL CHAPTER — THAT null IS THE SELF-HEAL SIGNAL. REJECTS DEGENERATE TITLES AND CHROME-ONLY BODIES.
export function applyAdapter(root: HTMLElement, html: string, m: SelectorMap, url: string): ParsedChapter | null {
	if (allParts(m.body, BODY_BAD) || allParts(m.title, TITLE_BAD)) return null;

	const title = pickText(root, m.title);
	if (!title || title.length > 200) return null;

	// RESOLVE NAV / META *BEFORE* EXTRACTION (extractProse RE-PARSES A FRAGMENT, SO root IS UNTOUCHED).
	let prevUrl = resolveNav(root, m.prev, url);
	let nextUrl = resolveNav(root, m.next, url);
	const indexUrl = resolveNav(root, m.index, url);
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

	const out = [
		'TITLE CANDIDATES (selector  "text"):',
		...titleLines,
		'',
		'CONTENT CANDIDATES (selector | chars | preview) — the chapter BODY is the one whose preview is narrative prose, not a menu/comments:',
		...top.map((c) => `  ${c.sel} | ${c.len} | "${c.preview}"`),
		'',
		'NAV LINKS (text -> href):',
		...navLines,
	].join('\n');
	return out.length > DIGEST_BUDGET ? out.slice(0, DIGEST_BUDGET) : out;
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
	const o = v as { sel?: unknown; text?: unknown };
	const sel = typeof o.sel === 'string' && o.sel.trim() ? o.sel.trim() : undefined;
	const text = Array.isArray(o.text)
		? o.text.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
		: undefined;
	if (!sel && !(text && text.length)) return undefined;
	return { sel, text: text && text.length ? text : undefined };
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

function safeNav(rule: NavRule | undefined): NavRule | undefined {
	if (!rule) return undefined;
	const sel = safeSelector(rule.sel);
	const text = rule.text?.filter((t) => t && t.trim());
	if (!sel && !(text && text.length)) return undefined;
	return { sel, text: text && text.length ? text : undefined };
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
