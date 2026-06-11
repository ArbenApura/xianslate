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

// -- FUNCTIONS -- //

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&emsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function xhtmlToText(html: string): { title: string | null; text: string } {
	const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
	const titleMatch = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(body) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()) || null : null;
	const text = decodeEntities(
		body
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
			.replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, ''),
	)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
	return { title, text };
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

// IMPORT AN EPUB FILE INTO AN ORDERED LIST OF CHAPTERS. `hints` ARE THE SOURCE LANGUAGE'S LEGACY
// CHARSET CANDIDATES (e.g. JP Shift_JIS) FOR XHTML ENTRIES THAT AREN'T UTF-8 AND CARRY NO DECLARATION.
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

	// LOCATE THE OPF VIA container.xml
	const container = get('META-INF/container.xml');
	const opfPath = container ? /full-path="([^"]+)"/i.exec(container)?.[1] : undefined;
	if (!opfPath) throw new Error('Invalid EPUB: container.xml / OPF not found.');
	const opf = get(opfPath);
	if (!opf) throw new Error('Invalid EPUB: OPF file missing.');
	const opfDir = dirname(opfPath);

	const title =
		decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() ?? '') || fallbackTitle;
	const author = decodeEntities(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim() ?? '') || null;

	// MANIFEST: id -> href
	const manifest = new Map<string, string>();
	for (const m of opf.matchAll(/<item\s+([^>]+?)\/?>/gi)) {
		const attrs = m[1];
		const id = /\bid="([^"]+)"/i.exec(attrs)?.[1];
		const href = /\bhref="([^"]+)"/i.exec(attrs)?.[1];
		if (id && href) manifest.set(id, href);
	}

	// SPINE: ORDERED idrefs
	const spineBlock = /<spine[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? '';
	const chapters: { titleSource: string; contentSource: string }[] = [];
	let seq = 0;
	for (const m of spineBlock.matchAll(/<itemref\s+[^>]*idref="([^"]+)"/gi)) {
		const href = manifest.get(m[1]);
		if (!href) continue;
		const full = resolvePath(opfDir, href);
		const raw = get(full) ?? get(decodeURIComponent(full));
		if (!raw) continue;
		const { title: chTitle, text } = xhtmlToText(raw);
		if (!text || text.length < 4) continue;
		seq += 1;
		chapters.push({ titleSource: chTitle ?? `Chapter ${seq}`, contentSource: text });
	}

	if (chapters.length === 0) throw new Error('No readable chapters found in EPUB.');
	return { sourceType: 'epub', title, author, chapters };
}
