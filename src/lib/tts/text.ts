// TTS TEXT MODEL
// TURNS A TRANSLATED PARAGRAPH (WHICH MAY CARRY THE SMALL INLINE-MARKUP WHITELIST FROM markup.ts)
// INTO THE TWO VIEWS THE SPEECH ENGINE + THE HIGHLIGHTER BOTH NEED, DERIVED FROM THE SAME SOURCE SO
// THEIR CHARACTER OFFSETS LINE UP EXACTLY:
//   - PLAIN TEXT  — WHAT WE FEED SpeechSynthesis (NO TAGS, ENTITIES DECODED). OFFSETS HERE ARE THE
//     UNIT THE BOUNDARY EVENTS + SENTENCE RANGES SPEAK IN.
//   - TOKENS      — THE SAME TEXT SPLIT INTO WORD/SPACE SPANS (EACH CARRYING THE INLINE TAGS ACTIVE
//     OVER IT) SO THE READER CAN WRAP INDIVIDUAL WORDS FOR HIGHLIGHTING WITHOUT BREAKING TAG NESTING.
//
// BOTH ARE COMPUTED BY RUNNING renderMarkup() FIRST, THEN PARSING THAT HTML BACK INTO RUNS. BECAUSE
// renderMarkup STRIPS THE MARKDOWN DELIMITERS (**, *, `) INTO REAL TAGS, THE RESULTING PLAIN TEXT IS
// EXACTLY THE SPOKEN TEXT, AND TAG BOUNDARIES NEVER COUNT TOWARD AN OFFSET.

// IMPORTED MODULES
import { renderMarkup } from '$lib/markup';

// -- TYPES -- //

/** A STRETCH OF PLAIN TEXT WITH THE SET OF INLINE TAGS ACTIVE OVER IT. */
export interface Run {
	text: string;
	tags: string[];
}

/** A WORD OR WHITESPACE SPAN, WITH ITS PLAIN-TEXT OFFSET RANGE AND ACTIVE TAGS. */
export interface Token {
	text: string;
	start: number;
	end: number;
	tags: string[];
	isWord: boolean;
	isBreak: boolean;
}

/** A SENTENCE AS A HALF-OPEN [start, end) RANGE OVER THE PARAGRAPH'S PLAIN TEXT. */
export interface Sentence {
	start: number;
	end: number;
}

// -- CONSTANTS -- //

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

// INLINE TAGS renderMarkup CAN EMIT (markup.ts ALLOWED LIST) — ANYTHING ELSE IS TREATED AS PLAIN TEXT.
const KNOWN_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'sub', 'sup', 'code', 'br']);

const SENTENCE_ENDERS = '.!?。！？…';

const TRAILERS = '"\'”’」』）)]》>';

// -- FUNCTIONS -- //

/** PARSE renderMarkup() HTML INTO PLAIN-TEXT RUNS, TRACKING THE INLINE TAGS ACTIVE OVER EACH RUN. */
export function parseRuns(html: string): Run[] {
	const runs: Run[] = [];
	const stack: string[] = [];
	let buf = '';
	let i = 0;

	const flush = () => {
		if (buf) runs.push({ text: buf, tags: stack.slice() });
		buf = '';
	};

	while (i < html.length) {
		const c = html[i];
		if (c === '<') {
			const isClose = html[i + 1] === '/';
			const nameStart = i + (isClose ? 2 : 1);
			let j = nameStart;
			while (j < html.length && html[j] !== '>') j++;
			const tag = html.slice(nameStart, j).trim().replace(/\/$/, '').toLowerCase();
			if (KNOWN_TAGS.has(tag)) {
				flush();
				if (tag === 'br') {
					// A HARD BREAK — A SINGLE NEWLINE SO IT BOTH SPEAKS AS A PAUSE AND TOKENIZES AS A <br>.
					runs.push({ text: '\n', tags: stack.slice() });
				} else if (isClose) {
					const idx = stack.lastIndexOf(tag);
					if (idx !== -1) stack.splice(idx, 1);
				} else {
					stack.push(tag);
				}
				i = j + 1;
			} else {
				// NOT ONE OF OURS (SHOULDN'T HAPPEN WITH renderMarkup OUTPUT) — KEEP THE LITERAL CHAR.
				buf += c;
				i++;
			}
		} else if (c === '&') {
			let j = i + 1;
			while (j < html.length && html[j] !== ';' && j - i <= 10) j++;
			if (html[j] === ';') {
				const ent = html.slice(i + 1, j);
				buf += ENTITY[ent] ?? `&${ent};`;
				i = j + 1;
			} else {
				buf += '&';
				i++;
			}
		} else {
			buf += c;
			i++;
		}
	}
	flush();
	return runs;
}

/** CONCATENATE RUNS BACK INTO THE PLAIN SPOKEN TEXT. */
export function runsToPlain(runs: Run[]): string {
	let s = '';
	for (const r of runs) s += r.text;
	return s;
}

/** SPLIT RUNS INTO WORD/WHITESPACE/BREAK TOKENS CARRYING PLAIN-TEXT OFFSETS AND INLINE TAGS. */
export function tokenize(runs: Run[]): Token[] {
	const tokens: Token[] = [];
	let off = 0;
	for (const run of runs) {
		// KEEP WHITESPACE AS ITS OWN PIECES SO LAYOUT MATCHES AND SENTENCE HIGHLIGHT STAYS CONTINUOUS.
		for (const part of run.text.split(/(\s+)/)) {
			if (part === '') continue;
			const start = off;
			const end = off + part.length;
			const ws = /^\s+$/.test(part);
			tokens.push({
				text: part,
				start,
				end,
				tags: run.tags,
				isWord: !ws,
				isBreak: part.includes('\n'),
			});
			off = end;
		}
	}
	return tokens;
}

/**
 * SPLIT PLAIN TEXT INTO SENTENCE RANGES. HANDLES BOTH LATIN (. ! ?) AND CJK (。！？) TERMINATORS,
 * KEEPS TRAILING QUOTES/BRACKETS WITH THE SENTENCE, BREAKS ON HARD NEWLINES, AND AVOIDS SPLITTING
 * DECIMALS LIKE "3.14" OR SINGLE-LETTER ABBREVIATIONS.
 */
export function splitSentences(plain: string): Sentence[] {
	const out: Sentence[] = [];
	let start = 0;
	let i = 0;
	const push = (end: number) => {
		// TRIM LEADING WHITESPACE OFF THE RECORDED RANGE SO OFFSETS LAND ON REAL TEXT.
		let s = start;
		while (s < end && /\s/.test(plain[s])) s++;
		if (end > s) out.push({ start: s, end });
	};
	while (i < plain.length) {
		const ch = plain[i];
		if (ch === '\n') {
			push(i);
			i++;
			while (i < plain.length && /\s/.test(plain[i])) i++;
			start = i;
			continue;
		}
		if (SENTENCE_ENDERS.includes(ch)) {
			// DON'T SPLIT A DECIMAL POINT SITTING BETWEEN TWO DIGITS.
			if (ch === '.' && /\d/.test(plain[i - 1] ?? '') && /\d/.test(plain[i + 1] ?? '')) {
				i++;
				continue;
			}
			let j = i + 1;
			// ABSORB RUNS OF ENDERS (?!, …) AND ANY TRAILING CLOSING QUOTES/BRACKETS.
			while (j < plain.length && (SENTENCE_ENDERS.includes(plain[j]) || TRAILERS.includes(plain[j]))) j++;
			push(j);
			while (j < plain.length && /\s/.test(plain[j])) j++;
			start = j;
			i = j;
			continue;
		}
		i++;
	}
	if (start < plain.length) push(plain.length);
	return out;
}

/** BUILD THE FULL SPEECH MODEL FOR ONE PARAGRAPH: RUNS, PLAIN TEXT, AND SENTENCE RANGES. */
export function analyzeParagraph(p: string): { runs: Run[]; plain: string; sentences: Sentence[] } {
	const runs = parseRuns(renderMarkup(p));
	const plain = runsToPlain(runs);
	return { runs, plain, sentences: splitSentences(plain) };
}
