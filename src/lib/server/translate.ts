// IMPORTED TYPES
import type { LangPair, TermDraft, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { getLanguage, hasSourceResidue, leakRepairApplies, type Language } from '$lib/languages';
import { computeUsage, deepseek, hasApiKey, MODEL, queued, thinkingParam, withRetry } from './deepseek';

// -- CONSTANTS -- //

// BUMP WHEN THE PROMPT CHANGES — PARTICIPATES IN THE TRANSLATION CACHE KEY. v6 = LANGUAGE-PARAMETERIZED
// PROMPTS (THE DIRECTION IS NOW DATA, NOT HARDCODED zh→en).
export const PROMPT_VERSION = 'v6';

const MAX_CHARS_PER_CHUNK = 6000;

// HARD PARAGRAPH SEPARATOR — THE SOURCE PARAGRAPHS ARE JOINED BY THIS AND THE MODEL MUST REPRODUCE IT
// EXACTLY, SO THE OUTPUT SPLITS BACK INTO THE *SAME NUMBER* OF PARAGRAPHS (1:1 WITH THE SOURCE). A
// BLANK LINE IS A "SOFT" BOUNDARY THE MODEL MERGES ACROSS; THIS EXPLICIT MARKER IS NOT.
const PARA = '⟦¶⟧';
// THE MODEL OFTEN MANGLES THE MARKER'S BRACKETS INTO A LOOK-ALIKE FROM THE SAME UNICODE FAMILY — e.g. THE
// WHITE TORTOISE-SHELL BRACKET ⟬ (U+27EC) INSTEAD OF THE WHITE SQUARE ⟧ (U+27E7) — WHICH LEAKED INTO THE
// OUTPUT WHEN WE ONLY KNEW [⟦⟧]. DETECT THE MARKER TOLERANTLY: ANCHOR ON THE PILCROW (NEVER IN PROSE) AND
// ACCEPT *ANY* OF THE MATHEMATICAL WHITE-BRACKET FAMILY ⟦-⟯ (U+27E6–27EF: square/angle/double-angle/
// tortoise/flattened) PLUS THE CJK WHITE SQUARE 〚〛 AROUND IT.
const MARK = '⟦-⟯〚〛'; // THE BRACKET CHARACTER CLASS (USED IN ALL MARKER REGEXES BELOW)
const PARA_RE = new RegExp(`[${MARK}]*¶[${MARK}]*`, 'gu'); // A COMPLETE MARKER
const PARA_TAIL = new RegExp(`[${MARK}¶]+$`, 'u'); // A TRAILING RUN OF MARKER CHARS (PARTIAL ACROSS DELTAS)
// A STRAY MARKER BRACKET WITH NO PILCROW (e.g. THE ⟬ A PAST MANGLE LEFT BEHIND) — SCRUBBED FROM THE FINAL
// PARAGRAPHS SO NONE EVER REACHES THE READER.
const STRAY_MARK = new RegExp(`[${MARK}]`, 'gu');

// HOW NAMES WITHOUT A GLOSSARY ENTRY SHOULD BE RENDERED, PHRASED FOR THE PROMPT. ROMANIZATION ONLY
// MAKES SENSE WHEN THE TARGET IS A LATIN SCRIPT (e.g. zh→en USES PINYIN); RENDERING INTO A NON-LATIN
// TARGET (e.g. en→zh) ASKS FOR A NATURAL TRANSLITERATION IN THE TARGET'S OWN SCRIPT INSTEAD.
function nameRule(src: Language, tgt: Language): string {
	if (tgt.script === 'latin' && src.romanization) {
		return `romanize any name with no glossary entry using ${src.romanization}`;
	}
	return `render any name with no glossary entry naturally in ${tgt.name}`;
}

// STABLE SYSTEM PREFIX FOR ONE DIRECTION — IDENTICAL ACROSS ALL CHAPTERS OF A BOOK SO DEEPSEEK CACHES
// ITS TOKENS. PARAMETERIZED BY THE LANGUAGE PAIR (WAS HARDCODED CHINESE→ENGLISH).
function systemPrompt(src: Language, tgt: Language): string {
	return `You are an expert literary translator of ${src.name} web/light novels.
Translate the user's ${src.name} text into fluent, natural ${tgt.name} prose.
Rules:
- WARNING — MANDATORY, EXACT PARAGRAPHS: the source paragraphs are separated by the marker ${PARA}.
  Separate your translated paragraphs with that EXACT marker ${PARA} and nothing else (no blank lines).
  Output the SAME number of paragraphs as the source — never merge two paragraphs into one, never split
  one into two, and never place ${PARA} anywhere except between paragraphs. The count of ${PARA} markers
  in your output MUST equal the count in the input.
- Output ONLY the ${tgt.name} translation — no preamble, not the original text.
- GLOSSARY: for any name/term in the glossary message, use that ${tgt.name} rendering and keep it
  consistent throughout — but fit it naturally into the sentence's grammar (articles, plurals,
  possessives, tense, capitalization). Never insert a glossary term stiffly or ungrammatically; rephrase
  around it so it reads like natural prose. Apply each character's stated gender to pronouns.
- WARNING — MANDATORY, COMPLETE TRANSLATION: render EVERY sentence of the source, in order. This is a
  full translation, NOT a summary. Never summarize, condense, paraphrase loosely, skip, merge, or
  abridge. Do not drop dialogue, repetition, asides, or "filler" — keep all of it. The ${tgt.name} should
  correspond 1:1 to the source line by line and be similar in length; if your output is noticeably
  shorter than the source, you have omitted content — translate it in full instead.
- WARNING — MANDATORY, ${tgt.name.toUpperCase()} ONLY: the output MUST be 100% ${tgt.name} with NO
  ${src.name} characters anywhere. Every character, word, name, place, title, sound effect, onomatopoeia,
  interjection, unit, and idiom must be translated or transliterated into ${tgt.name} (${nameRule(src, tgt)}).
  If unsure, translate it anyway — never copy the original characters through. NEVER leave a ${src.name}
  character sitting in the middle of a ${tgt.name} sentence: finish rendering the whole sentence in
  ${tgt.name}. Before ending a sentence, make sure it contains zero ${src.name} characters.
- Stay accurate and faithful to the original meaning; do not invent, embellish, or add translator notes.
- You MAY use light inline emphasis to mirror emphasis in the source — markdown **bold** / *italic* or
  simple HTML <b>/<i> — but keep it minimal. Do NOT add headings, lists, code blocks, links, or any
  block-level formatting; output flowing prose paragraphs only.`;
}

function titleSystem(src: Language, tgt: Language): string {
	return `You translate ${src.name} web-novel chapter titles into concise, natural ${tgt.name}.
Use the glossary message's ${tgt.name} for any of those names/terms that appear, fitting them naturally. Output ONLY the translated title — no quotes, no preamble.
MANDATORY: the result must be fully ${tgt.name} with NO ${src.name} characters — translate or transliterate every word, including any chapter-number marker.`;
}

function termSystem(src: Language, tgt: Language): string {
	const roman =
		tgt.script === 'latin' && src.romanization
			? ` Romanize personal names with ${src.romanization}.`
			: '';
	return `You translate a single term or name from a ${src.name} web/light novel into natural ${tgt.name} for a translation glossary.
Output ONLY the ${tgt.name} rendering — no quotes, no preamble, no explanation.${roman} Translate meaningful terms by sense, concise and in Title Case for proper nouns where ${tgt.name} uses casing.
MANDATORY: the result must be fully ${tgt.name} with NO ${src.name} characters.`;
}

function repairSystem(src: Language, tgt: Language): string {
	const roman =
		tgt.script === 'latin' && src.romanization
			? `personal names → ${src.romanization}; `
			: '';
	return `You are fixing a ${tgt.name} translation of a ${src.name} web novel in which some fragments of the original ${src.name} were left UNTRANSLATED or half-translated by mistake.
Rewrite the text so it is 100% fluent ${tgt.name}: translate or transliterate EVERY remaining ${src.name} character (${roman}terms/places/titles → natural ${tgt.name}), and repair any garbled or half-translated spot, while keeping all the already-correct ${tgt.name} EXACTLY as it is and preserving the meaning, tone, and length.
The paragraphs are separated by the marker ${PARA}. Output the SAME number of paragraphs, separated by that EXACT marker and nothing else.
MANDATORY: the result must contain NO ${src.name} character anywhere. Output ONLY the corrected ${tgt.name} prose — no preamble, no notes.`;
}

const ZERO: TranslationUsage = { model: MODEL, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };

// -- FUNCTIONS -- //

// A GENDER HINT FED TO THE TRANSLATOR — THE MODEL APPLIES TARGET-LANGUAGE-APPROPRIATE PRONOUNS.
function pronoun(gender: TermDraft['gender']): string {
	if (gender === 'masculine') return ' [masculine]';
	if (gender === 'feminine') return ' [feminine]';
	return '';
}

function glossaryBlock(terms: TermDraft[], src: Language, tgt: Language): string | null {
	if (terms.length === 0) return null;
	const lines = terms.map((t) => {
		// A "— note" SUFFIX IS BACKGROUND CONTEXT FOR THE TRANSLATOR (WHO/WHAT THE TERM IS) — NOT TEXT TO EMIT.
		const ctx = t.context?.trim() ? ` — ${t.context.trim()}` : '';
		return `${t.source} = ${t.target}${pronoun(t.gender)}${ctx}`;
	});
	return (
		`Term glossary — each line is "${src.name} = the ${tgt.name} to use for it" (keep it consistent, ` +
		`and a [masculine]/[feminine] tag marks that character's gender so you can choose the right pronouns). ` +
		`An em-dash "— note" after a line is CONTEXT to help you translate that term correctly — use it to ` +
		`disambiguate, but never copy the note into your output. Adapt grammar naturally so each term reads ` +
		`fluently in the sentence; do NOT force a stiff, literal insertion:\n${lines.join('\n')}`
	);
}

/** TRANSLATE A SINGLE CHAPTER TITLE (SHORT, NON-STREAMED), GLOSSARY-AWARE */
export async function translateTitle(
	titleSource: string,
	terms: TermDraft[],
	pair: LangPair,
	signal?: AbortSignal,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const glossary = glossaryBlock(terms, src, tgt);
	const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: titleSystem(src, tgt) }];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: titleSource });

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

/**
 * TRANSLATE A SINGLE GLOSSARY TERM / NAME (SHORT, NON-STREAMED) — POWERS THE GLOSSARY "Translate" ACTION.
 * GLOSSARY-AWARE: ANY ESTABLISHED TERMS THAT APPEAR INSIDE `source` (e.g. A NAME COMPONENT ALREADY IN THE
 * DB) ARE FED AS CONTEXT SO THE NEW RENDERING STAYS CONSISTENT WITH THE BOOK'S NAMING.
 */
export async function translateTerm(
	sourceTerm: string,
	pair: LangPair,
	terms: TermDraft[] = [],
	signal?: AbortSignal,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const glossary = glossaryBlock(terms, src, tgt);
	const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: termSystem(src, tgt) }];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: sourceTerm });
	const res = await queued(() =>
		withRetry(() =>
			deepseek.chat.completions.create({ model: MODEL, temperature: 0.2, messages, ...thinkingParam() }, { signal }),
		),
	);
	const text = (res.choices[0]?.message?.content ?? '').trim().replace(/^["'""]|["'""]$/g, '');
	return { text, usage: computeUsage(res.usage) };
}

// GROUP WHOLE PARAGRAPHS INTO CHAR-BUDGETED CHUNKS, JOINED BY THE HARD MARKER (NOT BLANK LINES).
function chunkParagraphs(contentSource: string): string[] {
	const paras = contentSource
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (paras.length === 0) return [contentSource];
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

/** TRUE IF THE TEXT STILL CONTAINS UNTRANSLATED SOURCE-LANGUAGE SCRIPT (e.g. STRAY HAN IN AN ENGLISH OUTPUT) */
export function containsSourceResidue(s: string, sourceLang: string): boolean {
	return hasSourceResidue(s, sourceLang);
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
 * REPAIR A TRANSLATION THAT LEAKED UNTRANSLATED SOURCE SCRIPT. RE-TRANSLATES ONLY THE PARAGRAPHS THAT
 * STILL CONTAIN SOURCE-SCRIPT RESIDUE (CHEAP — USUALLY 0–2), UP TO TWO PASSES, AND SPLICES THE CLEANED
 * PARAGRAPHS BACK BY INDEX. NEVER CORRUPTS ON A PARAGRAPH-COUNT MISMATCH (LEAVES THAT PASS UNCHANGED).
 * NO-OP FOR DIRECTIONS WHERE RESIDUE DETECTION ISN'T MEANINGFUL (ALPHABETIC SOURCE SCRIPTS).
 */
export async function repairSourceResidue(
	paras: string[],
	terms: TermDraft[],
	pair: LangPair,
	signal?: AbortSignal,
): Promise<{ paras: string[]; usage: TranslationUsage; repaired: boolean }> {
	if (!leakRepairApplies(pair.sourceLang)) return { paras, usage: ZERO, repaired: false };
	const has = (p: string) => hasSourceResidue(p, pair.sourceLang);
	if (!paras.some(has) || !hasApiKey()) return { paras, usage: ZERO, repaired: false };
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const glossary = glossaryBlock(terms, src, tgt);
	const work = [...paras];
	let usage: TranslationUsage = ZERO;
	let repaired = false;

	for (let attempt = 0; attempt < 2; attempt++) {
		const bad = work.map((p, i) => (has(p) ? i : -1)).filter((i) => i >= 0);
		if (bad.length === 0) break;
		const messages: { role: 'system' | 'user'; content: string }[] = [
			{ role: 'system', content: repairSystem(src, tgt) },
		];
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
	contentSource: string,
	terms: TermDraft[],
	pair: LangPair,
	onDelta: (text: string) => void,
	signal?: AbortSignal,
	onReplace?: (fullText: string) => void,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');

	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const system = systemPrompt(src, tgt);
	const glossary = glossaryBlock(terms, src, tgt);
	const chunks = chunkParagraphs(contentSource);
	const sourceParaCount = contentSource.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
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
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
		if (glossary) messages.push({ role: 'system', content: glossary });
		messages.push({ role: 'user', content: chunks[i] });
		promptChars += system.length + (glossary?.length ?? 0) + chunks[i].length;

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
	// ALSO SCRUB ANY STRAY MARKER BRACKET A MANGLE LEFT BEHIND (e.g. A ⟬ THAT WASN'T ADJACENT TO THE PILCROW).
	let paras = fullRaw
		.split(PARA_RE)
		.map((p) => p.replace(STRAY_MARK, '').trim())
		.filter((p) => p.length > 0);

	// SAFETY NET: THE MODEL OCCASIONALLY LEAVES SOURCE SCRIPT UNTRANSLATED MID-SENTENCE DESPITE THE
	// TARGET-ONLY RULE. DETECT ANY RESIDUAL SOURCE SCRIPT AND RE-TRANSLATE JUST THOSE PARAGRAPHS, THEN
	// PUSH THE CLEANED FULL TEXT TO THE CLIENT (onReplace) SO THE LIVE VIEW IS CORRECTED — AND IT'S THE
	// CLEANED TEXT THAT GETS CACHED.
	if (paras.some((p) => hasSourceResidue(p, pair.sourceLang))) {
		const rep = await repairSourceResidue(paras, terms, pair, signal);
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
// LATIN OUTPUT ≈1 TOKEN PER 4 CHARS. TREATS ALL PROMPT TOKENS AS CACHE MISSES (CONSERVATIVE/HIGH).
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
