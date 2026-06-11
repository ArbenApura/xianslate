// TTS TEXT MODEL
// Turns a translated paragraph (which may carry the small inline-markup whitelist from markup.ts)
// into the two views the speech engine + the highlighter both need, derived from the SAME source so
// their character offsets line up exactly:
//   • PLAIN TEXT  — what we feed SpeechSynthesis (no tags, entities decoded). Offsets here are the
//     unit the boundary events + sentence ranges speak in.
//   • TOKENS      — the same text split into word/space spans (each carrying the inline tags active
//     over it) so the reader can wrap individual words for highlighting without breaking tag nesting.
//
// Both are computed by running renderMarkup() first, then parsing that HTML back into runs. Because
// renderMarkup strips the markdown delimiters (**, *, `) into real tags, the resulting plain text is
// exactly the spoken text, and tag boundaries never count toward an offset.

import { renderMarkup } from '$lib/markup';

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

// INLINE TAGS renderMarkup CAN EMIT (markup.ts ALLOWED list) — anything else is treated as plain text.
const KNOWN_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'sub', 'sup', 'code', 'br']);

/** A stretch of plain text with the set of inline tags active over it. */
export interface Run {
	text: string;
	tags: string[];
}

/** A word or whitespace span, with its plain-text offset range and active tags. */
export interface Token {
	text: string;
	start: number;
	end: number;
	tags: string[];
	isWord: boolean;
	isBreak: boolean;
}

/** A sentence as a half-open [start, end) range over the paragraph's plain text. */
export interface Sentence {
	start: number;
	end: number;
}

/** Parse renderMarkup() HTML into plain-text runs, tracking the inline tags active over each run. */
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
			const tag = html
				.slice(nameStart, j)
				.trim()
				.replace(/\/$/, '')
				.toLowerCase();
			if (KNOWN_TAGS.has(tag)) {
				flush();
				if (tag === 'br') {
					// A hard break — a single newline so it both speaks as a pause and tokenizes as a <br>.
					runs.push({ text: '\n', tags: stack.slice() });
				} else if (isClose) {
					const idx = stack.lastIndexOf(tag);
					if (idx !== -1) stack.splice(idx, 1);
				} else {
					stack.push(tag);
				}
				i = j + 1;
			} else {
				// Not one of ours (shouldn't happen with renderMarkup output) — keep the literal char.
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

/** Concatenate runs back into the plain spoken text. */
export function runsToPlain(runs: Run[]): string {
	let s = '';
	for (const r of runs) s += r.text;
	return s;
}

/** Convenience: paragraph source → plain spoken text. */
export function paragraphToPlain(p: string): string {
	return runsToPlain(parseRuns(renderMarkup(p)));
}

/** Split runs into word/whitespace/break tokens carrying plain-text offsets and inline tags. */
export function tokenize(runs: Run[]): Token[] {
	const tokens: Token[] = [];
	let off = 0;
	for (const run of runs) {
		// Keep whitespace as its own pieces so layout matches and sentence highlight stays continuous.
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

const SENTENCE_ENDERS = '.!?。！？…';
const TRAILERS = '"\'”’」』）)]》>';

/**
 * Split plain text into sentence ranges. Handles both Latin (. ! ?) and CJK (。！？) terminators,
 * keeps trailing quotes/brackets with the sentence, breaks on hard newlines, and avoids splitting
 * decimals like "3.14" or single-letter abbreviations.
 */
export function splitSentences(plain: string): Sentence[] {
	const out: Sentence[] = [];
	let start = 0;
	let i = 0;
	const push = (end: number) => {
		// Trim leading whitespace off the recorded range so offsets land on real text.
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
			// Don't split a decimal point sitting between two digits.
			if (ch === '.' && /\d/.test(plain[i - 1] ?? '') && /\d/.test(plain[i + 1] ?? '')) {
				i++;
				continue;
			}
			let j = i + 1;
			// Absorb runs of enders (?!, …) and any trailing closing quotes/brackets.
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

/** Build the full speech model for one paragraph: runs, plain text, and sentence ranges. */
export function analyzeParagraph(p: string): { runs: Run[]; plain: string; sentences: Sentence[] } {
	const runs = parseRuns(renderMarkup(p));
	const plain = runsToPlain(runs);
	return { runs, plain, sentences: splitSentences(plain) };
}
