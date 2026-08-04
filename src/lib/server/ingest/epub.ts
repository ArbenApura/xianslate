// IMPORTED DEP-TYPES
import type { ImportedBook } from '$lib/types';
// IMPORTED DEP-MODULES
import { unzipSync } from 'fflate';
// IMPORTED MODULES
import { decodeTextBytes } from '../charset';

// -- CONSTANTS -- //

// ZIP-BOMB GUARDS: A FEW-MB EPUB CAN INFLATE TO MANY GB. CAP BOTH PER-ENTRY AND TOTAL INFLATED BYTES,
// AND ONLY INFLATE THE TEXTUAL ENTRIES WE ACTUALLY READ (XHTML/XML/OPF/NCX) — SKIP IMAGES/FONTS/CSS,
// WHICH ARE THE BULK OF MOST EPUBS AND ARE NEVER USED HERE.
const MAX_ENTRY_INFLATED = 25 * 1024 * 1024;
const MAX_TOTAL_INFLATED = 150 * 1024 * 1024;
const TEXT_ENTRY_RE = /\.(x?html?|xml|opf|ncx)$/i;
// JUST THE READABLE (X)HTML DOCUMENTS — USED BY THE NO-OPF FALLBACK BELOW.
const HTML_ENTRY_RE = /\.(x?html?)$/i;

// A SINGLE SPINE DOCUMENT WITH THIS MANY CHARS OF VISIBLE TEXT IS PROBABLY A WHOLE BOOK PACKED INTO ONE
// FILE (COMMON FOR FANFIC / SINGLE-FILE EPUB EXPORTS), NOT ONE CHAPTER — TRY TO SPLIT IT BY ITS INTERNAL
// HEADINGS SO IT READS AS REAL CHAPTERS INSTEAD OF ONE ENDLESS SCROLL.
const SPLIT_MIN_DOC_CHARS = 25_000;
// ...BUT ONLY WHEN A HEADING LEVEL REPEATS AT LEAST THIS OFTEN (3+ ⇒ MULTIPLE CHAPTERS, NOT JUST A COUPLE
// OF SCENE-BREAK SUBHEADINGS INSIDE A SINGLE LONG CHAPTER).
const SPLIT_MIN_HEADINGS = 3;
// A SUBSTANTIAL PREAMBLE BEFORE THE FIRST SPLIT HEADING IS KEPT AS ITS OWN LEADING CHAPTER ONCE IT HAS AT
// LEAST THIS MUCH TEXT (BELOW THIS IT'S USUALLY JUST A STRAY TITLE LINE THAT THE FIRST SEGMENT SUBSUMES).
const PREAMBLE_MIN_CHARS = 200;

// -- FUNCTIONS -- //

// A NUMERIC HTML ENTITY CAN NAME A CODE POINT OUTSIDE THE VALID U+0000–U+10FFFF RANGE (e.g. &#9999999999;);
// String.fromCodePoint THROWS RangeError ON THOSE, WHICH WOULD ABORT THE WHOLE IMPORT. DROP AN OUT-OF-RANGE
// CODE POINT INSTEAD SO ONE MALFORMED ENTITY NEVER CRASHES A BORDERLINE-VALID EPUB.
function fromCodePointSafe(cp: number): string {
	return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

// decodeURIComponent THROWS URIError ON A MALFORMED %-SEQUENCE (LEGAL IN A ZIP ENTRY NAME, e.g. "%ZZ");
// RETURN null SO A SINGLE BAD MANIFEST HREF FALLS THROUGH INSTEAD OF ABORTING THE ENTIRE EPUB IMPORT.
function decodeUriComponentSafe(s: string): string | null {
	try {
		return decodeURIComponent(s);
	} catch {
		return null;
	}
}

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&emsp;|&ensp;|&thinsp;/g, ' ')
		.replace(/&apos;/g, "'")
		.replace(/&mdash;/g, '—')
		.replace(/&ndash;/g, '–')
		.replace(/&hellip;/g, '…')
		.replace(/&lsquo;/g, '‘')
		.replace(/&rsquo;/g, '’')
		.replace(/&ldquo;/g, '“')
		.replace(/&rdquo;/g, '”')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, d) => fromCodePointSafe(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePointSafe(parseInt(h, 16)));
}

// THE INNER HTML OF <body> (OR THE WHOLE STRING IF THERE'S NO BODY TAG).
function bodyOf(html: string): string {
	return /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
}

// STRIP A FRAGMENT OF (X)HTML DOWN TO BLANK-LINE-SEPARATED PARAGRAPHS OF VISIBLE TEXT.
function fragmentToText(fragment: string): string {
	return decodeEntities(
		fragment
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
			.replace(/<\/(p|div|h[1-6]|li|br|tr|blockquote|figcaption)>/gi, '\n')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, ''),
	)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
}

// THE FIRST HEADING (h1–h3) OR <title> TEXT OF A DOCUMENT — USED AS THE CHAPTER TITLE.
function titleOf(html: string, body: string): string | null {
	const m = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(body) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) || null : null;
}

// SPLIT A LARGE BODY INTO PER-CHAPTER SEGMENTS BY ITS INTERNAL HEADINGS. PICKS THE SHALLOWEST HEADING
// LEVEL THAT REPEATS ENOUGH TO BE A CHAPTER DELIMITER (SO A LONE <h1> BOOK TITLE OVER MANY <h2> CHAPTERS
// SPLITS ON THE <h2>S). RETURNS [] WHEN THERE'S NO REPEATING HEADING STRUCTURE — THE CALLER THEN KEEPS THE
// DOCUMENT AS A SINGLE CHAPTER. NOTHING IS DROPPED: ANY REAL PREAMBLE BECOMES ITS OWN LEADING CHAPTER.
function splitBodyByHeadings(body: string): { title: string | null; text: string }[] {
	const heads: { level: number; start: number; title: string }[] = [];
	const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		heads.push({
			level: Number(m[1][1]),
			start: m.index,
			title: decodeEntities(m[2].replace(/<[^>]+>/g, '').trim()),
		});
	}
	if (heads.length < SPLIT_MIN_HEADINGS) return [];

	// SHALLOWEST LEVEL (h1 < h2 < …) THAT OCCURS OFTEN ENOUGH TO DELIMIT CHAPTERS.
	const byLevel = new Map<number, number>();
	for (const h of heads) byLevel.set(h.level, (byLevel.get(h.level) ?? 0) + 1);
	let level = -1;
	for (let L = 1; L <= 6; L++) {
		if ((byLevel.get(L) ?? 0) >= SPLIT_MIN_HEADINGS) {
			level = L;
			break;
		}
	}
	if (level === -1) return [];

	const marks = heads.filter((h) => h.level === level);
	const segs: { title: string | null; text: string }[] = [];
	for (let i = 0; i < marks.length; i++) {
		const to = i + 1 < marks.length ? marks[i + 1].start : body.length;
		const text = fragmentToText(body.slice(marks[i].start, to));
		if (text.length > 0) segs.push({ title: marks[i].title || null, text });
	}
	// KEEP ANY SUBSTANTIAL CONTENT BEFORE THE FIRST DELIMITER HEADING (e.g. A TITLE/SUMMARY PAGE).
	const preBody = body.slice(0, marks[0].start);
	const pre = fragmentToText(preBody);
	if (pre.length >= PREAMBLE_MIN_CHARS) segs.unshift({ title: titleOf('', preBody), text: pre });

	return segs.length >= 2 ? segs : [];
}

// TURN ONE SPINE/LOOSE DOCUMENT INTO ONE OR MORE CHAPTERS (SPLITTING IT IF IT'S A WHOLE BOOK IN ONE FILE).
// fallbackTitle SEEDS A CHAPTER TITLE WHEN THE DOCUMENT CARRIES NO HEADING OF ITS OWN.
function docToChapters(html: string, fallbackTitle: string): { titleSource: string; contentSource: string }[] {
	const body = bodyOf(html);
	const fullText = fragmentToText(body);
	if (fullText.length >= SPLIT_MIN_DOC_CHARS) {
		const segs = splitBodyByHeadings(body);
		if (segs.length >= 2) {
			return segs.map((s, i) => ({
				titleSource: s.title || `${fallbackTitle} (${i + 1})`,
				contentSource: s.text,
			}));
		}
	}
	// TRULY EMPTY DOCS (COVER-IMAGE WRAPPERS, BLANK PAGES) PRODUCE NO CHAPTER.
	if (fullText.length < 4) return [];
	return [{ titleSource: titleOf(html, body) || fallbackTitle, contentSource: fullText }];
}

function dirname(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i + 1);
}

function resolvePath(base: string, rel: string): string {
	// SIMPLE PATH JOIN + NORMALISE FOR EPUB INTERNAL HREFS
	const parts = (base + rel.split('#')[0]).split('/');
	const out: string[] = [];
	for (const p of parts) {
		if (p === '' || p === '.') continue;
		if (p === '..') out.pop();
		else out.push(p);
	}
	return out.join('/');
}

// NATURAL ORDER SO "Chapter-2" < "Chapter-10" < "Chapter-100" AND "page-1" < "page-10" — COMPARES EMBEDDED
// NUMERIC RUNS NUMERICALLY, EVERYTHING ELSE LEXICALLY. USED TO ORDER A BARE ZIP OF CHAPTER FILES.
function naturalCompare(a: string, b: string): number {
	const ax = a.match(/\d+|\D+/g) ?? [a];
	const bx = b.match(/\d+|\D+/g) ?? [b];
	const len = Math.min(ax.length, bx.length);
	for (let i = 0; i < len; i++) {
		const an = Number(ax[i]);
		const bn = Number(bx[i]);
		const bothNum = !Number.isNaN(an) && !Number.isNaN(bn) && /\d/.test(ax[i]) && /\d/.test(bx[i]);
		if (bothNum) {
			if (an !== bn) return an - bn;
		} else if (ax[i] !== bx[i]) {
			return ax[i] < bx[i] ? -1 : 1;
		}
	}
	return ax.length - bx.length;
}

// A READABLE CHAPTER TITLE DERIVED FROM A FILE NAME (e.g. "Chapter-1-Trimming-Donkey-Hooves.xhtml").
function titleFromFilename(path: string): string {
	const base = (path.split('/').pop() ?? path).replace(/\.(x?html?)$/i, '');
	return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// IMPORT AN EPUB FILE INTO AN ORDERED LIST OF CHAPTERS. `hints` ARE THE SOURCE LANGUAGE'S LEGACY CHARSET
// CANDIDATES (e.g. JP Shift_JIS) FOR (X)HTML ENTRIES THAT AREN'T UTF-8 AND CARRY NO DECLARATION.
// HANDLES THREE REAL-WORLD SHAPES: (1) A STANDARD container.xml → OPF → SPINE EPUB; (2) A SINGLE-FILE EPUB
// WHERE ONE SPINE DOCUMENT HOLDS THE WHOLE BOOK (SPLIT BY HEADINGS); (3) A BARE ZIP OF (X)HTML CHAPTER
// FILES WITH NO OPF AT ALL (NATURAL-SORTED, ONE CHAPTER EACH). NOTHING READABLE IS DROPPED — FRONT MATTER
// (COVER TEXT, TABLE OF CONTENTS, COPYRIGHT, NOTES) IS KEPT AS ITS OWN CHAPTER, SINCE THIS IS A READER.
export function importEpub(bytes: Uint8Array, fallbackTitle: string, hints: string[] = []): ImportedBook {
	// EPUB IS A ZIP — REJECT ANYTHING THAT ISN'T (MAGIC BYTES "PK\x03\x04" / EMPTY-ARCHIVE "PK\x05\x06").
	if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || (bytes[2] !== 0x03 && bytes[2] !== 0x05)) {
		throw new Error('Not a valid EPUB (not a ZIP archive).');
	}

	let totalInflated = 0;
	const files = unzipSync(bytes, {
		filter: (f) => {
			const sz = f.originalSize || 0;
			if (sz > MAX_ENTRY_INFLATED) throw new Error('EPUB entry too large (possible zip bomb).');
			totalInflated += sz;
			if (totalInflated > MAX_TOTAL_INFLATED) throw new Error('EPUB inflates too large (possible zip bomb).');
			return TEXT_ENTRY_RE.test(f.name) || f.name === 'META-INF/container.xml';
		},
	});
	// DECODE PER-ENTRY BY DETECTED/DECLARED CHARSET (EPUB XHTML MAY BE LEGACY CJK, NOT JUST UTF-8).
	const get = (name: string): string | null => (files[name] ? decodeTextBytes(files[name], true, hints) : null);

	let title = fallbackTitle;
	let author: string | null = null;
	const chapters: { titleSource: string; contentSource: string }[] = [];

	// PATH 1 + 2 — STANDARD EPUB: container.xml → OPF → ORDERED SPINE (SPLITTING ANY WHOLE-BOOK-IN-ONE-FILE).
	const container = get('META-INF/container.xml');
	const opfPath = container ? /full-path=["']([^"']+)["']/i.exec(container)?.[1] : undefined;
	const opf = opfPath ? get(opfPath) : null;
	if (opf && opfPath) {
		const opfDir = dirname(opfPath);
		title = decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() ?? '') || fallbackTitle;
		author = decodeEntities(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim() ?? '') || null;

		// MANIFEST: id -> href
		const manifest = new Map<string, string>();
		for (const m of opf.matchAll(/<item\s+([^>]+?)\/?>/gi)) {
			const attrs = m[1];
			const id = /\bid=["']([^"']+)["']/i.exec(attrs)?.[1];
			const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
			if (id && href) manifest.set(id, href);
		}

		// SPINE: ORDERED idrefs
		const spineBlock = /<spine[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? '';
		for (const m of spineBlock.matchAll(/<itemref\s+[^>]*idref=["']([^"']+)["']/gi)) {
			const href = manifest.get(m[1]);
			if (!href) continue;
			const full = resolvePath(opfDir, href);
			// FALL BACK TO A PERCENT-DECODED NAME FOR HREFS ENCODED IN THE OPF — decodeUriComponentSafe RETURNS
			// null ON A MALFORMED SEQUENCE SO ONE BAD HREF SKIPS INSTEAD OF ABORTING THE WHOLE IMPORT.
			const decoded = decodeUriComponentSafe(full);
			const raw = get(full) ?? (decoded ? get(decoded) : null);
			if (!raw) continue;
			for (const c of docToChapters(raw, `Chapter ${chapters.length + 1}`)) chapters.push(c);
		}
	}

	// PATH 3 — BARE ZIP OF (X)HTML FILES (NO container.xml / OPF, OR THE OPF YIELDED NOTHING). ORDER THE
	// READABLE DOCUMENTS BY NATURAL FILE NAME AND TAKE EACH AS A CHAPTER.
	if (chapters.length === 0) {
		const names = Object.keys(files)
			.filter((n) => HTML_ENTRY_RE.test(n))
			.sort(naturalCompare);
		for (const name of names) {
			const raw = get(name);
			if (!raw) continue;
			for (const c of docToChapters(raw, titleFromFilename(name) || `Chapter ${chapters.length + 1}`))
				chapters.push(c);
		}
	}

	if (chapters.length === 0) throw new Error('No readable chapters found in EPUB.');
	return { sourceType: 'epub', title, author, chapters };
}
