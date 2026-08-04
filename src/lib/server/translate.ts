// IMPORTED TYPES
import type { LangPair, TermDraft, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { getLanguage, hasSourceResidue, leakRepairApplies, type Language } from '$lib/languages';
import { computeUsage, deepseek, hasApiKey, MODEL, queued, thinkingParam, withRetry } from './deepseek';
import { normalizeBodyText } from './site-parser';

// -- CONSTANTS -- //

// BUMP WHEN THE PROMPT CHANGES — PARTICIPATES IN THE TRANSLATION CACHE KEY. v6 = LANGUAGE-PARAMETERIZED
// PROMPTS (THE DIRECTION IS NOW DATA, NOT HARDCODED zh→en). v7 = GENRE-CRAFT REWRITE (TWO-LAYER
// CRAFT + HARD-RULES PROMPT FOR HIGHER LITERARY QUALITY; ALL LOAD-BEARING CONSTRAINTS UNCHANGED OR
// STRONGER). v8 = LEAN REWRITE: THE ~5k-CHAR v7 CRAFT PROMPT RELIABLY PUSHED deepseek-v4-flash INTO A
// DEGENERATE STATE MID-GENERATION (RUN-ON WORD-SALAD / STRAY SOURCE CHARS — THE GARBAGE READERS SAW WHILE
// STREAMING). A LEANER PROMPT THAT KEEPS THE CRAFT ESSENTIALS TESTED 8/8 CLEAN WHERE v7 WAS ~3/5. v9 =
// CRAFT RESTORED (MODERATE ~2.7k-CHAR LITERARY LAYER, WELL UNDER v7's BULK) WITH EXPLICIT ANTI-CALQUE,
// NATURAL NUMERIC/LEVEL-MARKER, AND ROMANIZE-PLACE-NAME RULES — AND, CRUCIALLY, SINGLE-PASS CHUNKING (SEE
// MAX_CHARS_PER_CHUNK): A WHOLE CHAPTER NOW TRANSLATES IN ONE CALL, SO THE MODEL CAN'T RENDER A RECURRING
// UN-GLOSSARIED TERM ONE WAY IN CHUNK A AND ANOTHER WAY IN CHUNK B (e.g. 神靈 = "divine spirit" THEN "deity"
// IN THE SAME CHAPTER). VALIDATED ON LIVE FLASH: 0 DEGENERATION AT temp 0.3, glossary ADHERENCE 77/78. v10 =
// GENRE-NAMING RULES ADDED TO BOTH THE TRANSLATE *AND* EXTRACT PROMPTS SO THEY HELP EVERY BOOK/USER WITHOUT
// PER-BOOK GLOSSARY EDITS: ROMANIZE PLACE PROPER-NAMES (雲霄村 → "Yunxiao Village", NOT "Cloud Village") AND
// PUT MULTI-PART RANK/REALM/STAGE NAMES IN NATURAL ${tgt} WORD ORDER (斬二 → "Two-Severing", NOT "Severing Two").
// v11 = ROMANIZE-ONLY-NAMES: people AND place proper-names ARE ROMANIZED, BUT A RANK / GRADE / TIER / REALM /
// CULTIVATION-CONCEPT TERM IS DESCRIPTIVE AND MUST BE TRANSLATED, NEVER ROMANIZED (三清 → "Three Pure Ones"
// NOT "Sanqing"; 四御 → "Four Sovereigns" NOT "Siyu"). MIRRORED IN THE EXTRACTION PROMPT + PLACE-NAME PASS.
// v12 = NUMBERED PARAGRAPH TAGS (SEE numberedSource / parseNumbered): EACH SOURCE PARAGRAPH IS PREFIXED WITH
// ⟦¶1⟧, ⟦¶2⟧, … AND THE MODEL COPIES EACH TAG ONTO ITS TRANSLATION. THE OLD SCHEME ASKED THE MODEL TO
// REPRODUCE ONE IDENTICAL ⟦¶⟧ SEPARATOR BETWEEN EVERY PAIR — OVER 100+ SHORT PARAGRAPHS IT ALWAYS MERGED OR
// DROPPED AT LEAST ONE, AND A SINGLE DRIFT FORCED A FULL-CHAPTER RE-TRANSLATE (DOUBLING THE BILL ON EVERY
// CHAPTER). NUMBERED TAGS ARE SELF-LOCATING: A DROPPED TAG LEAVES ONE EMPTY SLOT WE REFILL IN A TINY TARGETED
// CALL, NOT A SHIFT THAT RE-TRANSLATES EVERYTHING. NOTE: ALREADY-STORED chapter.contentTarget IS SERVED AS-IS
// (THE READER FAST-PATH CHECKS IT BEFORE THE CACHE KEY), SO BUMPING THIS NEVER RE-BILLS AN EXISTING
// TRANSLATION — ONLY NEW / FORCED RUNS USE THE NEW PROMPT.
export const PROMPT_VERSION = 'v12';

// CHAR-BUDGET PER STREAMING CALL. A WHOLE CHAPTER FITS IN A SINGLE CALL (THE LIBRARY'S CHAPTERS TOP OUT NEAR
// 11k CHARS) — SINGLE-PASS IS WHAT GUARANTEES CROSS-CHUNK TERM CONSISTENCY (THE MODEL SEES ITS OWN EARLIER
// RENDERINGS INSTEAD OF RE-DECIDING THEM PER CHUNK). THIS IS ONLY AFFORDABLE BECAUSE THE NUMBERED TAGS MAKE
// 1:1 RECOVERY CHEAP — A FEW DROPPED TAGS COST A FEW TINY REFILL CALLS, NOT A WHOLE-CHAPTER RE-TRANSLATE. A
// GENUINELY HUGE CHAPTER STILL SPLITS HERE; THE SYSTEM+GLOSSARY PREFIX IS DEEPSEEK-CACHED IF A SPLIT HAPPENS.
const MAX_CHARS_PER_CHUNK = 12000;

// HARD CAP ON PARAGRAPHS PER MODEL CALL. A PATHOLOGICALLY OVER-FRAGMENTED CHAPTER (e.g. A KOREAN READER THAT
// EMITS A <br>/SPACER PER LINE — HUNDREDS OF MICRO-PARAGRAPHS IN A 7k-CHAR CHAPTER) OVERWHELMS THE 1:1
// NUMBERED-TAG SCHEME: FED 400+ TAGS THE MODEL ABANDONS PER-TAG DISCIPLINE AND REPEATS WHOLE-CHAPTER PROSE
// UNDER MANY TAGS (THE "SAME PARAGRAPH SPAMMED DOWN THE PAGE" BUG). SPLITTING SUCH A CHAPTER ACROSS SEVERAL
// SMALLER CALLS KEEPS THE PER-CALL TAG COUNT MANAGEABLE; NORMAL CHAPTERS (≤80 PARAGRAPHS) STILL GO SINGLE-PASS.
const MAX_PARAS_PER_CHUNK = 80;

// SAMPLING temperature FOR THE CHAPTER-BODY TRANSLATION (THE STREAM + ITS 1:1 REFILL). RAISED FROM 0.2 TO
// 0.3 SO THE PROSE READS LESS STATIC/ROBOTIC — MORE VARIED WORD CHOICE AND SENTENCE RHYTHM — WITHOUT THE
// SOURCE-SCRIPT LEAKS AND GLOSSARY DRIFT A HOTTER temp INTRODUCES ON FLASH (0.5 / 0.7 BOTH TESTED WORSE:
// MORE LEFTOVER 漢字 AND MORE GLOSSARY OVERRIDES). TITLE / TERM / RESIDUE-REPAIR CALLS STAY AT 0.2 — THOSE
// WANT PRECISION, NOT FLAIR.
const BODY_TEMPERATURE = 0.3;

// THE MODEL OFTEN MANGLES A MARKER'S BRACKETS INTO A LOOK-ALIKE FROM THE SAME UNICODE FAMILY — e.g. THE
// WHITE TORTOISE-SHELL BRACKET ⟬ (U+27EC) INSTEAD OF THE WHITE SQUARE ⟧ (U+27E7) — WHICH LEAKED INTO THE
// OUTPUT WHEN WE ONLY KNEW [⟦⟧]. DETECT MARKERS TOLERANTLY: ANCHOR ON THE PILCROW (NEVER IN PROSE) PLUS THE
// PARAGRAPH NUMBER, AND ACCEPT *ANY* OF THE MATHEMATICAL WHITE-BRACKET FAMILY ⟦-⟯ (U+27E6–27EF: square/angle/
// double-angle/tortoise/flattened) PLUS THE CJK WHITE SQUARE 〚〛 AROUND IT.
const MARK = '⟦-⟯〚〛'; // THE BRACKET CHARACTER CLASS (USED IN ALL MARKER REGEXES BELOW)
// A COMPLETE NUMBERED TAG WITH ITS INDEX CAPTURED (⟦¶12⟧) — DRIVES parseNumbered. GLOBAL FOR matchAll.
const NUM_RE = new RegExp(`[${MARK}]*¶(\\d+)[${MARK}]*`, 'gu');
// A COMPLETE TAG (NUMBERED *OR* LEGACY BARE ⟦¶⟧) — CONVERTED TO A BLANK LINE IN THE LIVE STREAM VIEW.
const PARA_RE = new RegExp(`[${MARK}]*¶\\d*[${MARK}]*`, 'gu');
// A TRAILING RUN THAT MIGHT BE A PARTIAL TAG SPANNING TWO DELTAS (⟦ / ⟦¶ / ⟦¶12) — HELD BACK WHILE STREAMING.
const PARA_TAIL = new RegExp(`[${MARK}¶][${MARK}¶\\d]*$`, 'u');
// A STRAY MARKER BRACKET WITH NO USABLE TAG (e.g. THE ⟬ A PAST MANGLE LEFT BEHIND) — SCRUBBED FROM THE FINAL
// PARAGRAPHS SO NONE EVER REACHES THE READER.
const STRAY_MARK = new RegExp(`[${MARK}]`, 'gu');
// SPLIT A SINGLE-PARAGRAPH REPAIR'S OUTPUT BACK APART ON ANY TAG OR BLANK LINE (THE MODEL OCCASIONALLY ADDS
// ONE EVEN THOUGH WE SENT ONE PARAGRAPH) SO repairParagraph CAN FORCE IT BACK INTO EXACTLY ONE PARAGRAPH.
const SPLIT_RE = new RegExp(`(?:[${MARK}]*¶\\d*[${MARK}]*)|\\n{2,}`, 'gu');

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
// SO THE LOAD-BEARING CONSTRAINTS (PER-PARAGRAPH ⟦¶N⟧ TAGS + EQUAL COUNT, TARGET-ONLY/ZERO-RESIDUE,
// COMPLETE 1:1, GLOSSARY CONSISTENCY + GENDER PRONOUNS) CAN'T BE ERODED BY THE ADDED STYLE GUIDANCE.
function systemPrompt(src: Language, tgt: Language): string {
	return `You are a master ${src.name}→${tgt.name} literary translator of web/light novels (cultivation, martial arts, fantasy, romance, adventure). Render the ${src.name} into immersive, idiomatic ${tgt.name} prose that reads as though a gifted ${tgt.name} genre novelist wrote it — never a stiff word-for-word gloss, never flat machine output.

CRAFT — how to make it read like real, human-written prose:
- Translate MEANING and FEELING, not words. Recast clauses, reorder phrases, and VARY sentence length and rhythm so the prose breathes — short, punchy lines for tension; longer flowing ones for description. Do this only within a paragraph (never move content across a paragraph break).
- Never produce wooden, character-by-character calques. Render cultivation realms, stages, techniques, arts, pills, artifacts, named creatures, and four-character idioms by their SENSE and FLAVOR into evocative ${tgt.name}; translate set phrases by what they mean. Render numeric or gamified markers — levels, ranks, stages, percentages — the natural ${tgt.name} way ("reached Level 8", "the eighth rank"), never as raw tokens like "lv8" or redundant stacks like "LV8 rank". Put multi-part rank, realm, stage, and title names into natural ${tgt.name} word order, not the source's literal token order (a stage literally "Sever-Two" reads as "Two-Severing", not "Severing Two"). Keep each recurring rendering consistent throughout this passage.
- A place's NAME is a name: romanize/transliterate it — do NOT translate what its characters literally mean, even when that meaning is obvious. This is essential for villages, cities, towns, and mountains (their names are proper nouns, like a person's): render "<name><place-word>" as "<romanized-name> Village/City/Mountain" — a village whose name literally means "cloud firmament" is "Yunxiao Village" (NOT "Cloud Soaring Village"); a mountain is "Ruxuan Mountain" (NOT "Enter Mystic Mountain"). ${nameRule(src, tgt)}. Use the glossary's rendering when one is given. ROMANIZE ONLY TRUE NAMES (people and places) — a rank, grade, tier, realm, or cultivation/Daoist CONCEPT term is descriptive and must be TRANSLATED, never romanized (三清 → "Three Pure Ones", NOT "Sanqing"; 四御 → "Four Sovereigns", NOT "Siyu"; a deliberately epic faction title like "Dark Heaven" is likewise translated).
- Make dialogue sound like real, living speech — give each speaker a voice and the right register, contractions and all. Convert the source's quotation brackets into ${tgt.name}'s own punctuation. Render honorifics, titles, and kinship as the natural ${tgt.name} way a person would actually be addressed, not a literal label.
- Carry the source's exact tone and register — solemn, wry, smug, tense, tender — and reach for the vivid, precise word over the flat, generic one. Convert units; render sound effects as natural ${tgt.name} sound words. Trust the ${tgt.name}; don't flatten every line into the same monotone.

RULES (mandatory — these OVERRIDE the craft guidance above):
- PARAGRAPHS: every source paragraph begins with an index tag — ⟦¶1⟧, ⟦¶2⟧, ⟦¶3⟧ and so on. Begin each translated paragraph with the SAME tag, copying its number EXACTLY, in the same order, exactly one tag per source paragraph. Translate only the text that follows a tag; never merge two tagged paragraphs under one tag, never split one paragraph across two tags, and never add, drop, or renumber a tag. Put nothing else between paragraphs — no blank lines.
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
MANDATORY: the result must contain NO ${src.name} character anywhere — confirm every sentence holds zero ${src.name} characters before finishing. Output ONLY the corrected ${tgt.name} prose as a single flowing passage — no preamble, no notes, no markers, not the original.`;
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
	// PINNED (HIGH-PRIORITY) TERMS LEAD THE LIST AND ARE STAR-MARKED SO THE MODEL TREATS THEM AS NON-NEGOTIABLE.
	// A STABLE SORT KEEPS THE first-appearance ORDER WITHIN EACH GROUP.
	const ordered = [...terms].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
	const lines = ordered.map((t) => {
		// A "— note" SUFFIX IS BACKGROUND CONTEXT FOR THE TRANSLATOR (WHO/WHAT THE TERM IS) — NOT TEXT TO EMIT.
		const ctx = t.context?.trim() ? ` — ${t.context.trim()}` : '';
		// EVERY alias FORM RENDERS TO THE SAME target, SO THE MODEL STAYS CONSISTENT WHICHEVER FORM APPEARS.
		const alias = t.aliases?.length ? ` (also: ${t.aliases.join(', ')})` : '';
		const star = t.pinned ? '★ ' : '';
		return `${star}${t.source}${alias} = ${t.target}${pronoun(t.gender)}${ctx}`;
	});
	return (
		`Term glossary — each line is "${src.name} = the ${tgt.name} to use for it" (keep it consistent, ` +
		`and a [masculine]/[feminine] tag marks that character's gender so you can choose the right pronouns). ` +
		`A leading ★ marks an especially important name you MUST render exactly as given. A "(also: …)" list gives ` +
		`other ${src.name} forms of that SAME entity — render every one of them with that single ${tgt.name} rendering. ` +
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
// API CALL AND THE NUMBERED TAGS ARE INSERTED BY US, NOT THE MODEL — SO PER-CHUNK 1:1 CONCATENATES TO
// WHOLE-CHAPTER 1:1.
function chunkParagraphs(contentSource: string): string[][] {
	// NORMALISE FIRST: DROPS LEAKED CONTROL-LABEL LINES, STRIPS ZERO-WIDTH SPACER "PARAGRAPHS", AND RE-JOINS
	// MID-SENTENCE FRAGMENTS — SO A CHAPTER STORED OVER-FRAGMENTED (BEFORE THE SCRAPER FIX) STILL FEEDS THE
	// TRANSLATOR SANE, COUNTABLE PARAGRAPHS.
	const paras = normalizeBodyText(contentSource)
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (paras.length === 0) return [];
	const chunks: string[][] = [];
	let cur: string[] = [];
	let curLen = 0;
	for (const p of paras) {
		// BREAK ON EITHER THE CHAR BUDGET OR THE PARAGRAPH-COUNT CAP — WHICHEVER HITS FIRST.
		if ((curLen + p.length > MAX_CHARS_PER_CHUNK || cur.length >= MAX_PARAS_PER_CHUNK) && cur.length > 0) {
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

// PREFIX EACH SOURCE PARAGRAPH WITH AN INDEX TAG (⟦¶1⟧, ⟦¶2⟧, …) FOR ONE MODEL CALL. THE MODEL COPIES EACH
// TAG VERBATIM ONTO ITS TRANSLATION, MAKING THE OUTPUT SELF-LOCATING: A DROPPED TAG LEAVES A SINGLE EMPTY
// SLOT WE CAN REFILL INSTEAD OF SHIFTING EVERY LATER PARAGRAPH OUT OF SYNC. NUMBERS RESTART AT 1 PER CHUNK
// (PARSING IS PER-CHUNK), KEEPING THEM SMALL.
function paraTag(n: number): string {
	return `⟦¶${n}⟧`;
}
function numberedSource(paras: string[]): string {
	return paras.map((p, i) => `${paraTag(i + 1)} ${p}`).join('\n');
}

// MAP A NUMBERED MODEL OUTPUT BACK ONTO `n` SOURCE SLOTS BY TAG INDEX. A TAG NOT EMITTED LEAVES ITS SLOT
// null (THE CALLER REFILLS IT); A DUPLICATE TAG (THE MODEL SPLIT ONE PARAGRAPH ACROSS TWO TAGS) IS REJOINED;
// AN OUT-OF-RANGE / GARBLED NUMBER IS IGNORED (ITS REAL SLOT STAYS null AND GETS REFILLED). SYNCHRONOUS — NO
// await — SO THE GLOBAL NUM_RE (VIA matchAll, WHICH CLONES IT) IS SAFE UNDER CONCURRENT CALLS.
function parseNumbered(raw: string, n: number): (string | null)[] {
	const slots: (string | null)[] = new Array(n).fill(null);
	const hits = [...raw.matchAll(NUM_RE)];
	for (let h = 0; h < hits.length; h++) {
		const num = Number(hits[h][1]);
		const start = (hits[h].index ?? 0) + hits[h][0].length;
		const endPos = h + 1 < hits.length ? (hits[h + 1].index ?? raw.length) : raw.length;
		const text = raw.slice(start, endPos).replace(STRAY_MARK, '').trim();
		if (!text || num < 1 || num > n) continue;
		const prev = slots[num - 1];
		slots[num - 1] = prev ? `${prev} ${text}`.trim() : text;
	}
	return slots;
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

// SPLIT A SINGLE-PARAGRAPH REPAIR'S RAW OUTPUT BACK APART ON ANY TAG OR BLANK LINE, SO repairParagraph CAN
// REJOIN IT INTO EXACTLY ONE PARAGRAPH. ALSO SCRUBS ANY STRAY MARKER BRACKET A MANGLE LEFT BEHIND.
function splitParas(raw: string): string[] {
	return raw
		.split(SPLIT_RE)
		.map((p) => p.replace(STRAY_MARK, '').trim())
		.filter((p) => p.length > 0);
}

// CHEAP DETECTOR FOR A DEGENERATE GENERATION: THE FLASH MODEL OCCASIONALLY COLLAPSES INTO RUN-ON WORD-SALAD
// WITH DROPPED SPACES ("buzzingOne", "outFor"). NATURAL PROSE HAS NEAR-ZERO lowercase→UPPERCASE JOINS, SO A
// HIGH DENSITY IS A RELIABLE COLLAPSE SIGNAL. USED ONLY TO REFUSE TO PERSIST / OVERWRITE WITH WORSE TEXT.
// A SECOND MODE IS REPEATED-CHARACTER TOKEN-LOOP DEGENERATION: THE MODEL GETS STUCK REPEATING ONE TOKEN
// (E.G. "winerrrrrrrrr..." WITH NEVER-ENDING "r"). NO LEGITIMATE PROSE — INCLUDING DRAMATIC ELONGATION
// ("nooo!") — HAS 50+ CONSECUTIVE IDENTICAL CHARACTERS, SO A RUN THAT LONG IS A CLEAN DEGENERACY SIGNAL.
function looksDegenerate(text: string): boolean {
	if (text.length < 200) return false;
	const joins = (text.match(/[a-z][A-Z]/g) ?? []).length;
	if ((joins / text.length) * 1000 > 2) return true;
	if (/(.)\1{49,}/.test(text)) return true;
	return false;
}

// A SECOND DEGENERACY SIGNAL — GROSS OVER-EXPANSION. WHEN THE MODEL ABANDONS THE 1:1 TAG DISCIPLINE (TYPICALLY
// OVER A HEAVILY-FRAGMENTED CHUNK) IT REPEATS WHOLE-CHAPTER PROSE UNDER MANY TAGS, SO THE PARSED CHUNK RUNS
// MANY TIMES LONGER THAN ITS SOURCE (THE OBSERVED FAILURE WAS ~70×). EVEN THE WORST LEGITIMATE EXPANSION
// (DENSE CJK → A VERBOSE TARGET) STAYS WELL UNDER 6×, SO A CHUNK PAST 6× (PLUS A FLOOR FOR TINY CHUNKS) IS
// REPETITION, NOT TRANSLATION — TREATED LIKE WORD-SALAD AND RE-TRANSLATED CLEANLY. looksDegenerate CAN'T CATCH
// THIS: VERBATIM REPETITION HAS NORMAL PROSE SPACING, SO ITS lowercase→UPPERCASE-JOIN DENSITY IS NEAR ZERO.
function looksOverExpanded(slots: (string | null)[], srcParas: string[]): boolean {
	const srcChars = srcParas.reduce((n, p) => n + p.length, 0);
	if (srcChars === 0) return false;
	const outChars = slots.reduce((n, s) => n + (s ? s.length : 0), 0);
	return outChars > srcChars * 6 + 400;
}

// RE-TRANSLATE A SINGLE PARAGRAPH, FORCING THE RESULT BACK INTO ONE PARAGRAPH (THE MODEL OCCASIONALLY SPLITS
// A LONG SENTENCE). RETURNS THE ORIGINAL UNCHANGED ON A NON-ABORT FAILURE SO THE CALLER CAN RETRY OR MOVE ON
// — DELIVERY IS NEVER BLOCKED ON A REPAIR. A DELIBERATE ABORT PROPAGATES.
async function repairParagraph(
	para: string,
	system: string,
	glossary: string | null,
	signal: AbortSignal | undefined,
	model: string,
): Promise<{ text: string; usage: TranslationUsage }> {
	const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: para });
	let res;
	try {
		res = await queued(() =>
			withRetry(() =>
				deepseek.chat.completions.create({ model, temperature: 0.2, messages, ...thinkingParam() }, { signal }),
			),
		);
	} catch (e) {
		if (signal?.aborted) throw e;
		return { text: para, usage: ZERO };
	}
	const text = splitParas(res.choices[0]?.message?.content ?? '')
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return { text: text || para, usage: computeUsage(res.usage, model) };
}

/**
 * REPAIR A TRANSLATION THAT LEAKED UNTRANSLATED SOURCE SCRIPT. RE-TRANSLATES ONLY THE PARAGRAPHS THAT
 * STILL CONTAIN SOURCE-SCRIPT RESIDUE (USUALLY 0–2, OCCASIONALLY MORE) — EACH ON ITS OWN, FORCED 1:1, SO
 * EVERY LEAK GETS A REAL REPAIR ATTEMPT AND THE CLEANED PARAGRAPHS SPLICE BACK BY INDEX. NO-OP FOR
 * DIRECTIONS WHERE RESIDUE DETECTION ISN'T MEANINGFUL (ALPHABETIC SOURCE SCRIPTS).
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
	const system = repairSystem(src, tgt);
	const work = [...paras];
	let usage: TranslationUsage = ZERO;
	let repaired = false;

	// REPAIR EACH RESIDUAL PARAGRAPH ON ITS OWN (FORCED 1:1), NOT AS ONE BATCHED CALL. THE OLD BATCH PATH
	// JOINED EVERY LEAKY PARAGRAPH WITH A MARKER AND DEMANDED THE EXACT SAME COUNT BACK — WITH SEVERAL LEAKS
	// THE MODEL RELIABLY DROPPED/MERGED A MARKER, THE COUNT MISMATCHED, AND THE WHOLE PASS BAILED, LEAVING
	// *ALL* THE RAW SOURCE SCRIPT IN PLACE FOR THE READER. A SINGLE-PARAGRAPH CALL CANNOT COUNT-MISMATCH, SO
	// EVERY LEAK GETS REPAIRED. UP TO 3 PASSES; A PARAGRAPH IS ADOPTED ONLY WHEN THE ATTEMPT ACTUALLY REMOVED
	// ITS RESIDUE (NEVER REPLACE WITH SOMETHING STILL/MORE BROKEN), ELSE IT IS RETRIED NEXT PASS.
	for (let attempt = 0; attempt < 3; attempt++) {
		const bad = work.map((p, i) => (has(p) ? i : -1)).filter((i) => i >= 0);
		if (bad.length === 0) break;
		let results: { text: string; usage: TranslationUsage }[];
		try {
			results = await Promise.all(bad.map((i) => repairParagraph(work[i], system, glossary, signal, model)));
		} catch (e) {
			// A DELIBERATE ABORT (force SUPERSEDE) MUST PROPAGATE; ANY OTHER FAILURE IS BEST-EFFORT.
			if (signal?.aborted) throw e;
			break;
		}
		bad.forEach((origIdx, k) => {
			usage = addUsage(usage, results[k].usage);
			if (results[k].text && !has(results[k].text)) {
				work[origIdx] = results[k].text;
				repaired = true;
			}
		});
	}
	return { paras: work, usage, repaired };
}

// REFILL THE EMPTY SLOTS LEFT BY DROPPED TAGS. FOR EACH GAP WE ALSO RE-TRANSLATE THE NON-MISSING PARAGRAPH
// JUST BEFORE IT — THAT NEIGHBOUR ABSORBED THE DROPPED PARAGRAPH'S TEXT (THE MODEL EMITTED BOTH UNDER ONE
// TAG), SO LEAVING IT WOULD DUPLICATE THAT TEXT. EACH REFILL IS A TINY SINGLE-PARAGRAPH CALL FORCED BACK TO
// ONE PARAGRAPH, SO THE RESULT IS EXACTLY srcParas.length PARAGRAPHS — 1:1 BY CONSTRUCTION, AT A FRACTION OF
// A WHOLE-CHAPTER RE-TRANSLATE. MUTATES `slots`.
async function fillGaps(
	slots: (string | null)[],
	srcParas: string[],
	system: string,
	glossary: string | null,
	signal: AbortSignal | undefined,
	model: string,
): Promise<{ paras: string[]; usage: TranslationUsage }> {
	const missing = new Set<number>();
	slots.forEach((s, i) => {
		if (s === null) missing.add(i);
	});
	if (missing.size === 0) return { paras: slots.map((s, i) => s ?? srcParas[i]), usage: ZERO };

	const repair = new Set<number>(missing);
	for (const i of missing) {
		for (let j = i - 1; j >= 0; j--) {
			if (!missing.has(j)) {
				repair.add(j);
				break;
			}
		}
	}
	const list = [...repair].sort((a, b) => a - b);
	let usage: TranslationUsage = ZERO;
	let results: { text: string; usage: TranslationUsage }[];
	try {
		results = await Promise.all(list.map((i) => repairParagraph(srcParas[i], system, glossary, signal, model)));
	} catch (e) {
		if (signal?.aborted) throw e;
		return { paras: slots.map((s, i) => s ?? srcParas[i]), usage };
	}
	list.forEach((i, k) => {
		slots[i] = results[k].text;
		usage = addUsage(usage, results[k].usage);
	});
	return { paras: slots.map((s, i) => s ?? srcParas[i]), usage };
}

// TRANSLATE `srcParas` AND RETURN EXACTLY srcParas.length TRANSLATED PARAGRAPHS — GUARANTEED 1:1. SENDS ONE
// NUMBERED-TAG CALL, MAPS THE OUTPUT BACK BY TAG INDEX, THEN REFILLS ANY GAP A DROPPED TAG LEFT (fillGaps).
// USED AS THE NON-STREAMED ALIGNED PATH BY realignParagraphs AND AS THE PER-CHUNK FALLBACK WHEN A STREAMED
// CHUNK COLLAPSED. NEVER FANS OUT INTO AN EXPONENTIAL DIVIDE-AND-CONQUER.
async function translateNumbered(
	srcParas: string[],
	system: string,
	glossary: string | null,
	signal: AbortSignal | undefined,
	model: string,
): Promise<{ paras: string[]; usage: TranslationUsage }> {
	const zero: TranslationUsage = { model, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };
	if (srcParas.length === 0) return { paras: [], usage: zero };

	const user = numberedSource(srcParas);
	const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
	if (glossary) messages.push({ role: 'system', content: glossary });
	messages.push({ role: 'user', content: user });

	let usage = zero;
	let raw = '';
	try {
		const res = await queued(() =>
			withRetry(() =>
				deepseek.chat.completions.create(
					{
						model,
						temperature: BODY_TEMPERATURE,
						max_tokens: Math.ceil(user.length * 2) + 256,
						messages,
						...thinkingParam(),
					},
					{ signal },
				),
			),
		);
		usage = computeUsage(res.usage, model);
		raw = res.choices[0]?.message?.content ?? '';
	} catch (e) {
		// A DELIBERATE ABORT (force SUPERSEDE) MUST PROPAGATE — RETURNING THE UNTRANSLATED SOURCE HERE WOULD
		// LET A SUPERSEDED JOB PERSIST SOURCE TEXT AS THE "TRANSLATION". ANY OTHER FAILED CALL KEEPS THE SOURCE
		// PARAGRAPHS SO THE 1:1 COUNT HOLDS (THE RESIDUE PASS AFTERWARD TRANSLATES WHAT'S LEFT BEHIND).
		if (signal?.aborted) throw e;
		return { paras: srcParas.slice(), usage };
	}

	const slots = parseNumbered(raw, srcParas.length);
	const filled = await fillGaps(slots, srcParas, system, glossary, signal, model);
	return { paras: filled.paras, usage: addUsage(usage, filled.usage) };
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
	const srcParas = normalizeBodyText(contentSource)
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
	const r = await translateNumbered(srcParas, system, glossary, signal, model);
	// translateNumbered IS 1:1 BY CONSTRUCTION; THE GUARD IS BELT-AND-SUSPENDERS BEFORE WE OVERWRITE.
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
	// SIGNALLED ONCE WHEN POST-STREAM REPAIR (GAP REFILL OR SOURCE-RESIDUE FIX) BEGINS. THOSE RUN AS
	// NON-STREAMED CALLS WITH NO DELTAS, SO THE CALLER CAN SHOW AN "ALIGNING…" STATUS INSTEAD OF LEAVING THE
	// LIVE PARAGRAPH COUNT FROZEN (e.g. 328/330) FOR THE SECOND OR TWO THE REFILL TAKES.
	onFinalize?: () => void,
): Promise<{ text: string; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');

	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const system = systemPrompt(src, tgt);
	const glossary = glossaryBlock(terms, src, tgt);
	const chunks = chunkParagraphs(contentSource);
	const sourceParaCount = chunks.reduce((n, c) => n + c.length, 0);
	const chunkRaws: string[] = []; // EACH CHUNK'S RAW MODEL OUTPUT, KEPT SEPARATE SO IT CAN BE ALIGNED 1:1 AGAINST chunks[i]
	let pending = ''; // HELD-BACK TAIL THAT MIGHT BE A PARTIAL TAG (SPANNING TWO DELTAS)
	let promptChars = 0; // FOR A USAGE ESTIMATE IF THE API OMITS THE FINAL usage FRAME
	let usage: TranslationUsage = { model, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };

	// STREAM CLEAN TEXT TO THE CLIENT: SHOW EACH PARAGRAPH TAG AS A BLANK LINE, NEVER LEAK A TAG (COMPLETE OR
	// PARTIAL), EVEN IF THE MODEL MANGLED ITS BRACKETS.
	const emit = (raw: string) => {
		let s = pending + raw;
		// HOLD BACK A TRAILING RUN OF TAG CHARS — IT MIGHT BE AN INCOMPLETE TAG SPANNING DELTAS.
		const tail = PARA_TAIL.exec(s);
		if (tail) {
			pending = tail[0];
			s = s.slice(0, s.length - tail[0].length);
		} else {
			pending = '';
		}
		// CONVERT EVERY COMPLETE TAG IN THE SAFE PORTION TO A BLANK LINE.
		s = s.replace(PARA_RE, '\n\n');
		if (s) onDelta(s);
	};

	let sawUsage = false;
	for (let i = 0; i < chunks.length; i++) {
		const chunkText = numberedSource(chunks[i]); // SOURCE PARAGRAPHS, EACH PREFIXED WITH ITS ⟦¶N⟧ TAG, FOR THIS ONE CALL
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
		if (glossary) messages.push({ role: 'system', content: glossary });
		messages.push({ role: 'user', content: chunkText });
		promptChars += system.length + (glossary?.length ?? 0) + chunkText.length;

		let raw = ''; // THIS CHUNK'S RAW OUTPUT — PARSED ON ITS OWN AGAINST chunks[i], THEN CONCATENATED ACROSS CHUNKS.
		// HOLD ONE CONCURRENCY SLOT FOR THE WHOLE CHUNK STREAM (withRetry GUARDS ONLY THE INITIAL CREATE
		// — A MID-STREAM FAILURE STILL PROPAGATES, SO ALREADY-EMITTED DELTAS ARE NEVER REPLAYED).
		await queued(async () => {
			const stream = await withRetry(() =>
				deepseek.chat.completions.create(
					{
						model,
						temperature: BODY_TEMPERATURE,
						// HARD CEILING ON THIS CHUNK'S OUTPUT SO A DEGENERATE RUN-ON CAN'T STREAM UNBOUNDED ("DOES NOT
						// STOP"). A CLEAN zh→en RENDERING IS ≈1 TOKEN PER SOURCE CHAR, SO 2× LEAVES AMPLE HEADROOM FOR
						// LEGITIMATE OUTPUT (TAGS INCLUDED) WHILE STILL CUTTING OFF A RAMBLE.
						max_tokens: Math.ceil(chunkText.length * 2) + 256,
						stream: true,
						stream_options: { include_usage: true },
						messages,
						...thinkingParam(),
					},
					{ signal },
				),
			);

			// A CHUNK BOUNDARY IS ALSO A PARAGRAPH BOUNDARY (FOR THE LIVE VIEW ONLY). DROP ANY HELD-BACK PARTIAL
			// TAG FROM THE PRIOR CHUNK FIRST SO IT NEVER GLUES ONTO THIS CHUNK'S FIRST DELTA.
			if (i > 0) {
				pending = '';
				onDelta('\n\n');
			}
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

	// FLUSH ANY HELD-BACK TAIL: PARA_TAIL ONLY EVER HOLDS BACK TAG CHARS, SO AT STREAM END A NON-EMPTY
	// `pending` IS A (PARTIAL) TAG → DROP IT FROM THE CLIENT VIEW (THE SERVER TEXT STRIPS TAGS TOO).
	pending = '';

	// EXACT 1:1 ENFORCEMENT, PER CHUNK, VIA THE NUMBERED TAGS. parseNumbered MAPS EACH ⟦¶N⟧-TAGGED OUTPUT
	// PARAGRAPH BACK TO ITS SOURCE SLOT, SO A DROPPED/MANGLED TAG LEAVES ONE EMPTY SLOT (REFILLED CHEAPLY)
	// INSTEAD OF SHIFTING EVERY LATER PARAGRAPH OUT OF SYNC. A CLEANLY-TAGGED, NON-DEGENERATE CHUNK NEEDS NO
	// EXTRA CALL AT ALL (THE COMMON CASE) — THAT IS WHAT KEEPS THE WHOLE-CHAPTER SINGLE PASS CHEAP.
	const slotsByChunk = chunkRaws.map((raw, i) => parseNumbered(raw, chunks[i].length));

	// IF ANY CHUNK HAS A GAP (DROPPED TAG) OR COLLAPSED INTO RUN-ON WORD-SALAD, THE LOOP BELOW MAKES
	// NON-STREAMED REPAIR CALLS WITH NO DELTAS — SIGNAL "ALIGNING" NOW (ONCE) SO THE UI SHOWS ACTIVE PROGRESS
	// INSTEAD OF LOOKING STUCK.
	let finalizeSignaled = false;
	const signalFinalize = () => {
		if (finalizeSignaled) return;
		finalizeSignaled = true;
		onFinalize?.();
	};
	if (
		slotsByChunk.some(
			(slots, i) =>
				slots.some((s) => s === null) || looksDegenerate(chunkRaws[i]) || looksOverExpanded(slots, chunks[i]),
		)
	) {
		signalFinalize();
	}

	let paras: string[] = [];
	let corrected = false;
	for (let i = 0; i < chunks.length; i++) {
		const srcParas = chunks[i];
		const slots = slotsByChunk[i];
		const gaps = slots.filter((s) => s === null).length;
		// EITHER COLLAPSE MODE (RUN-ON WORD-SALAD *OR* REPETITION/OVER-EXPANSION) FORCES A CLEAN RE-TRANSLATE.
		const degenerate = looksDegenerate(chunkRaws[i]) || looksOverExpanded(slots, srcParas);
		if (gaps === 0 && !degenerate) {
			// EVERY TAG SURVIVED AND THE PROSE IS CLEAN — USE THE STREAMED PARAGRAPHS AS-IS (NO EXTRA BILLING).
			paras.push(...(slots as string[]));
			continue;
		}
		if (degenerate || gaps > srcParas.length / 2) {
			// THE STREAM COLLAPSED OR LOST MOST TAGS — RE-TRANSLATE JUST THIS CHUNK CLEANLY (ONE CALL + GAP
			// REFILL), NOT THE WHOLE CHAPTER, AND NEVER THROUGH AN EXPONENTIAL DIVIDE-AND-CONQUER.
			const re = await translateNumbered(srcParas, system, glossary, signal, model);
			usage = addUsage(usage, re.usage);
			paras.push(...re.paras);
		} else {
			// ONLY A FEW TAGS DROPPED — REFILL JUST THE AFFECTED PARAGRAPHS (AND THE NEIGHBOUR THAT ABSORBED THEM).
			const gap = await fillGaps(slots, srcParas, system, glossary, signal, model);
			usage = addUsage(usage, gap.usage);
			paras.push(...gap.paras);
		}
		corrected = true;
	}
	// PUSH THE CORRECTED FULL TEXT TO THE LIVE VIEW (onReplace) SO THE READER SEES THE 1:1-ALIGNED VERSION
	// INSTEAD OF THE DRIFTED STREAM — AND IT'S THE CORRECTED TEXT THE CALLER CACHES/PERSISTS.
	if (corrected) onReplace?.(paras.join('\n\n'));

	// SAFETY NET: THE MODEL OCCASIONALLY LEAVES SOURCE SCRIPT UNTRANSLATED MID-SENTENCE DESPITE THE
	// TARGET-ONLY RULE. DETECT ANY RESIDUAL SOURCE SCRIPT AND RE-TRANSLATE JUST THOSE PARAGRAPHS (SPLICED
	// BACK BY INDEX, SO THE 1:1 COUNT IS PRESERVED), THEN PUSH THE CLEANED FULL TEXT TO THE CLIENT.
	if (paras.some((p) => hasSourceResidue(p, pair.sourceLang))) {
		signalFinalize();
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
		// ADD (NEVER OVERWRITE): A CHUNK THAT NEEDED A REFILL / RESIDUE-REPAIR ALREADY MEASURED REAL usage
		// FROM ITS NON-STREAMED CALL — REPLACING usage HERE WOULD DISCARD THAT. ESTIMATE ONLY THE STREAMED BODY.
		usage = addUsage(usage, estimateUsage(promptChars, completionChars, model));
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
