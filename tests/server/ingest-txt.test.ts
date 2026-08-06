// TXT INGEST TESTS — THE PLAIN-TEXT NOVEL SPLITTER (PURE).
import { describe, expect, it } from 'vitest';
import { importTxt } from '$lib/server/ingest/txt';

const CHAPTER_1 = '第一章 起点';
const CHAPTER_2 = '第2章 死亡';
const CHAPTER_3 = 'Chapter 3 The End';
const BODY = '内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容';

describe('importTxt', () => {
	it('splits a plain text into ordered chapters on heading lines', () => {
		const text = `${CHAPTER_1}\n${BODY}\n\n${CHAPTER_2}\n${BODY}\n\n${CHAPTER_3}\n${BODY}\n`;
		const book = importTxt(text, 'Untitled');
		expect(book.title).toBe('Untitled');
		expect(book.chapters.map((c) => c.titleSource)).toEqual([CHAPTER_1, CHAPTER_2, CHAPTER_3]);
		expect(book.chapters.every((c) => c.contentSource.includes(BODY))).toBe(true);
	});

	it('handles headings with inline separators (：:、.-—)', () => {
		const text = `序章：楔子\n${BODY}\n\n第一章 起点——新的开始\n${BODY}\n`;
		const book = importTxt(text, 'T');
		expect(book.chapters[0].titleSource).toBe('序章：楔子');
		expect(book.chapters[1].titleSource).toBe('第一章 起点——新的开始');
	});

	it('a file with no heading lines becomes one chapter titled with the fallback', () => {
		const book = importTxt(`${BODY}\n${BODY}`, 'Title');
		expect(book.chapters).toHaveLength(1);
		expect(book.chapters[0].titleSource).toBe('Title');
	});

	it('strips leading numbering from a bare heading', () => {
		const book = importTxt(`第5話 旅立ち\n${BODY}`, 'T');
		expect(book.chapters[0].titleSource).toBe('第5話 旅立ち');
	});

	it('korean markers split too (제N장 / 프롤로그)', () => {
		const text = `프롤로그\n${BODY}\n\n제2장 시작\n${BODY}\n`;
		const book = importTxt(text, 'T');
		expect(book.chapters.map((c) => c.titleSource)).toEqual(['프롤로그', '제2장 시작']);
	});

	it('empty/whitespace-only files are rejected as empty', () => {
		expect(() => importTxt('   \n\n  ', 'T')).toThrow(/empty/i);
	});
});
