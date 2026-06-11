// IMPORTED TYPES
import type { TermDraft, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { computeUsage, deepseek, hasApiKey, MODEL, queued, thinkingParam, withRetry } from './deepseek';

// -- CONSTANTS -- //

// BUMP WHEN THE PROMPT CHANGES — PARTICIPATES IN THE TRANSLATION CACHE KEY
export const PROMPT_VERSION = 'v5';

const MAX_CHARS_PER_CHUNK = 6000;

// HARD PARAGRAPH SEPARATOR — THE SOURCE PARAGRAPHS ARE JOINED BY THIS AND THE MODEL MUST REPRODUCE IT
// EXACTLY, SO THE OUTPUT SPLITS BACK INTO THE *SAME NUMBER* OF PARAGRAPHS (1:1 WITH THE SOURCE). A
// BLANK LINE IS A "SOFT" BOUNDARY THE MODEL MERGES ACROSS; THIS EXPLICIT MARKER IS NOT.
const PARA = '⟦¶⟧';
// THE MODEL OCCASIONALLY MANGLES THE BRACKETS (e.g. ⟦¶⟦ INSTEAD OF ⟦¶⟧), SO DETECT THE MARKER
// TOLERANTLY — ANCHORED ON THE PILCROW WITH ANY SURROUNDING WHITE-BRACKET NOISE. A PILCROW NEVER
// APPEARS IN NORMAL PROSE, SO THIS IS SAFE.
const PARA_RE = /[⟦⟧]*¶[⟦⟧]*/g; // A COMPLETE MARKER
const PARA_TAIL = /[⟦⟧¶]+$/; // A TRAILING RUN OF MARKER CHARS (POSSIBLE PARTIAL SPANNING TWO DELTAS)

// STABLE SYSTEM PREFIX — IDENTICAL ACROSS ALL CHAPTERS SO DEEPSEEK CACHES ITS TOKENS
const SYSTEM_PROMPT = `You are an expert literary translator of Chinese web novels (xianxia/xuanhuan).
Translate the user's Traditional Chinese text into fluent, natural English prose.
Rules:
- WARNING — MANDATORY, EXACT PARAGRAPHS: the source paragraphs are separated by the marker ${PARA}.
  Separate your translated paragraphs with that EXACT marker ${PARA} and nothing else (no blank lines).
  Output the SAME number of paragraphs as the source — never merge two paragraphs into one, never split
  one into two, and never place ${PARA} anywhere except between paragraphs. The count of ${PARA} markers
  in your output MUST equal the count in the input.
- Output ONLY the English translation — no preamble, no the original text.
- GLOSSARY: for any name/term in the glossary message, use that English rendering and keep it consistent
  throughout — but fit it naturally into the sentence's grammar (articles, plurals, possessives, tense,
  capitalization). Never insert a glossary term stiffly or ungrammatically; rephrase around it so it
  reads like natural prose. Apply each character's stated pronouns.
- WARNING — MANDATORY, COMPLETE TRANSLATION: render EVERY sentence of the source, in order. This is a
  full translation, NOT a summary. Never summarize, condense, paraphrase loosely, skip, merge, or
  abridge. Do not drop dialogue, repetition, asides, or "filler" — keep all of it. The English should
  correspond 1:1 to the source line by line and be similar in length; if your output is noticeably
  shorter than the source, you have omitted content — translate it in full instead.
- WARNING — MANDATORY, ENGLISH ONLY: the output MUST be 100% English with NO Chinese character or other
  non-Latin script anywhere. Every character, word, name, place, title, sound effect, onomatopoeia,
  interjection, unit, and idiom must be translated or transliterated into English (romanize any name
  with no glossary entry). If unsure, translate it anyway — never copy the original characters through.
  NEVER leave a Chinese character sitting in the middle of an English sentence: finish rendering the whole
  sentence in English. Before ending a sentence, make sure it contains zero Chinese characters.
- Stay accurate and faithful to the original meaning; do not invent, embellish, or add translator notes.
- You MAY use light inline emphasis to mirror emphasis in the source — markdown **bold** / *italic* or
  simple HTML <b>/<i> — but keep it minimal. Do NOT add headings, lists, code blocks, links, or any
  block-level formatting; output flowing prose paragraphs only.`;

const TITLE_SYSTEM = `You translate Chinese web-novel chapter titles into concise, natural English.
Use the glossary message's English for any of those names/terms that appear, fitting them naturally. Output ONLY the translated title — no quotes, no preamble.
MANDATORY: the result must be fully English with NO Chinese characters — translate or romanize every word, including any "第N章" chapter marker.`;

// CJK IDEOGRAPHS (incl. Ext-A, Ext-B, compatibility) — THE SIGNATURE OF A TRANSLATION THAT LEFT CHINESE
// UNTRANSLATED. PUNCTUATION/FULL-WIDTH SYMBOLS ARE INTENTIONALLY NOT FLAGGED.
const HAN_RE = /[㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2a6df}]/u;

const ZERO: TranslationUsage = { model: MODEL, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };

const REPAIR_SYSTEM = `You are fixing an English translation of a Chinese web novel in which some fragments of the original Chinese were left UNTRANSLATED or half-translated by mistake.
Rewrite the text so it is 100% fluent English: translate or romanize EVERY remaining Chinese character (personal names → pinyin with no tone marks; terms/places/titles → natural English), and repair any garbled or half-translated spot, while keeping all the already-correct English EXACTLY as it is and preserving the meaning, tone, and length.
The paragraphs are separated by the marker ${PARA}. Output the SAME number of paragraphs, separated by that EXACT marker and nothing else.
MANDATORY: the result must contain NO Chinese character anywhere. Output ONLY the corrected English prose — no preamble, no notes.`;

// -- FUNCTIONS -- //

function pronoun(gender: TermDraft['gender']): string {
	if (gender === 'masculine') return ' [he/him]';
	if (gender === 'feminine') return ' [she/her]';
	return '';
}

function glossaryBlock(terms: TermDraft[]): string | null {
	if (terms.length === 0) return null;
	const lines = terms.map((t) => `${t.raw} = ${t.translation}${pronoun(t.gender)}`);
	return (
		`Term glossary — each line is "Chinese = the English to use for it" (keep it consistent, and a ` +
		`[he/him]/[she/her] tag marks that character's pronouns). Adapt grammar naturally so each term reads ` +
		`fluently in the sentence; do NOT force a stiff, literal insertion:\n${lines.join('\n')}`
	);
}

/** TRANSLATE A SINGLE CHAPTER TITLE (SHORT, NON-STREAMED), GLOSSARY-AWARE */
export async function translateTitle(
	titleZh: string,
	terms: TermDraft[],
	signal?: AbortSignal,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	const glossary = glossaryBlock(terms);
	const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: TITLE_SYSTEM }];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: titleZh });

	const res = await queued(() =>
		withRetry(() =>
			deepseek.chat.completions.create(
				{ model: MODEL, temperature: 0.2, messages, ...thinkingParam() },
				{ signal },
			),
		),
	);
	const text = (res.choices[0]?.message?.content ?? '').trim().replace(/^["'""]|["'""]$/g, '');
	return { text, usage: computeUsage(res.usage) };
}

// GROUP WHOLE PARAGRAPHS INTO CHAR-BUDGETED CHUNKS, JOINED BY THE HARD MARKER (NOT BLANK LINES).
function chunkParagraphs(contentZh: string): string[] {
	const paras = contentZh
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (paras.length === 0) return [contentZh];
	const chunks: string[] = [];
	let cur: string[] = [];
	let curLen = 0;
	for (const p of paras) {
		if (curLen + p.length > MAX_CHARS_PER_CHUNK && cur.length > 0) {
			chunks.push(cur.join(PARA));
			cur = [];
			curLen = 0;
		}
		cur.push(p);
		curLen += p.length;
	}
	if (cur.length) chunks.push(cur.join(PARA));
	return chunks;
}

export function containsHan(s: string): boolean {
	return HAN_RE.test(s);
}

export function addUsage(a: TranslationUsage, b: TranslationUsage): TranslationUsage {
	return {
		model: b.model || a.model,
		promptTokens: a.promptTokens + b.promptTokens,
		cachedTokens: a.cachedTokens + b.cachedTokens,
		completionTokens: a.completionTokens + b.completionTokens,
		costUsd: a.costUsd + b.costUsd,
	};
}

/**
 * REPAIR A TRANSLATION THAT LEAKED UNTRANSLATED CHINESE. RE-TRANSLATES ONLY THE PARAGRAPHS THAT STILL
 * CONTAIN Han CHARACTERS (CHEAP — USUALLY 0–2), UP TO TWO PASSES, AND SPLICES THE CLEANED PARAGRAPHS
 * BACK BY INDEX. NEVER CORRUPTS ON A PARAGRAPH-COUNT MISMATCH (IT LEAVES THAT PASS'S TEXT UNCHANGED).
 */
export async function repairChineseLeak(
	paras: string[],
	terms: TermDraft[],
	signal?: AbortSignal,
): Promise<{ paras: string[]; usage: TranslationUsage; repaired: boolean }> {
	if (!paras.some(containsHan) || !hasApiKey()) return { paras, usage: ZERO, repaired: false };
	const glossary = glossaryBlock(terms);
	const work = [...paras];
	let usage: TranslationUsage = ZERO;
	let repaired = false;

	for (let attempt = 0; attempt < 2; attempt++) {
		const bad = work.map((p, i) => (containsHan(p) ? i : -1)).filter((i) => i >= 0);
		if (bad.length === 0) break;
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: REPAIR_SYSTEM }];
		if (glossary) messages.push({ role: 'system', content: glossary });
		messages.push({ role: 'user', content: bad.map((i) => work[i]).join(PARA) });

		let res;
		try {
			res = await queued(() =>
				withRetry(() =>
					deepseek.chat.completions.create(
						{ model: MODEL, temperature: 0.2, messages, ...thinkingParam() },
						{ signal },
					),
				),
			);
		} catch {
			break; // REPAIR IS BEST-EFFORT — A FAILURE LEAVES THE LAST-KNOWN TEXT, IT NEVER BLOCKS DELIVERY
		}
		usage = addUsage(usage, computeUsage(res.usage));
		const fixed = (res.choices[0]?.message?.content ?? '')
			.split(PARA_RE)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		// ONLY SPLICE WHEN THE COUNT LINES UP — A MISMATCH WOULD MIS-ALIGN PARAGRAPHS, SO SKIP IT.
		if (fixed.length !== bad.length) break;
		bad.forEach((origIdx, k) => {
			work[origIdx] = fixed[k];
		});
		repaired = true;
	}
	return { paras: work, usage, repaired };
}

/**
 * STREAM A CHAPTER TRANSLATION. CALLS onDelta WITH EACH TEXT FRAGMENT.
 * RESOLVES WITH THE FULL TEXT + SUMMED USAGE. CHUNKS LONG CHAPTERS BY PARAGRAPH,
 * REUSING THE CACHED SYSTEM+GLOSSARY PREFIX ACROSS CHUNKS.
 */
export async function translateChapterStreaming(
	contentZh: string,
	terms: TermDraft[],
	onDelta: (text: string) => void,
	signal?: AbortSignal,
	onReplace?: (fullText: string) => void,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');

	const glossary = glossaryBlock(terms);
	const chunks = chunkParagraphs(contentZh);
	const sourceParaCount = contentZh.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
	let fullRaw = ''; // RAW MODEL OUTPUT INCLUDING ⟦¶⟧ MARKERS — SPLIT AT THE END FOR EXACT PARAGRAPHS
	let pending = ''; // HELD-BACK TAIL THAT MIGHT BE A PARTIAL MARKER (SPANNING TWO DELTAS)
	let promptChars = 0; // FOR A USAGE ESTIMATE IF THE API OMITS THE FINAL usage FRAME
	let usage: TranslationUsage = { model: MODEL, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };

	// STREAM CLEAN TEXT TO THE CLIENT: SHOW THE PARAGRAPH MARKER AS A BLANK LINE, NEVER LEAK A MARKER
	// (COMPLETE OR PARTIAL), EVEN IF THE MODEL MANGLED ITS BRACKETS.
	const emit = (raw: string) => {
		let s = pending + raw;
		// HOLD BACK A TRAILING RUN OF MARKER CHARS — IT MIGHT BE AN INCOMPLETE MARKER SPANNING DELTAS.
		const tail = PARA_TAIL.exec(s);
		if (tail) {
			pending = tail[0];
			s = s.slice(0, s.length - tail[0].length);
		} else {
			pending = '';
		}
		// CONVERT EVERY COMPLETE MARKER IN THE SAFE PORTION TO A BLANK LINE.
		s = s.replace(PARA_RE, '\n\n');
		if (s) onDelta(s);
	};

	let sawUsage = false;
	for (let i = 0; i < chunks.length; i++) {
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: SYSTEM_PROMPT }];
		if (glossary) messages.push({ role: 'system', content: glossary });
		messages.push({ role: 'user', content: chunks[i] });
		promptChars += SYSTEM_PROMPT.length + (glossary?.length ?? 0) + chunks[i].length;

		// HOLD ONE CONCURRENCY SLOT FOR THE WHOLE CHUNK STREAM (withRetry GUARDS ONLY THE INITIAL CREATE
		// — A MID-STREAM FAILURE STILL PROPAGATES, SO ALREADY-EMITTED DELTAS ARE NEVER REPLAYED).
		await queued(async () => {
			const stream = await withRetry(() =>
				deepseek.chat.completions.create(
					{
						model: MODEL,
						temperature: 0.3,
						stream: true,
						stream_options: { include_usage: true },
						messages,
						...thinkingParam(),
					},
					{ signal },
				),
			);

			// A CHUNK BOUNDARY IS ALSO A PARAGRAPH BOUNDARY
			if (i > 0) {
				fullRaw += PARA;
				emit(PARA);
			}
			for await (const part of stream) {
				const delta = part.choices[0]?.delta?.content ?? '';
				if (delta) {
					fullRaw += delta;
					emit(delta);
				}
				if (part.usage) {
					usage = addUsage(usage, computeUsage(part.usage));
					sawUsage = true;
				}
			}
		});
	}

	// FLUSH ANY HELD-BACK TAIL: PARA_TAIL ONLY EVER HOLDS BACK MARKER CHARS, SO AT STREAM END A NON-EMPTY
	// `pending` IS A (PARTIAL) MARKER → DROP IT FROM THE CLIENT VIEW (THE SERVER TEXT STRIPS MARKERS TOO).
	pending = '';

	// FINAL TEXT: SPLIT ON THE MARKER (TOLERANT) → ONE PARAGRAPH PER SOURCE PARAGRAPH, JOINED BY BLANK LINES.
	let paras = fullRaw
		.split(PARA_RE)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	// SAFETY NET: THE MODEL OCCASIONALLY LEAVES CHINESE UNTRANSLATED MID-SENTENCE DESPITE THE ENGLISH-ONLY
	// RULE. DETECT ANY RESIDUAL CJK AND RE-TRANSLATE JUST THOSE PARAGRAPHS, THEN PUSH THE CLEANED FULL TEXT
	// TO THE CLIENT (onReplace) SO THE LIVE VIEW IS CORRECTED — AND IT'S THE CLEANED TEXT THAT GETS CACHED.
	if (paras.some(containsHan)) {
		const rep = await repairChineseLeak(paras, terms, signal);
		if (rep.repaired) {
			paras = rep.paras;
			usage = addUsage(usage, rep.usage);
			onReplace?.(paras.join('\n\n'));
		}
	}
	const text = paras.join('\n\n');

	// THE MODEL IS INSTRUCTED TO REPRODUCE EXACTLY ONE PARAGRAPH PER SOURCE PARAGRAPH. A MISMATCH MEANS IT
	// MERGED/SPLIT PARAGRAPHS — NOT FATAL (THE TEXT IS STILL COMPLETE), BUT WORTH SURFACING IN THE LOG SO
	// PROMPT REGRESSIONS ARE VISIBLE INSTEAD OF SILENT.
	if (sourceParaCount > 0 && paras.length !== sourceParaCount) {
		console.warn(`[translate] paragraph count drift: source=${sourceParaCount} output=${paras.length}`);
	}

	// FALLBACK USAGE: IF THE API NEVER SENT A usage FRAME (OR IT WAS DROPPED ON AN ABORTED STREAM), ESTIMATE
	// TOKENS FROM CHAR COUNTS SO WE NEVER CACHE A costUsd:0 ROW THAT UNDER-REPORTS THE METER.
	if (!sawUsage && fullRaw.length > 0) {
		usage = estimateUsage(promptChars, fullRaw.length);
	}
	return { text, usage };
}

// ROUGH TOKEN ESTIMATE FOR THE COST METER WHEN THE API OMITS usage. CJK PROMPTS ARE ≈1 TOKEN/CHAR;
// ENGLISH OUTPUT ≈1 TOKEN PER 4 CHARS. TREATS ALL PROMPT TOKENS AS CACHE MISSES (CONSERVATIVE/HIGH).
function estimateUsage(promptChars: number, completionChars: number): TranslationUsage {
	const promptTokens = Math.ceil(promptChars / 2);
	const completionTokens = Math.ceil(completionChars / 4);
	const u = computeUsage({
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens,
	} as Parameters<typeof computeUsage>[0]);
	return u;
}
