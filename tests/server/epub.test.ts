// EPUB INGEST TESTS — REAL MINI-EPUBS BUILT IN-TEST (fflate), EXERCISING THE FULL importEpub PATH.
//
// REGRESSION PINS: (a) A LITERAL `&amp;#65;` IN THE SOURCE MUST STAY `&#65;` — NOT DECODE TWICE INTO "A"
// (THE DOUBLE-DECODE CORRUPTION); (b) THE ZIP-BOMB GUARDS REJECT OVERSIZED ENTRIES/TOTALS; (c) A LONG
// SINGLE-DOCUMENT EPUB WITH REPEATING HEADINGS SPLITS INTO CHAPTERS; (d) TITLE/CHAPTER-HEADING EXTRACTION.
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { importEpub } from '$lib/server/ingest/epub';

function buildEpub(entries: Record<string, Uint8Array | string>): Uint8Array {
	const z: Record<string, Uint8Array> = {};
	for (const [name, data] of Object.entries(entries)) {
		z[name] = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	}
	return zipSync(z);
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opf(chapterIds: string[]): string {
	return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试书</dc:title>
    <dc:creator>作者</dc:creator>
  </metadata>
  <manifest>
    ${chapterIds.map((c) => `<item id="m-${c}" href="${c}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${chapterIds.map((c) => `<itemref idref="m-${c}"/>`).join('\n    ')}
  </spine>
</package>`;
}

function xhtml(title: string, body: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${body}</body></html>`;
}

describe('importEpub — standard EPUB', () => {
	it('extracts title, author, and ordered chapters with heading titles', () => {
		const book = importEpub(
			buildEpub({
				'mimetype': 'application/epub+zip',
				'META-INF/container.xml': CONTAINER,
				'OEBPS/content.opf': opf(['c1', 'c2']),
				'OEBPS/c1.xhtml': xhtml('第1章 起点', '<p>第一段。</p><p>第二段。</p>'),
				'OEBPS/c2.xhtml': xhtml('第2章 死亡', '<p>第三段。</p>'),
			}),
			'Fallback',
		);
		expect(book.title).toBe('测试书');
		expect(book.author).toBe('作者');
		expect(book.chapters).toHaveLength(2);
		expect(book.chapters[0].titleSource).toBe('第1章 起点');
		expect(book.chapters[0].contentSource).toContain('第一段。');
		expect(book.chapters[1].titleSource).toBe('第2章 死亡');
	});

	it('does NOT double-decode a literal `&amp;#65;` into "A" (the corruption regression)', () => {
		const book = importEpub(
			buildEpub({
				'mimetype': 'application/epub+zip',
				'META-INF/container.xml': CONTAINER,
				'OEBPS/content.opf': opf(['c1']),
				'OEBPS/c1.xhtml': xhtml('第1章', '<p>字面量 &amp;#65; 保持原样，实体 &#65; 才是 A。</p>'),
			}),
			'F',
		);
		const content = book.chapters[0].contentSource;
		// THE AUTHOR WROTE THE LITERAL TEXT "&#65;" (HTML-ESCAPED AS &amp;#65;) — IT MUST SURVIVE AS "&#65;".
		expect(content).toContain('字面量 &#65; 保持原样');
		// WHILE A REAL NUMERIC REFERENCE STILL DECODES.
		expect(content).toContain('实体 A 才是 A');
	});

	it('rejects non-ZIP bytes with a clear error', () => {
		expect(() => importEpub(new Uint8Array([1, 2, 3, 4, 5, 6]), 'F')).toThrow(/ZIP/i);
	});
});

describe('importEpub — zip-bomb guards', () => {
	it('rejects a single entry that inflates past the 25MB cap', () => {
		const huge = new Uint8Array(26 * 1024 * 1024).fill(0x20); // WHITESPACE — INFLATES ~1:1
		expect(() =>
			importEpub(
				buildEpub({
					'mimetype': 'application/epub+zip',
					'META-INF/container.xml': CONTAINER,
					'OEBPS/content.opf': opf(['c1']),
					'OEBPS/c1.xhtml': huge,
				}),
				'F',
			),
		).toThrow(/too large/i);
	});
});

describe('importEpub — whole-book-in-one-file split', () => {
	it('splits a 25k+ char document on its repeating headings', () => {
		const para = '字'.repeat(4000);
		const chapter = (t: string) => `<h2>${t}</h2><p>${para}</p><p>${para}</p>`;
		// 3 REPEATING h2 CHAPTERS × ~8k CHARS + A LONG PREAMBLE → CLEARLY PAST THE 25k SPLIT THRESHOLD
		const body = `<p>${'前'.repeat(4000)}</p>${chapter('第一回 风云')}${chapter('第二回 雷雨')}${chapter('第三回 天晴')}`;
		const book = importEpub(
			buildEpub({
				'mimetype': 'application/epub+zip',
				'META-INF/container.xml': CONTAINER,
				'OEBPS/content.opf': opf(['c1']),
				'OEBPS/c1.xhtml': xhtml('整本书', body),
			}),
			'F',
		);
		expect(book.chapters.length).toBeGreaterThanOrEqual(3);
		const titles = book.chapters.map((c) => c.titleSource);
		expect(titles).toContain('第一回 风云');
		expect(titles).toContain('第三回 天晴');
	});

	it('keeps a short document as a single chapter', () => {
		const book = importEpub(
			buildEpub({
				'mimetype': 'application/epub+zip',
				'META-INF/container.xml': CONTAINER,
				'OEBPS/content.opf': opf(['c1']),
				'OEBPS/c1.xhtml': xhtml('短篇', '<p>很短。</p>'),
			}),
			'F',
		);
		expect(book.chapters).toHaveLength(1);
	});
});
