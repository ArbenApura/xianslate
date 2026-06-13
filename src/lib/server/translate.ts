// IMPORTED TYPES
import type { LangPair, TermDraft, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { getLanguage, hasSourceResidue, leakRepairApplies, type Language } from '$lib/languages';
import { computeUsage, deepseek, hasApiKey, MODEL, queued, thinkingParam, withRetry } from './deepseek';

// -- CONSTANTS -- //

// BUMP WHEN THE PROMPT CHANGES — PARTICIPATES IN THE TRANSLATION CACHE KEY. v6 = LANGUAGE-PARAMETERIZED
// PROMPTS (THE DIRECTION IS NOW DATA, NOT HARDCODED zh→en). v7 = GENRE-CRAFT REWRITE (TWO-LAYER
// CRAFT + HARD-RULES PROMPT FOR HIGHER LITERARY QUALITY; ALL LOAD-BEARING CONSTRAINTS UNCHANGED OR
// STRONGER). v8 = LEAN REWRITE: THE ~5k-CHAR v7 CRAFT PROMPT RELIABLY PUSHED deepseek-v4-flash INTO A
// DEGENERATE STATE MID-GENERATION (RUN-ON WORD-SALAD / STRAY SOURCE CHARS — THE GARBAGE READERS SAW WHILE
// STREAMING). A LEANER PROMPT THAT KEEPS THE CRAFT ESSENTIALS TESTED 8/8 CLEAN WHERE v7 WAS ~3/5. NOTE:
// ALREADY-STORED chapter.contentTarget IS SERVED AS-IS (THE READER FAST-PATH CHECKS IT BEFORE THE CACHE
// KEY), SO BUMPING THIS NEVER RE-BILLS AN EXISTING TRANSLATION — ONLY NEW / FORCED RUNS USE THE NEW PROMPT.
export const PROMPT_VERSION = 'v8';

// CHAR-BUDGET PER STREAMING CALL. KEPT MODERATE SO ANY SINGLE GENERATION STAYS SHORT ENOUGH TO HOLD
// COHERENCE; THE SYSTEM+GLOSSARY PREFIX IS DEEPSEEK-CACHED ACROSS CHUNKS SO EXTRA CALLS COST LITTLE.
// (THE v8 PROMPT IS RELIABLE AT THIS SIZE; SMALLER WAS SLOWER WITHOUT HELPING.)
const MAX_CHARS_PER_CHUNK = 3500;

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
// ITS TOKENS. PARAMETERIZED BY THE LANGUAGE PAIR (WAS HARDCODED CHINESE→ENGLISH). TWO-LAYER DESIGN: A
// RICH CRAFT SECTION FOR LITERARY QUALITY, THEN HARD RULES THAT EXPLICITLY OVERRIDE CRAFT ON CONFLICT —
// SO THE LOAD-BEARING CONSTRAINTS (EXACT ${PARA} + EQUAL COUNT, TARGET-ONLY/ZERO-RESIDUE, COMPLETE 1:1,
// GLOSSARY CONSISTENCY + GENDER PRONOUNS) CAN'T BE ERODED BY THE ADDED STYLE GUIDANCE.
function systemPrompt(src: Language, tgt: Language): string {
	return `You are a master ${src.name}→${tgt.name} literary translator of web/light novels (cultivation, martial arts, fantasy, romance, adventure). Translate the user's ${src.name} text into immersive, idiomatic ${tgt.name} prose that reads as if it were written in ${tgt.name} from the start — never a stiff, literal gloss. Think in MEANING, not words: recast clauses and reorder phrases naturally, but only within a paragraph (never move content across a ${PARA}). Render cultivation realms, stages, techniques, arts, pills, and artifacts into evocative ${tgt.name} and keep each rendering consistent; translate four-character idioms and set phrases by their meaning, not character by character; make dialogue sound like real speech and convert the source's quotation brackets into ${tgt.name}'s own; render honorifics, titles, and kinship as natural ${tgt.name} forms of address; convert units and render sound effects as natural ${tgt.name} sound words. Carry the source's tone and register exactly, and choose the vivid, precise word over the flat one.

RULES (mandatory — these OVERRIDE the guidance above):
- PARAGRAPHS: the source paragraphs are separated by the EXACT marker ${PARA}. Separate your translated paragraphs with that EXACT marker ${PARA} and nothing else (never a blank line), reproducing the SAME number of paragraphs as the source.
- COMPLETE: translate every sentence of the source, in order, 1:1, at a similar length — never summarize, condense, merge, skip, or drop anything (dialogue, asides, and internal monologue included).
- ${tgt.name.toUpperCase()} ONLY: the output must be 100% ${tgt.name} with NO ${src.name} characters anywhere — translate or transliterate every name, place, title, technique, realm, honorific, sound effect, interjection, unit, and idiom (${nameRule(src, tgt)}).
- GLOSSARY: for any name or term in the glossary message, use that exact ${tgt.name} rendering and keep it consistent, bending the surrounding grammar so it reads naturally; apply each character's stated gender to the pronouns you choose.
Stay faithful to the plot and facts; do not invent, editorialize, or add notes. Output ONLY the ${tgt.name} translation — flowing prose, no preamble.`;
}
function titleSystem(src: Language, tgt: Language): string {
	return `You translate ${src.name} web-novel chapter titles into concise, natural ${tgt.name} in the voice of a polished genre translation — evocative, never a stiff literal gloss. Render four-character idioms and set phrases by their meaning and flavor, not character by character, and keep the title's tone (ominous, triumphant, wry) intact.
Use the glossary message's ${tgt.name} for any of those names or terms that appear, fitting each naturally into the title's grammar. Output ONLY the translated title — no quotes, no preamble, no commentary.
MANDATORY: the result must be fully ${tgt.name} with NO ${src.name} characters — translate or transliterate every word, including any chapter-number marker (${nameRule(src, tgt)}).`;
}

function termSystem(src: Language, tgt: Language): string {
	const roman =
		tgt.script === 'latin' && src.romanization ? ` Romanize personal names with ${src.romanization}.` : '';
	return `You translate a single term or name from a ${src.name} web/light novel into natural ${tgt.name} for a translation glossary — the exact rendering that will then be reused everywhere that term appears, so it must read smoothly INSIDE a sentence, the way a professional novelist-translator would write it, never a stiff word-for-word gloss.
Output ONLY the ${tgt.name} rendering — no quotes, no preamble, no explanation, no alternatives.${roman} Translate a meaningful descriptive term (a technique, realm, rank, honorific, sect, or item) by its SENSE, concise and evocative; render a proper NAME as a name. Convey four-character idioms or set phrases by meaning, not character by character. Use Title Case for proper nouns where ${tgt.name} uses casing. If an established-glossary message is provided, stay consistent with its wording and shared name components.
MANDATORY: the result must be fully ${tgt.name} with NO ${src.name} characters.`;
}

function repairSystem(src: Language, tgt: Language): string {
	const roman = tgt.script === 'latin' && src.romanization ? `personal names → ${src.romanization}; ` : '';
	return `You are fixing a ${tgt.name} translation of a ${src.name} web novel in which some fragments of the original ${src.name} were left UNTRANSLATED or half-translated by mistake.
Rewrite the text so it is 100% fluent, natural ${tgt.name}: translate or transliterate EVERY remaining ${src.name} character (${roman}terms, places, titles, techniques, sound effects, idioms, and units → natural idiomatic ${tgt.name}, by sense not character-by-character), and repair any garbled or half-translated spot so it reads smoothly. Keep all the already-correct ${tgt.name} EXACTLY as it is, and preserve the meaning, tone, and length — do not re-translate clean text, summarize, add, or drop anything. If a glossary message is provided, use its exact ${tgt.name} renderings and respect each character's stated gender for pronouns.
The paragraphs are separated by the marker ${PARA}. Output the SAME number of paragraphs as the input, separated by that EXACT marker ${PARA} and nothing else — no blank lines, no substitutes, never the marker inside a paragraph; the count of ${PARA} markers in your output MUST equal the count in the input.
MANDATORY: the result must contain NO ${src.name} character anywhere — confirm every sentence holds zero ${src.name} characters before finishing. Output ONLY the corrected ${tgt.name} prose — no preamble, no notes, not the original.`;
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
	model: string = MODEL,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const glossary = glossaryBlock(terms, src, tgt);
	const messages: { role: 'system' | 'user'; content: string }[] = [
		{ role: 'system', content: titleSystem(src, tgt) },
	];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: titleSource });

	const res = await queued(() =>
		withRetry(() =>
			deepseek.chat.completions.create({ model, temperature: 0.2, messages, ...thinkingParam() }, { signal }),
		),
	);
	const text = (res.choices[0]?.message?.content ?? '').trim().replace(/^["'""]|["'""]$/g, '');
	return { text, usage: computeUsage(res.usage, model) };
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
	model: string = MODEL,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const glossary = glossaryBlock(terms, src, tgt);
	const messages: { role: 'system' | 'user'; content: string }[] = [
		{ role: 'system', content: termSystem(src, tgt) },
	];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: sourceTerm });
	const res = await queued(() =>
		withRetry(() =>
			deepseek.chat.completions.create({ model, temperature: 0.2, messages, ...thinkingParam() }, { signal }),
		),
	);
	const text = (res.choices[0]?.message?.content ?? '').trim().replace(/^["'""]|["'""]$/g, '');
	return { text, usage: computeUsage(res.usage, model) };
}

// GROUP WHOLE PARAGRAPHS INTO CHAR-BUDGETED CHUNKS. EACH CHUNK IS THE *LIST* OF ITS SOURCE PARAGRAPHS (NOT A
// PRE-JOINED STRING) SO THE CALLER KNOWS EXACTLY HOW MANY PARAGRAPHS THAT CHUNK'S MODEL CALL MUST RETURN AND
// CAN ENFORCE 1:1 PER CHUNK. A MERGE/SPLIT CAN ONLY EVER HAPPEN *INSIDE* A CHUNK — EACH CHUNK IS A SEPARATE
// API CALL AND THE BOUNDARY MARKER BETWEEN CHUNKS IS INSERTED BY US, NOT THE MODEL — SO PER-CHUNK 1:1
// CONCATENATES TO WHOLE-CHAPTER 1:1.
function chunkParagraphs(contentSource: string): string[][] {
	const paras = contentSource
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (paras.length === 0) return [];
	const chunks: string[][] = [];
	let cur: string[] = [];
	let curLen = 0;
	for (const p of paras) {
		if (curLen + p.length > MAX_CHARS_PER_CHUNK && cur.length > 0) {
			chunks.push(cur);
			cur = [];
			curLen = 0;
		}
		cur.push(p);
		curLen += p.length;
	}
	if (cur.length) chunks.push(cur);
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

// SPLIT RAW MODEL OUTPUT INTO PARAGRAPHS ON THE ${PARA} MARKER *OR* A BLANK LINE. THE MODEL OFTEN DROPS THE
// MARKER UNDER THE LONG CRAFT PROMPT AND SEPARATES WITH BLANK LINES INSTEAD; ACCEPTING BOTH KEEPS THE COUNT
// 1:1 WITH THE SOURCE (CHUNK BOUNDARIES ALSO INSERT THE MARKER), WHICH AVOIDS A NEEDLESS — AND SOMETIMES
// DEGENERATE — WHOLE-CHAPTER REALIGN. ALSO SCRUBS ANY STRAY MARKER BRACKET A MANGLE LEFT BEHIND.
const SPLIT_RE = new RegExp(`(?:[${MARK}]*¶[${MARK}]*)|\\n{2,}`, 'gu');
function splitParas(raw: string): string[] {
	return raw
		.split(SPLIT_RE)
		.map((p) => p.replace(STRAY_MARK, '').trim())
		.filter((p) => p.length > 0);
}

// CHEAP DETECTOR FOR A DEGENERATE GENERATION: THE FLASH MODEL OCCASIONALLY COLLAPSES INTO RUN-ON WORD-SALAD
// WITH DROPPED SPACES ("buzzingOne", "outFor"). NATURAL PROSE HAS NEAR-ZERO lowercase→UPPERCASE JOINS, SO A
// HIGH DENSITY IS A RELIABLE COLLAPSE SIGNAL. USED ONLY TO REFUSE TO PERSIST / OVERWRITE WITH WORSE TEXT.
function looksDegenerate(text: string): boolean {
	if (text.length < 200) return false;
	const joins = (text.match(/[a-z][A-Z]/g) ?? []).length;
	return (joins / text.length) * 1000 > 2;
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
	model: string = MODEL,
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
						{ model, temperature: 0.2, messages, ...thinkingParam() },
						{ signal },
					),
				),
			);
		} catch {
			break; // REPAIR IS BEST-EFFORT — A FAILURE LEAVES THE LAST-KNOWN TEXT, IT NEVER BLOCKS DELIVERY
		}
		usage = addUsage(usage, computeUsage(res.usage, model));
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

// TRANSLATE `srcParas` AND RETURN EXACTLY srcParas.length TRANSLATED PARAGRAPHS — GUARANTEED 1:1. THE MODEL
// SOMETIMES MERGES A SHORT PARAGRAPH INTO ITS NEIGHBOUR (OR SPLITS A LONG ONE) DESPITE THE EXACT-MARKER
// RULE, WHICH SHIFTS EVERY LATER PARAGRAPH OUT OF SYNC WITH THE SOURCE. WHEN A BATCH COMES BACK WITH THE
// WRONG COUNT WE DIVIDE AND CONQUER: SPLIT THE PARAGRAPHS IN HALF AND RECURSE UNTIL EACH PIECE ALIGNS,
// BOTTOMING OUT AT A SINGLE SOURCE PARAGRAPH (WHOSE TRANSLATION IS FORCED BACK INTO ONE). EVERY LEAF IS
// 1:1, SO THE CONCATENATION IS 1:1 NO MATTER HOW THE MODEL MISBEHAVED.
async function translateAligned(
	srcParas: string[],
	system: string,
	glossary: string | null,
	pair: LangPair,
	signal: AbortSignal | undefined,
	model: string,
): Promise<{ paras: string[]; usage: TranslationUsage }> {
	const zero: TranslationUsage = { model, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };
	if (srcParas.length === 0) return { paras: [], usage: zero };

	const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: srcParas.join(PARA) });

	let usage = zero;
	let out: string[] = [];
	try {
		const res = await queued(() =>
			withRetry(() =>
				deepseek.chat.completions.create({ model, temperature: 0.2, messages, ...thinkingParam() }, { signal }),
			),
		);
		usage = computeUsage(res.usage, model);
		out = splitParas(res.choices[0]?.message?.content ?? '');
	} catch {
		// A FAILED BATCH CAN'T BE ALIGNED — KEEP THE SOURCE PARAGRAPHS SO THE 1:1 COUNT HOLDS (THE RESIDUE
		// PASS THAT RUNS AFTERWARD TRANSLATES ANY SOURCE SCRIPT LEFT BEHIND).
		return { paras: srcParas.slice(), usage };
	}

	if (out.length === srcParas.length) return { paras: out, usage };
	if (srcParas.length === 1) {
		// THE MODEL SPLIT ONE SOURCE PARAGRAPH INTO SEVERAL — REJOIN SO THE COUNT IS EXACTLY ONE.
		const joined = out.join(' ').replace(/\s+/g, ' ').trim();
		return { paras: [joined || srcParas[0]], usage };
	}

	// COUNT DRIFTED ON A MULTI-PARAGRAPH BATCH — SPLIT AND RECURSE UNTIL EACH HALF ALIGNS.
	const mid = Math.ceil(srcParas.length / 2);
	const a = await translateAligned(srcParas.slice(0, mid), system, glossary, pair, signal, model);
	const b = await translateAligned(srcParas.slice(mid), system, glossary, pair, signal, model);
	return { paras: [...a.paras, ...b.paras], usage: addUsage(addUsage(usage, a.usage), b.usage) };
}

/**
 * REPAIR PARAGRAPH-COUNT DRIFT: RE-TRANSLATE `contentSource` SO THE RESULT HAS EXACTLY ONE PARAGRAPH PER
 * SOURCE PARAGRAPH (1:1). NO-OP WHEN THE COUNT ALREADY MATCHES OR THERE'S NO API KEY. USED BOTH AS A
 * POST-STREAM SAFETY NET AND TO SELF-HEAL A LEGACY STORED TRANSLATION WHOSE PARAGRAPHS DRIFTED.
 */
export async function realignParagraphs(
	contentSource: string,
	currentParas: string[],
	terms: TermDraft[],
	pair: LangPair,
	signal?: AbortSignal,
	model: string = MODEL,
): Promise<{ paras: string[]; usage: TranslationUsage; realigned: boolean }> {
	const srcParas = contentSource
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (srcParas.length === 0 || srcParas.length === currentParas.length || !hasApiKey()) {
		return { paras: currentParas, usage: ZERO, realigned: false };
	}
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const system = systemPrompt(src, tgt);
	const glossary = glossaryBlock(terms, src, tgt);
	const r = await translateAligned(srcParas, system, glossary, pair, signal, model);
	// translateAligned IS 1:1 BY CONSTRUCTION; THE GUARD IS BELT-AND-SUSPENDERS BEFORE WE OVERWRITE.
	const realigned = r.paras.length === srcParas.length;
	return { paras: realigned ? r.paras : currentParas, usage: r.usage, realigned };
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
	model: string = MODEL,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');

	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const system = systemPrompt(src, tgt);
	const glossary = glossaryBlock(terms, src, tgt);
	const chunks = chunkParagraphs(contentSource);
	const sourceParaCount = chunks.reduce((n, c) => n + c.length, 0);
	const chunkRaws: string[] = []; // EACH CHUNK'S RAW MODEL OUTPUT, KEPT SEPARATE SO IT CAN BE ALIGNED 1:1 AGAINST chunks[i]
	let pending = ''; // HELD-BACK TAIL THAT MIGHT BE A PARTIAL MARKER (SPANNING TWO DELTAS)
	let promptChars = 0; // FOR A USAGE ESTIMATE IF THE API OMITS THE FINAL usage FRAME
	let usage: TranslationUsage = { model, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };

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
		const chunkText = chunks[i].join(PARA); // SOURCE PARAGRAPHS JOINED BY THE HARD MARKER FOR THIS ONE CALL
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
		if (glossary) messages.push({ role: 'system', content: glossary });
		messages.push({ role: 'user', content: chunkText });
		promptChars += system.length + (glossary?.length ?? 0) + chunkText.length;

		let raw = ''; // THIS CHUNK'S RAW OUTPUT — THE CHUNK-BOUNDARY MARKER IS *NOT* STORED HERE (PARAGRAPHS ARE
		// CONCATENATED ACROSS CHUNKS AT THE END), SO `raw` SPLITS CLEANLY INTO EXACTLY THIS CHUNK'S PARAGRAPHS.
		// HOLD ONE CONCURRENCY SLOT FOR THE WHOLE CHUNK STREAM (withRetry GUARDS ONLY THE INITIAL CREATE
		// — A MID-STREAM FAILURE STILL PROPAGATES, SO ALREADY-EMITTED DELTAS ARE NEVER REPLAYED).
		await queued(async () => {
			const stream = await withRetry(() =>
				deepseek.chat.completions.create(
					{
						model,
						temperature: 0.2,
						// HARD CEILING ON THIS CHUNK'S OUTPUT SO A DEGENERATE RUN-ON CAN'T STREAM UNBOUNDED ("DOES NOT
						// STOP"). A CLEAN zh→en RENDERING IS ≈1 TOKEN PER SOURCE CHAR, SO 2× LEAVES AMPLE HEADROOM FOR
						// LEGITIMATE OUTPUT WHILE STILL CUTTING OFF A RAMBLE.
						max_tokens: Math.ceil(chunkText.length * 2) + 256,
						stream: true,
						stream_options: { include_usage: true },
						messages,
						...thinkingParam(),
					},
					{ signal },
				),
			);

			// A CHUNK BOUNDARY IS ALSO A PARAGRAPH BOUNDARY (FOR THE LIVE VIEW ONLY — emit, NOT raw).
			if (i > 0) emit(PARA);
			for await (const part of stream) {
				const delta = part.choices[0]?.delta?.content ?? '';
				if (delta) {
					raw += delta;
					emit(delta);
				}
				if (part.usage) {
					usage = addUsage(usage, computeUsage(part.usage, model));
					sawUsage = true;
				}
			}
		});
		chunkRaws.push(raw);
	}

	// FLUSH ANY HELD-BACK TAIL: PARA_TAIL ONLY EVER HOLDS BACK MARKER CHARS, SO AT STREAM END A NON-EMPTY
	// `pending` IS A (PARTIAL) MARKER → DROP IT FROM THE CLIENT VIEW (THE SERVER TEXT STRIPS MARKERS TOO).
	pending = '';

	// EXACT 1:1 ENFORCEMENT, PER CHUNK. EACH CHUNK MUST COME BACK AS EXACTLY chunks[i].length PARAGRAPHS. IF
	// THE STREAMED OUTPUT DRIFTED (THE MODEL MERGED/SPLIT DESPITE THE EXACT-MARKER RULE) OR COLLAPSED INTO
	// RUN-ON WORD-SALAD, RE-TRANSLATE *ONLY THAT CHUNK* THROUGH THE DIVIDE-AND-CONQUER ALIGNED PATH — 1:1 BY
	// CONSTRUCTION AND CHEAP (ONE CHUNK IS ≤MAX_CHARS_PER_CHUNK, NOT THE WHOLE CHAPTER). A MERGE/SPLIT CANNOT
	// CROSS A CHUNK BOUNDARY (SEPARATE CALLS, OUR MARKER), SO PER-CHUNK 1:1 ⇒ WHOLE-CHAPTER 1:1 WITH THE SOURCE.
	let paras: string[] = [];
	let corrected = false;
	for (let i = 0; i < chunks.length; i++) {
		const srcParas = chunks[i];
		// SPLIT ON THE MARKER, OR ON BLANK LINES WHEN THE MODEL DROPPED THE MARKER (splitParas) — THE BLANK-LINE
		// FALLBACK IS WHAT KEEPS A MARKER-LESS-BUT-OTHERWISE-CLEAN CHUNK 1:1 WITHOUT A NEEDLESS RE-TRANSLATE.
		const streamParas = splitParas(chunkRaws[i]);
		const countOk = streamParas.length === srcParas.length;
		const degenerate = looksDegenerate(chunkRaws[i]);
		if (countOk && !degenerate) {
			paras.push(...streamParas);
			continue;
		}
		const re = await translateAligned(srcParas, system, glossary, pair, signal, model);
		usage = addUsage(usage, re.usage);
		// translateAligned IS 1:1 BY CONSTRUCTION; PREFER IT — EXCEPT THE ONE CASE WHERE THE STREAM WAS ALREADY
		// 1:1 (ONLY *LOOKED* DEGENERATE) AND THE RE-TRANSLATE CAME BACK DEGENERATE TOO (NEVER REPLACE WITH WORSE).
		if (re.paras.length === srcParas.length && !(countOk && looksDegenerate(re.paras.join('\n\n')))) {
			paras.push(...re.paras);
			corrected = true;
		} else {
			paras.push(...streamParas);
		}
	}
	// PUSH THE CORRECTED FULL TEXT TO THE LIVE VIEW (onReplace) SO THE READER SEES THE 1:1-ALIGNED VERSION
	// INSTEAD OF THE DRIFTED STREAM — AND IT'S THE CORRECTED TEXT THE CALLER CACHES/PERSISTS.
	if (corrected) onReplace?.(paras.join('\n\n'));

	// SAFETY NET: THE MODEL OCCASIONALLY LEAVES SOURCE SCRIPT UNTRANSLATED MID-SENTENCE DESPITE THE
	// TARGET-ONLY RULE. DETECT ANY RESIDUAL SOURCE SCRIPT AND RE-TRANSLATE JUST THOSE PARAGRAPHS (SPLICED
	// BACK BY INDEX, SO THE 1:1 COUNT IS PRESERVED), THEN PUSH THE CLEANED FULL TEXT TO THE CLIENT.
	if (paras.some((p) => hasSourceResidue(p, pair.sourceLang))) {
		const rep = await repairSourceResidue(paras, terms, pair, signal, model);
		if (rep.repaired) {
			paras = rep.paras;
			usage = addUsage(usage, rep.usage);
			onReplace?.(paras.join('\n\n'));
		}
	}
	const text = paras.join('\n\n');

	// INVARIANT: PER-CHUNK ALIGNMENT GUARANTEES paras.length === sourceParaCount. LOG IF IT EVER DOESN'T SO A
	// REGRESSION IN THE ALIGNMENT PATH IS VISIBLE INSTEAD OF SILENT (SHOULD NEVER FIRE IN NORMAL OPERATION).
	if (sourceParaCount > 0 && paras.length !== sourceParaCount) {
		console.warn(
			`[translate] paragraph count drift after alignment: source=${sourceParaCount} output=${paras.length}`,
		);
	}

	// FALLBACK USAGE: IF THE API NEVER SENT A usage FRAME (OR IT WAS DROPPED ON AN ABORTED STREAM), ESTIMATE
	// TOKENS FROM CHAR COUNTS SO WE NEVER CACHE A costUsd:0 ROW THAT UNDER-REPORTS THE METER.
	const completionChars = chunkRaws.reduce((n, r) => n + r.length, 0);
	if (!sawUsage && completionChars > 0) {
		usage = estimateUsage(promptChars, completionChars, model);
	}
	return { text, usage };
}

// ROUGH TOKEN ESTIMATE FOR THE COST METER WHEN THE API OMITS usage. CJK PROMPTS ARE ≈1 TOKEN/CHAR;
// LATIN OUTPUT ≈1 TOKEN PER 4 CHARS. TREATS ALL PROMPT TOKENS AS CACHE MISSES (CONSERVATIVE/HIGH).
function estimateUsage(promptChars: number, completionChars: number, model: string = MODEL): TranslationUsage {
	const promptTokens = Math.ceil(promptChars / 2);
	const completionTokens = Math.ceil(completionChars / 4);
	const u = computeUsage(
		{
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
		} as Parameters<typeof computeUsage>[0],
		model,
	);
	return u;
}
