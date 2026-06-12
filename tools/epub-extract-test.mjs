// FAITHFUL HARNESS FOR THE CURRENT EPUB PARSER — MIRRORS src/lib/server/ingest/epub.ts (kept in sync)
// PLUS THE UTF-8/declared path of charset.ts, AND ASSERTS EXPECTATIONS PER SAMPLE SO WE CAN ITERATE
// "RECURSIVELY UNTIL ALL SUCCESSFUL". USAGE: node tools/epub-extract-test.mjs <dir-with-epubs>
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';

// ---- charset (faithful subset: BOM + declared + strict-utf8 + legacy gb18030 fallback) ----
function hasBom(b, sig) {
	if (b.length < sig.length) return false;
	for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
	return true;
}
function tryUtf8(bytes) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}
function safeDecode(bytes, label) {
	try {
		return new TextDecoder(label).decode(bytes);
	} catch {
		return null;
	}
}
function declaredLabel(bytes) {
	const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
	const xml = head.match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i)?.[1];
	if (xml) return xml;
	const metaCharset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
	if (metaCharset) return metaCharset;
	return head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1] ?? null;
}
function decodeTextBytes(bytes, sniffMarkup = false) {
	if (bytes.length === 0) return '';
	if (hasBom(bytes, [0xef, 0xbb, 0xbf])) return new TextDecoder('utf-8').decode(bytes.subarray(3));
	if (hasBom(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes);
	if (hasBom(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes);
	if (sniffMarkup) {
		const label = declaredLabel(bytes);
		if (label) {
			const d = safeDecode(bytes, label.toLowerCase());
			if (d != null) return d;
		}
	}
	const utf8 = tryUtf8(bytes);
	if (utf8 != null) return utf8;
	return safeDecode(bytes, 'gb18030') ?? new TextDecoder('utf-8').decode(bytes);
}

// ---- epub.ts (mirror of the real module) ----
const MAX_ENTRY_INFLATED = 25 * 1024 * 1024;
const MAX_TOTAL_INFLATED = 150 * 1024 * 1024;
const TEXT_ENTRY_RE = /\.(x?html?|xml|opf|ncx)$/i;
const HTML_ENTRY_RE = /\.(x?html?)$/i;
const SPLIT_MIN_DOC_CHARS = 25_000;
const SPLIT_MIN_HEADINGS = 3;
const PREAMBLE_MIN_CHARS = 200;

function decodeEntities(s) {
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
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
function bodyOf(html) {
	return /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
}
function fragmentToText(fragment) {
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
function titleOf(html, body) {
	const m = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(body) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) || null : null;
}
function splitBodyByHeadings(body) {
	const heads = [];
	const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
	let m;
	while ((m = re.exec(body))) {
		heads.push({
			level: Number(m[1][1]),
			start: m.index,
			title: decodeEntities(m[2].replace(/<[^>]+>/g, '').trim()),
		});
	}
	if (heads.length < SPLIT_MIN_HEADINGS) return [];
	const byLevel = new Map();
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
	const segs = [];
	for (let i = 0; i < marks.length; i++) {
		const to = i + 1 < marks.length ? marks[i + 1].start : body.length;
		const text = fragmentToText(body.slice(marks[i].start, to));
		if (text.length > 0) segs.push({ title: marks[i].title || null, text });
	}
	const preBody = body.slice(0, marks[0].start);
	const pre = fragmentToText(preBody);
	if (pre.length >= PREAMBLE_MIN_CHARS) segs.unshift({ title: titleOf('', preBody), text: pre });
	return segs.length >= 2 ? segs : [];
}
function docToChapters(html, fallbackTitle) {
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
	if (fullText.length < 4) return [];
	return [{ titleSource: titleOf(html, body) || fallbackTitle, contentSource: fullText }];
}
function dirname(path) {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i + 1);
}
function resolvePath(base, rel) {
	const parts = (base + rel.split('#')[0]).split('/');
	const out = [];
	for (const p of parts) {
		if (p === '' || p === '.') continue;
		if (p === '..') out.pop();
		else out.push(p);
	}
	return out.join('/');
}
function naturalCompare(a, b) {
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
function titleFromFilename(path) {
	const base = (path.split('/').pop() ?? path).replace(/\.(x?html?)$/i, '');
	return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function importEpub(bytes, fallbackTitle, hints = []) {
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
	const get = (name) => (files[name] ? decodeTextBytes(files[name], true) : null);
	let title = fallbackTitle;
	let author = null;
	const chapters = [];
	const container = get('META-INF/container.xml');
	const opfPath = container ? /full-path=["']([^"']+)["']/i.exec(container)?.[1] : undefined;
	const opf = opfPath ? get(opfPath) : null;
	if (opf && opfPath) {
		const opfDir = dirname(opfPath);
		title = decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() ?? '') || fallbackTitle;
		author = decodeEntities(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim() ?? '') || null;
		const manifest = new Map();
		for (const m of opf.matchAll(/<item\s+([^>]+?)\/?>/gi)) {
			const attrs = m[1];
			const id = /\bid=["']([^"']+)["']/i.exec(attrs)?.[1];
			const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
			if (id && href) manifest.set(id, href);
		}
		const spineBlock = /<spine[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? '';
		for (const m of spineBlock.matchAll(/<itemref\s+[^>]*idref=["']([^"']+)["']/gi)) {
			const href = manifest.get(m[1]);
			if (!href) continue;
			const full = resolvePath(opfDir, href);
			const raw = get(full) ?? get(decodeURIComponent(full));
			if (!raw) continue;
			for (const c of docToChapters(raw, `Chapter ${chapters.length + 1}`)) chapters.push(c);
		}
	}
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

// ---- expectations per sample (substring match on filename) ----
const EXPECT = [
	{ match: 'shadow-slave', minCh: 95, name: 'shadow-slave', wantChapterWord: 'Nightmare' },
	{ match: 'Could_have_been', minCh: 10, name: 'could-have-been', maxAvg: 60000 },
	{ match: 'donkeys', minCh: 400, name: 'donkeys', ordered: true },
	{ match: 'on-the-dodge', minCh: 1, name: 'on-the-dodge' },
	{ match: 'Unbreakable_Link', minCh: 5, name: 'harry-potter', maxAvg: 80000 },
];

function check(name, book) {
	const exp = EXPECT.find((e) => name.includes(e.match));
	const problems = [];
	if (!exp) return { problems: ['(no expectation defined)'], ok: true };
	if (book.chapters.length < exp.minCh) problems.push(`chapters ${book.chapters.length} < expected >=${exp.minCh}`);
	const lens = book.chapters.map((c) => c.contentSource.length);
	const avg = Math.round(lens.reduce((a, b) => a + b, 0) / book.chapters.length);
	if (exp.maxAvg && avg > exp.maxAvg) problems.push(`avg chapter ${avg} chars > ${exp.maxAvg} (not split enough)`);
	const giant = book.chapters.filter((c) => c.contentSource.length > 200000).length;
	if (giant > 0) problems.push(`${giant} giant chapter(s) > 200k chars (single-file not split)`);
	if (exp.wantChapterWord && !book.chapters.some((c) => c.contentSource.includes(exp.wantChapterWord)))
		problems.push(`expected content word "${exp.wantChapterWord}" not found`);
	const empty = book.chapters.filter((c) => c.contentSource.trim().length === 0).length;
	if (empty) problems.push(`${empty} empty chapter(s)`);
	if (exp.ordered) {
		// VERIFY NATURAL ORDER: chapter numbers parsed from titles must be ascending
		const nums = book.chapters
			.map((c) => Number((c.titleSource.match(/(\d+)/) ?? [])[1]))
			.filter((n) => !Number.isNaN(n));
		let asc = true;
		for (let i = 1; i < nums.length; i++)
			if (nums[i] < nums[i - 1]) {
				asc = false;
				break;
			}
		if (!asc) problems.push('chapter order is NOT natural-ascending (10/100 before 2)');
	}
	return { problems, avg };
}

// ---- run ----
const dir = process.argv[2] ?? 'C:/Users/Admin/Desktop/wiki-reader-ai/uploads';
const epubs = readdirSync(dir).filter((f) => /\.epub$/i.test(f));
let allOk = true;
for (const f of epubs) {
	const name = basename(f);
	console.log('\n========================================================');
	console.log('FILE:', name);
	let book;
	try {
		book = importEpub(new Uint8Array(readFileSync(join(dir, f))), name.replace(/\.epub$/i, ''));
	} catch (e) {
		console.log('  ❌ PARSE ERROR:', e.message);
		allOk = false;
		continue;
	}
	const { problems, avg } = check(name, book);
	console.log(
		`  title="${book.title}" author=${JSON.stringify(book.author)} chapters=${book.chapters.length} avg=${avg}ch`,
	);
	console.log('  first 5:');
	book.chapters
		.slice(0, 5)
		.forEach((c, i) => console.log(`    [${i}] ${c.contentSource.length}ch  "${c.titleSource.slice(0, 50)}"`));
	console.log('  last 3:');
	book.chapters
		.slice(-3)
		.forEach((c, i) =>
			console.log(
				`    [${book.chapters.length - 3 + i}] ${c.contentSource.length}ch  "${c.titleSource.slice(0, 50)}"`,
			),
		);
	if (problems.length) {
		console.log('  ❌ FAIL:', problems.join(' | '));
		allOk = false;
	} else {
		console.log('  ✅ PASS');
	}
}
console.log('\n========================================================');
console.log(allOk ? '✅✅ ALL SAMPLES PASS' : '❌ SOME SAMPLES FAILED');
process.exit(allOk ? 0 : 1);
