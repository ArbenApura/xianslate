// SMART CHAPTER LABELLING
// Derive the REAL chapter number from a title (e.g. 第555章 / "Chapter 555") instead of the row
// position, and recognise non-chapter entries (prologues, side stories, author notes) so the
// listing doesn't force a strict 1..N sequence. A chapter number ALWAYS wins over a "note" hint —
// so "Chapter 555 … [Requesting Monthly Tickets]" is chapter 555, not a note.

const CN_DIGIT: Record<string, number> = {
	'〇': 0,
	零: 0,
	一: 1,
	二: 2,
	兩: 2,
	两: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
};
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 萬: 10000, 万: 10000 };

/** PARSE A CHINESE NUMERAL (e.g. 五百五十五) → 555. RETURNS null IF ANY CHAR ISN'T A NUMERAL. */
function chineseToNumber(s: string): number | null {
	let total = 0;
	let current = 0;
	for (const ch of s) {
		if (ch in CN_DIGIT) {
			current = CN_DIGIT[ch];
		} else if (ch in CN_UNIT) {
			total += (current === 0 ? 1 : current) * CN_UNIT[ch];
			current = 0;
		} else {
			return null;
		}
	}
	return total + current;
}

const ZH_NUM = '〇零一二三四五六七八九十百千萬万兩两';
const ZH_CHAPTER_RE = new RegExp(`第\\s*(\\d{1,7}|[${ZH_NUM}]{1,12})\\s*[章回節节卷]`);
const EN_CHAPTER_RE = /\bchapter\s+(\d{1,7})\b/i;

// NON-CHAPTER ENTRIES — ONLY CONSULTED WHEN NO CHAPTER NUMBER IS PRESENT
const SPECIAL: { re: RegExp; tag: string }[] = [
	{ re: /楔子|序章|序言|引子/, tag: 'Prologue' },
	{ re: /\bprologue\b/i, tag: 'Prologue' },
	{ re: /尾聲|尾声|大結局|大结局|終章|终章/, tag: 'Finale' },
	{ re: /\bepilogue\b/i, tag: 'Epilogue' },
	{ re: /番外/, tag: 'Extra' },
	{ re: /\bside[\s-]?story\b|\bextra\b/i, tag: 'Extra' },
	{ re: /後記|后记|後話|后话|完本感言|感言|作者的?[話话]|上架|請假|请假|通知|公告/, tag: 'Note' },
	{ re: /author.?s?\s*note|\bafterword\b/i, tag: 'Note' },
];

export type ChapterLabel =
	| { kind: 'chapter'; number: number }
	| { kind: 'special'; tag: string }
	| { kind: 'plain' };

function numberFrom(title: string | null | undefined): number | null {
	if (!title) return null;
	const zh = ZH_CHAPTER_RE.exec(title);
	if (zh) {
		const raw = zh[1];
		const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : chineseToNumber(raw);
		if (n != null && n >= 0) return n;
	}
	const en = EN_CHAPTER_RE.exec(title);
	if (en) return parseInt(en[1], 10);
	return null;
}

function specialFrom(title: string | null | undefined): string | null {
	if (!title) return null;
	for (const s of SPECIAL) if (s.re.test(title)) return s.tag;
	return null;
}

/** SMART LABEL: A REAL CHAPTER NUMBER IF ONE IS IN THE TITLE, ELSE A SPECIAL TAG, ELSE plain. */
export function chapterLabel(titleZh: string, titleEn?: string | null): ChapterLabel {
	const n = numberFrom(titleZh) ?? numberFrom(titleEn);
	if (n != null) return { kind: 'chapter', number: n };
	const tag = specialFrom(titleZh) ?? specialFrom(titleEn);
	if (tag) return { kind: 'special', tag };
	return { kind: 'plain' };
}

const STRIP_ZH = new RegExp(`^\\s*第\\s*(?:\\d{1,7}|[${ZH_NUM}]{1,12})\\s*[章回節节卷][\\s:：、.\\-—]*`);
const STRIP_EN = /^\s*chapter\s+\d{1,7}\s*[:：.\-—]*\s*/i;

/** REMOVE A LEADING "第555章" / "Chapter 555:" PREFIX FOR DISPLAY (THE NUMBER IS SHOWN SEPARATELY). */
export function stripChapterPrefix(title: string): string {
	const out = title.replace(STRIP_ZH, '').replace(STRIP_EN, '').trim();
	return out || title;
}

// A LEADING "第N章…" / "Chapter N…" LINE (OPTIONALLY MARKDOWN "# ") IS A REDUNDANT HEADING IN THESE
// NOVELS — THE BODY NEVER REALLY OPENS THAT WAY, SO THIS SIGNAL ALONE IS ENOUGH TO CUT IT.
const HEADING_LIKE = new RegExp(
	`^\\s*#{0,6}\\s*(?:第\\s*(?:\\d{1,7}|[${ZH_NUM}]{1,12})\\s*[章回節节卷]|chapter\\s+\\d)`,
	'i',
);

function normalizeForCompare(s: string): string {
	// DROP WHITESPACE, BRACKETS, AND PUNCTUATION SO MINOR FORMATTING DIFFERENCES STILL MATCH
	return s.replace(/[\s【】[\]()（）:：、，,.。!！?？\-—~～'"“”·#*]/g, '').toLowerCase();
}

/** TRUE WHEN A BODY'S FIRST PARAGRAPH IS REALLY A REPEAT OF THE CHAPTER TITLE / A CHAPTER HEADING. */
function isTitleDuplicate(firstPara: string, title: string): boolean {
	if (HEADING_LIKE.test(firstPara)) return true; // leading "第N章…" / "Chapter N…" heading line
	const nt = normalizeForCompare(title);
	return !!nt && normalizeForCompare(firstPara) === nt; // exact title repeat without a heading marker
}

/**
 * SCRAPERS OFTEN REPEAT THE CHAPTER TITLE AS THE FIRST PARAGRAPH OF THE BODY. STRIP THAT REDUNDANT
 * LEADING LINE SO THE SOURCE (AND ITS TRANSLATION) START AT THE ACTUAL PROSE. IDEMPOTENT + SAFE:
 * ONLY REMOVES A FIRST PARAGRAPH THAT TRULY MIRRORS THE TITLE.
 */
export function stripLeadingTitle(content: string, title: string | null | undefined): string {
	if (!content) return content;
	const paras = content.split(/\n{2,}/);
	if (paras.length <= 1) return content;
	if (!isTitleDuplicate(paras[0], (title ?? '').trim())) return content;
	return paras.slice(1).join('\n\n').replace(/^\s+/, '');
}
