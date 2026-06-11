import type { ImportedBook } from '$lib/types';

// CHAPTER HEADING PATTERNS — CHINESE (第N章/節/回/卷...) AND ENGLISH (Chapter N), PLUS COMMON MARKERS
const HEADING =
	/^\s*(?:第\s*[0-9零一二三四五六七八九十百千万億兩两]+\s*[章節节回卷部篇集]|Chapter\s+\d+|序章|楔子|序言|尾聲|尾声|後記|后记|番外)(?:[\s：:、.\-—].*)?$/i;

function buildContent(lines: string[]): string {
	return lines
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
}

/** SPLIT A PLAIN-TEXT NOVEL INTO ORDERED CHAPTERS BY HEADING LINES */
export function importTxt(text: string, fallbackTitle: string): ImportedBook {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const chapters: { titleZh: string; contentZh: string }[] = [];

	let currentTitle: string | null = null;
	let hadHeading = false; // WHETHER THE CURRENT CHAPTER WAS OPENED BY A REAL HEADING (VS. THE FALLBACK)
	let buf: string[] = [];
	const pending: { title: string | null; hadHeading: boolean }[] = [];
	const flush = () => {
		const content = buildContent(buf);
		if (content.length > 0) {
			chapters.push({ titleZh: (currentTitle ?? fallbackTitle).trim(), contentZh: content });
			pending.push({ title: currentTitle, hadHeading });
		}
		buf = [];
	};

	for (const line of lines) {
		// A HEADING IS THE LINE *UP TO* ITS FIRST SEPARATOR (`第N章 <subtitle>`). ONLY THAT MARKER PART
		// MUST BE SHORT — A LONG SUBTITLE AFTER IT IS COMMON AND MUST NOT DISQUALIFY THE BOUNDARY.
		const trimmed = line.trim();
		const markerPart = trimmed.split(/[\s：:、.\-—]/, 1)[0];
		if (HEADING.test(line) && markerPart.length <= 20) {
			// NEW CHAPTER BOUNDARY
			flush();
			currentTitle = trimmed;
			hadHeading = true;
		} else {
			buf.push(line);
		}
	}
	flush();

	// NO HEADINGS DETECTED → ONE CHAPTER
	if (chapters.length === 0) {
		const content = buildContent(lines);
		if (!content) throw new Error('The text file appears to be empty.');
		return {
			sourceType: 'txt',
			title: fallbackTitle,
			author: null,
			chapters: [{ titleZh: fallbackTitle, contentZh: content }],
		};
	}

	// RE-NUMBER CHAPTERS THAT HAD NO REAL HEADING (THEY OTHERWISE ALL CARRY THE SAME fallbackTitle, WHICH
	// READS AS DUPLICATES IN THE TOC). CHAPTERS OPENED BY A REAL HEADING KEEP THEIR HEADING TEXT.
	chapters.forEach((c, i) => {
		if (!pending[i]?.hadHeading) c.titleZh = `第 ${i + 1} 章`;
	});

	return { sourceType: 'txt', title: fallbackTitle, author: null, chapters };
}
