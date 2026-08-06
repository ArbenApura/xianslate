// IMPORTED DEP-TYPES
import type { Column } from 'drizzle-orm';
// IMPORTED TYPES
import type {
	Gender,
	GlossaryRow,
	GlossaryScope,
	LangPair,
	TermCategory,
	TermDraft,
	TranslationUsage,
} from '$lib/types';
// IMPORTED DEP-MODULES
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { TERM_CATEGORIES } from '$lib/types';
import { getLanguage, hasSourceResidue, type Language } from '$lib/languages';
import { db } from './db';
import { books, chapters, glossary, type GlossaryEntry } from './db/schema';
import { computeUsage, deepseek, MODEL, hasApiKey, queued, thinkingParam, withRetry } from './deepseek';
import { addUsage } from './translate';
import { invalidateAll, invalidateBook } from './glossary-match';

// -- CONSTANTS -- //

const GENDERS: Gender[] = ['neuter', 'masculine', 'feminine'];

// PARAMETERIZED EXTRACTION PROMPT — THE DIRECTION (WAS HARDCODED TRADITIONAL CHINESE → ENGLISH) NOW COMES
// FROM THE BOOK'S LANGUAGE PAIR.
function extractSystem(src: Language, tgt: Language): string {
	const roman =
		tgt.script === 'latin' && src.romanization
			? ` Romanize personal names with ${src.romanization} (no tone marks).`
			: '';
	return `You build a translation glossary from a passage of a ${src.name} web/light novel, so a later translation stays perfectly consistent in its names and terms.

Return ONLY a JSON object of exactly this shape — no markdown, no comments, no extra text:
{"terms":[{"source":"<${src.name} copied verbatim from the passage>","target":"<natural ${tgt.name}>","category":"character|location|organization|technique|item|realm|creature|title|concept|other","gender":"neuter|masculine|feminine","aliases":["<other ${src.name} forms of THIS entity, verbatim, or omit>"],"pinned":false,"context":"<one complete descriptive ${tgt.name} sentence>"}]}

Capture the recurring PROPER NOUNS and setting-specific TERMS that must stay consistent across the whole book:
- People: character names and distinctive epithets / forms of address.
- Places: realms, regions, villages, cities, towns, mountains, palaces, halls, sect/guild locations. Capture EVERY named place — a "<name>村 / 城 / 鎮 / 山 / 谷 / 峰 / 嶺 …" — EVEN IF its name is an ordinary word (地村, 雲霄城) or it appears only ONCE; a place's name still needs one consistent romanized rendering, so it must be in the glossary.
- Organizations: sects, clans, factions, orders, guilds, families.
- Powers: cultivation/martial techniques, arts, skills, spells, bloodlines, classes.
- Items: artifacts, weapons, pills, treasures, manuals.
- World terms: ranks/realms, named creatures, named units of measure, unique concepts.

Hard rules:
- "source" MUST be copied EXACTLY as it appears in the passage — identical characters, no added or removed spaces or punctuation — so it can be found again by exact string match. Capture the bare recurring form: prefer the standalone name over a name + title combination, and the dictionary/base form of a term over an inflected one, so the entry matches every later occurrence. Do not normalize, merge variants, or invent a form that is not literally in the text.
- "target" must be natural, idiomatic ${tgt.name} that reads smoothly INSIDE a sentence, the way a professional novelist-translator would write it — never a stiff word-for-word gloss. Render proper NAMES as names — for a village, city, town, or mountain especially, ROMANIZE/transliterate its name and translate only the place-type word; never translate what the name's characters literally mean, even when obvious (a village named "cloud firmament" → "Yunxiao Village", NOT "Cloud Soaring Village"; a mountain → "Ruxuan Mountain", NOT "Enter Mystic Mountain"); render meaningful descriptive terms — techniques, realms, ranks, grades, tiers, honorifics, and cultivation / Daoist CONCEPT terms — by their MEANING, in natural ${tgt.name} word order rather than the source's literal token order (a "Sever-Two" stage → "Two-Severing", not "Severing Two"); convey four-character idioms by meaning, not character by character. ROMANIZE ONLY TRUE NAMES (a person, or a place's distinctive name) — a rank or tier label is descriptive and must be TRANSLATED, never romanized (三清 → "Three Pure Ones", NOT "Sanqing"; 四御 → "Four Sovereigns", NOT "Siyu"; so 三清神性晶 → "Three Pure Ones Divine Essence Crystal"). Use Title Case for proper nouns where ${tgt.name} uses casing.${roman} Write a multi-syllable personal name as the family name then the given name, space-separated, the standard way — never run the syllables together (李澈 → "Li Che", 雲凰 → "Yun Huang", 蘇妲 → "Su Da", NOT "Yunhuang"/"Suda"). Keep a consistent naming style across related terms that share a component (a sect and its founder, a technique family).
- "category": the ONE kind this term names — "character" (a named person or being), "location" (a named place: realm, region, city, town, mountain, palace, or a sect's seat), "organization" (a sect / clan / faction / guild / order / family), "technique" (a cultivation or martial art, skill, or spell), "item" (an artifact, weapon, pill, treasure, manual, or material), "realm" (a cultivation realm / rank / stage / tier on the power ladder), "creature" (a named beast, monster, or species), "title" (an honorific or form of address), "concept" (a law, dao, energy, named unit / currency, or other world-term), or "other" when none fit. Pick the single best fit.
- "gender": set "masculine" or "feminine" ONLY when the passage itself makes that person's gender explicit — through gendered pronouns used for them, or gendered honorifics / titles / role or kinship words referring to them (e.g. emperor, king, prince, young master, lord, father, brother, son, husband → masculine; empress, queen, princess, concubine, young miss, lady, mother, sister, daughter, wife → feminine). Do NOT infer gender from the characters, surname, or spelling of the name itself, and do NOT guess from vibes or stereotypes. If the passage gives no explicit gendered reference for that exact person, use "neuter". When in any doubt, use "neuter" — a wrong masculine/feminine tag forces wrong pronouns throughout the translation, so only commit to a gender when the textual evidence is unambiguous. (Non-persons — places, items, organizations, techniques — are ALWAYS "neuter".)
- "aliases": an array of OTHER ${src.name} forms of the SAME entity that also appear in this passage — an epithet, a short form, a given-name-only form, or a nickname (e.g. 齊天 has the alias 齊兄; a character introduced as 李澈 later called just 澈) — each copied EXACTLY/verbatim like "source". Use [] when there is no other form in the passage. NEVER list a different entity, a longer phrase that merely CONTAINS the name, or a form that is not literally in the text.
- "pinned": true ONLY for the few genuinely central, high-frequency entities of the whole book — the protagonist, the main sect or location, a defining technique: the names a translation MUST get right. Default false; the vast majority of terms are false. Be conservative — over-pinning defeats its purpose.
- "context": a clear, self-contained ${tgt.name} DESCRIPTION of the term — written so a reader understands it, never a bare fragment. Make it ONE complete sentence (about 8–24 words, capitalized, ending with a period) that does TWO things: (1) state WHAT the term is — its category (person, place, sect / clan / faction, technique / art, item / artifact, realm / rank, creature, or concept), and (2) add a concrete detail specific to THIS book — for a person, their role and key relationships ("the protagonist", "X's master", "ruler of Y"); for a place, its kind and significance; for a technique / item / realm, what it does, who wields it, or where it sits in the power system; for a person also fold in the tone of their epithet if relevant. Stay consistent with the glossary INSIDE the context too: whenever this sentence names ANOTHER entity (a master, sect, place, technique, …), render that name with its established-glossary ${tgt.name} when one exists, and otherwise by the same naming rules above — never coin a second, different rendering for a name that already has one elsewhere. Write "A rare organ in the chest that stores spiritual energy, central to the protagonist's bloodline cultivation." — NOT a stub like "a special heart organ". Provide a context for every person, place, organization, technique, item, and world-term; omit it only when the term is fully self-explanatory from its ${tgt.name} alone. Never merely restate the ${tgt.name} translation, and never put ${src.name} characters in it.
- Skip common words, generic vocabulary, pronouns, numbers, and anything that is not a name or distinctive term. Favor quality and consistency over sheer count — a small set of correct, reusable entries beats a long noisy list.
- CONSISTENCY: if an "ESTABLISHED GLOSSARY" message is provided, treat those translations as FIXED. Reuse the exact ${tgt.name} for any of those terms that appear, and translate any NEW related term to match that wording and style (shared name components, naming conventions) so the book stays consistent. Never contradict an established translation.`;
}

// FOCUSED NAMING-NORMALIZATION PROMPT FOR PLACE TERMS. THE BULK EXTRACTION TRANSLATES A MEANING-BEARING
// PLACE NAME (雲霄村) INCONSISTENTLY — "Cloud Soaring Village" AS OFTEN AS "Yunxiao Village" — BECAUSE
// MID-LIST IT RENDERS THE NAME'S MEANING. A SEPARATE CALL THAT DOES ONLY THIS ONE JOB RELIABLY
// TRANSLITERATES THE PROPER-NAME PART AND TRANSLATES JUST THE PLACE-TYPE WORD.
function placeNameSystem(src: Language, tgt: Language): string {
	const roman = src.romanization ?? `natural ${tgt.name}`;
	return `You normalize PLACE names from a ${src.name} web/light novel for a ${tgt.name} translation glossary.
Input is lines of the form "${src.name} = current ${tgt.name}". For EACH input line, output exactly one line "${src.name} = corrected ${tgt.name}", in the same order.
RULE: a place's proper NAME must be TRANSLITERATED into ${tgt.name} (${roman}) — never translate what the name's characters literally mean — while only the place-type word is translated (village, city, town, mountain, peak, valley, ridge, isle, river, lake). Examples: 雲霄村 = Yunxiao Village (NOT "Cloud Soaring Village"); 入玄山 = Ruxuan Mountain (NOT "Enter Mystery Mountain"); 地村 = Di Village; 黑風城 = Heifeng City.
EXCEPTION: when the words before the place-type are a descriptive rank, grade, tier, or category rather than a proper name, render those by SENSE — do NOT transliterate a rank/tier (三清古村 → "Three Pure Ones Ancient Village", 四御中位古村 → "Four Sovereigns Mid-Grade Ancient Village" — never "Sanqing"/"Siyu").
Output ONLY the corrected lines — no preamble, no commentary, nothing else. Every line must be 100% ${tgt.name} with NO ${src.name} characters and contain a single "=".`;
}

const EXTRACT_CHUNK_CHARS = 9000;

// MAX ESTABLISHED TERMS TO FEED AS CONTEXT PER CHUNK (BOUNDS PROMPT TOKENS ON LARGE GLOSSARIES).
const MAX_CONTEXT_TERMS = 120;

// SOURCE TERMS ENDING IN ONE OF THESE PLACE-TYPE TAILS GET THE FOCUSED ROMANIZATION PASS (placeNameSystem):
// villages / cities / towns / mountains / peaks / valleys / ridges / isles / rivers / lakes. CJK tails.
const PLACE_TAIL = /[村城鎮鄉山峰谷嶺崖島洲灣河湖塘原]$/u;

// -- FUNCTIONS -- //

// CASE-INSENSITIVE "CONTAINS" THAT TREATS THE USER'S % _ \ AS LITERALS (NOT LIKE WILDCARDS). USES ILIKE —
// POSTGRES `LIKE` IS CASE-SENSITIVE (UNLIKE SQLite's ASCII-CASE-INSENSITIVE LIKE), SO ILIKE PRESERVES THE
// CASE-INSENSITIVE GLOSSARY SEARCH THE EDITOR HAD ON SQLite.
function likeContains(col: Column, q: string) {
	const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
	return sql`${col} ILIKE ${'%' + escaped + '%'} ESCAPE '\\'`;
}

function invalidate(scope: GlossaryScope, bookId: string | null): void {
	if (scope === 'global') invalidateAll();
	else if (bookId) invalidateBook(bookId);
}

// aliases IS STORED AS A JSON-ENCODED ARRAY IN A text COLUMN. PARSE IT BACK TO A CLEAN STRING ARRAY
// (null / MALFORMED / NON-ARRAY → []), AND SERIALISE THE OTHER WAY (EMPTY → null SO THE COLUMN STAYS CLEAN).
function parseAliases(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
	} catch {
		return [];
	}
}
function aliasesJson(aliases: string[] | null | undefined): string | null {
	const arr = [...new Set((aliases ?? []).map((a) => a.trim()).filter(Boolean))];
	return arr.length ? JSON.stringify(arr) : null;
}

// MAP A DB ROW TO THE TermDraft SHAPE matchTerms / TRANSLATION / EXPORT CONSUME (aliases PARSED TO AN ARRAY).
export function rowToDraft(g: GlossaryEntry): TermDraft {
	return {
		source: g.source,
		target: g.target,
		gender: g.gender,
		context: g.context,
		tags: g.tags,
		category: g.category,
		pinned: g.pinned,
		status: g.status,
		aliases: parseAliases(g.aliases),
		firstChapterId: g.firstChapterId,
		createdAt: g.createdAt,
	};
}

// READ A BOOK'S TRANSLATION DIRECTION — THE PAIR ITS GLOSSARY ROWS BELONG TO.
export async function bookPair(bookId: string): Promise<LangPair> {
	const [b] = await db
		.select({ sourceLang: books.sourceLang, targetLang: books.targetLang })
		.from(books)
		.where(eq(books.id, bookId))
		.limit(1);
	return { sourceLang: b?.sourceLang ?? 'zh-Hant', targetLang: b?.targetLang ?? 'en' };
}

// THE OWNER (userId) OF A BOOK — LETS THE BOOK-SCOPED ENTRY POINTS (getEffectiveGlossary, addNewTerms)
// DERIVE THE OWNER FROM THE BOOK SO THE TRANSLATE PIPELINE NEED NOT THREAD userId. null IF THE BOOK IS GONE.
async function bookOwner(bookId: string): Promise<string | null> {
	const [b] = await db.select({ userId: books.userId }).from(books).where(eq(books.id, bookId)).limit(1);
	return b?.userId ?? null;
}

// SPLIT THE WHOLE CHAPTER INTO PARAGRAPH-ALIGNED CHUNKS SO EVERY PART IS SCANNED FOR TERMS.
// EXPORTED FOR UNIT TESTS (tests/server/glossary.test.ts) — THE CHUNK SPLITTER BEHIND THE COST CAP.
export function chunkForExtraction(content: string): string[] {
	const paras = content.split(/\n{2,}/).filter((p) => p.trim().length > 0);
	if (paras.length === 0) return content.trim() ? [content] : [];
	const chunks: string[] = [];
	let cur = '';
	for (const p of paras) {
		if (cur.length + p.length > EXTRACT_CHUNK_CHARS && cur.length > 0) {
			chunks.push(cur);
			cur = '';
		}
		cur = cur ? `${cur}\n\n${p}` : p;
	}
	if (cur) chunks.push(cur);
	return chunks;
}

// ROBUST PARSE: ACCEPT CLEAN JSON, A BARE ARRAY, OR A TRUNCATED RESPONSE (SALVAGE COMPLETE {…} OBJECTS)
// SO A SLIGHTLY MALFORMED / CUT-OFF REPLY STILL YIELDS THE TERMS IT DID CONTAIN INSTEAD OF ZERO.
function parseTermObjects(text: string): unknown[] {
	const tryParse = (s: string): unknown => {
		try {
			return JSON.parse(s);
		} catch {
			return undefined;
		}
	};
	const whole = tryParse(text);
	if (Array.isArray(whole)) return whole;
	const terms = (whole as { terms?: unknown })?.terms;
	if (Array.isArray(terms)) return terms;
	// SALVAGE EVERY COMPLETE {…} OBJECT (HANDLES A TRUNCATED ARRAY THAT NEVER GOT ITS CLOSING `]`)
	const objs: unknown[] = [];
	const re = /\{[^{}]*\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const o = tryParse(m[0]);
		if (o) objs.push(o);
	}
	return objs;
}

// WHERE CLAUSE FOR ONE SCOPE. GLOBAL ROWS ARE FILTERED TO A LANGUAGE PAIR SO A CHINESE GLOSSARY NEVER
// SHOWS UP WHILE EDITING A JAPANESE ONE; BOOK ROWS ARE IMPLICITLY SINGLE-PAIR (TIED TO THE BOOK).
function scopeWhere(scope: GlossaryScope, bookId: string | null, userId: string, pair?: LangPair) {
	// EVERY GLOSSARY QUERY IS userId-SCOPED (Phase 4): global ROWS ARE PARTITIONED PER USER, AND book ROWS
	// CARRY THE OWNER TOO — SO A GUESSED bookId FROM ANOTHER USER MATCHES NOTHING.
	if (scope === 'global') {
		const base = and(eq(glossary.scope, 'global'), isNull(glossary.bookId), eq(glossary.userId, userId));
		if (!pair) return base;
		return and(base, eq(glossary.sourceLang, pair.sourceLang), eq(glossary.targetLang, pair.targetLang));
	}
	return and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId!), eq(glossary.userId, userId));
}

// ROWS FOR A SINGLE SCOPE (EDITOR VIEW)
export async function getGlossary(
	scope: GlossaryScope,
	bookId: string | null,
	userId: string,
	pair?: LangPair,
): Promise<GlossaryEntry[]> {
	return db
		.select()
		.from(glossary)
		.where(scopeWhere(scope, bookId, userId, pair))
		.orderBy(glossary.source);
}

// EFFECTIVE GLOSSARY FOR A BOOK = global(BOOK OWNER + SAME PAIR) ∪ book, WITH book OVERRIDING global ON THE
// SAME source. DERIVES THE OWNER FROM THE BOOK SO THE TRANSLATE PIPELINE (matchTerms) NEEDN'T THREAD userId.
export async function getEffectiveGlossary(bookId: string): Promise<TermDraft[]> {
	const userId = await bookOwner(bookId);
	if (!userId) return [];
	const pair = await bookPair(bookId);
	const globals = await db
		.select()
		.from(glossary)
		.where(
			and(
				eq(glossary.scope, 'global'),
				isNull(glossary.bookId),
				eq(glossary.userId, userId),
				eq(glossary.sourceLang, pair.sourceLang),
				eq(glossary.targetLang, pair.targetLang),
			),
		);
	const bookRows = await db
		.select()
		.from(glossary)
		.where(and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId)));

	const map = new Map<string, TermDraft>();
	for (const g of globals) map.set(g.source, rowToDraft(g));
	for (const b of bookRows) map.set(b.source, rowToDraft(b)); // book OVERRIDES global ON THE SAME source
	return [...map.values()];
}

// PAGINATED + SEARCHABLE GLOSSARY ROWS FOR THE EDITOR
export async function getGlossaryPage(
	scope: GlossaryScope,
	bookId: string | null,
	userId: string,
	opts: { q?: string; limit: number; offset: number; pair?: LangPair },
): Promise<{ rows: GlossaryRow[]; total: number }> {
	const base = scopeWhere(scope, bookId, userId, opts.pair);
	const q = opts.q?.trim();
	const where = q ? and(base, or(likeContains(glossary.source, q), likeContains(glossary.target, q))) : base;

	// LEFT JOIN THE first-appearance CHAPTER FOR ITS seq (THE EDITOR SHOWS "Ch. N"); aliases IS PARSED BELOW.
	const raw = await db
		.select({
			id: glossary.id,
			source: glossary.source,
			target: glossary.target,
			gender: glossary.gender,
			context: glossary.context,
			tags: glossary.tags,
			category: glossary.category,
			pinned: glossary.pinned,
			status: glossary.status,
			aliases: glossary.aliases,
			firstChapterId: glossary.firstChapterId,
			firstSeq: chapters.seq,
			firstChapterTitle: chapters.titleSource,
			firstChapterTitleTarget: chapters.titleTarget,
			createdAt: glossary.createdAt,
		})
		.from(glossary)
		.leftJoin(chapters, eq(glossary.firstChapterId, chapters.id))
		.where(where)
		.orderBy(glossary.source)
		.limit(opts.limit)
		.offset(opts.offset);
	const rows: GlossaryRow[] = raw.map((r) => ({ ...r, aliases: parseAliases(r.aliases) }));
	const [c] = await db
		.select({ n: sql<number>`count(*)` })
		.from(glossary)
		.where(where);
	return { rows, total: Number(c?.n ?? 0) };
}

export async function addTerm(
	scope: GlossaryScope,
	bookId: string | null,
	draft: TermDraft,
	pair: LangPair,
	userId: string,
): Promise<GlossaryEntry> {
	const [row] = await db
		.insert(glossary)
		.values({
			userId,
			scope,
			bookId: scope === 'global' ? null : bookId,
			sourceLang: pair.sourceLang,
			targetLang: pair.targetLang,
			source: draft.source.trim(),
			target: draft.target.trim(),
			gender: draft.gender,
			context: draft.context?.trim() || null,
			tags: draft.tags ?? null,
			category: draft.category ?? null,
			pinned: draft.pinned ?? false,
			// A HAND-ADDED TERM IS AUTHORITATIVE — MARK IT 'user' SO EXTRACTION NEVER TREATS IT AS UNREVIEWED.
			status: 'user',
			aliases: aliasesJson(draft.aliases),
		})
		.returning();
	invalidate(scope, bookId);
	return row;
}

export async function updateTerm(id: number, patch: Partial<TermDraft>, userId: string): Promise<GlossaryEntry | null> {
	// OWNER-SCOPED: A USER CAN ONLY EDIT THEIR OWN TERM (A GUESSED id FROM ANOTHER USER RETURNS null → 404).
	const [existing] = await db
		.select()
		.from(glossary)
		.where(and(eq(glossary.id, id), eq(glossary.userId, userId)))
		.limit(1);
	if (!existing) return null;
	const [row] = await db
		.update(glossary)
		.set({
			source: patch.source?.trim() ?? existing.source,
			target: patch.target?.trim() ?? existing.target,
			gender: patch.gender ?? existing.gender,
			// UNDEFINED = LEAVE AS-IS; AN EMPTY STRING CLEARS THE NOTE (→ null)
			context: patch.context === undefined ? existing.context : patch.context?.trim() || null,
			tags: patch.tags === undefined ? existing.tags : patch.tags,
			// UNDEFINED = LEAVE AS-IS; null OR A VALUE REPLACES IT.
			category: patch.category === undefined ? existing.category : (patch.category ?? null),
			pinned: patch.pinned === undefined ? existing.pinned : !!patch.pinned,
			aliases: patch.aliases === undefined ? existing.aliases : aliasesJson(patch.aliases),
			// A HUMAN EDIT CONFIRMS THE TERM → 'user' (AUTHORITATIVE, NEVER DOWNGRADED BY EXTRACTION).
			status: 'user',
			updatedAt: Date.now(),
		})
		.where(eq(glossary.id, id))
		.returning();
	invalidate(existing.scope, existing.bookId);
	return row;
}

export async function deleteTerm(id: number, userId: string): Promise<void> {
	// OWNER-SCOPED: ONLY THE OWNER CAN DELETE THEIR TERM.
	const [existing] = await db
		.select()
		.from(glossary)
		.where(and(eq(glossary.id, id), eq(glossary.userId, userId)))
		.limit(1);
	if (!existing) return;
	await db.delete(glossary).where(and(eq(glossary.id, id), eq(glossary.userId, userId)));
	invalidate(existing.scope, existing.bookId);
}

// BULK UPSERT TERMS INTO ONE SCOPE; RETURNS {added, updated}. ATOMIC — ALL-OR-NOTHING.
export async function mergeGlossary(
	scope: GlossaryScope,
	bookId: string | null,
	terms: TermDraft[],
	pair: LangPair,
	userId: string,
): Promise<{ added: number; updated: number }> {
	if (terms.length === 0) return { added: 0, updated: 0 };
	const effBookId = scope === 'global' ? null : bookId;

	// DE-DUPE BY source (LAST-WINS) BEFORE BATCHING: TWO ROWS WITH THE SAME source IN ONE INSERT THROW
	// "ON CONFLICT ... cannot affect row a second time" AND 400 THE WHOLE IMPORT.
	const now = Date.now();
	const bySource = new Map<string, typeof glossary.$inferInsert>();
	for (const t of terms) {
		const source = t.source.trim();
		const target = t.target.trim();
		if (!source || !target) continue;
		bySource.set(source, {
			userId,
			scope,
			bookId: effBookId,
			sourceLang: pair.sourceLang,
			targetLang: pair.targetLang,
			source,
			target,
			gender: t.gender,
			context: t.context?.trim() || null,
			tags: t.tags ?? null,
			category: t.category ?? null,
			pinned: t.pinned ?? false,
			status: t.status ?? 'ai',
			aliases: aliasesJson(t.aliases),
			firstChapterId: t.firstChapterId ?? null,
			createdAt: now,
			updatedAt: now,
		});
	}
	const rows = [...bySource.values()];
	if (rows.length === 0) return { added: 0, updated: 0 };

	const set = {
		target: sql`excluded.target`,
		gender: sql`excluded.gender`,
		context: sql`excluded.context`,
		tags: sql`excluded.tags`,
		category: sql`excluded.category`,
		pinned: sql`excluded.pinned`,
		status: sql`excluded.status`,
		aliases: sql`excluded.aliases`,
		// first_chapter_id IS DELIBERATELY ABSENT — FIRST APPEARANCE IS IMMUTABLE ONCE RECORDED.
		updatedAt: sql`excluded.updated_at`,
	};

	// THE ENTIRE MERGE RUNS IN ONE TRANSACTION: A FAILURE ON ANY CHUNK ROLLS BACK EVERYTHING (NO PARTIAL
	// IMPORTS), AND THE before/after COUNTS ARE READ INSIDE THE SAME TX SO CONCURRENT WRITERS CAN'T CORRUPT
	// THE added/updated ACCOUNTING.
	const CHUNK = 200;
	const counts = await db.transaction(async (tx) => {
		const where = scopeWhere(scope, bookId, userId, scope === 'global' ? pair : undefined);
		const [b] = await tx
			.select({ n: sql<number>`count(*)` })
			.from(glossary)
			.where(where);
		const before = Number(b?.n ?? 0);

		for (let i = 0; i < rows.length; i += CHUNK) {
			const slice = rows.slice(i, i + CHUNK);
			if (scope === 'global') {
				await tx
					.insert(glossary)
					.values(slice)
					.onConflictDoUpdate({
						// MATCHES THE PARTIAL UNIQUE INDEX glossary_global_unq (userId, sourceLang, targetLang, source).
						target: [glossary.userId, glossary.sourceLang, glossary.targetLang, glossary.source],
						targetWhere: sql`${glossary.scope} = 'global'`,
						set,
					});
			} else {
				await tx
					.insert(glossary)
					.values(slice)
					.onConflictDoUpdate({
						target: [glossary.bookId, glossary.source],
						targetWhere: sql`${glossary.scope} = 'book'`,
						set,
					});
			}
		}

		const [a] = await tx
			.select({ n: sql<number>`count(*)` })
			.from(glossary)
			.where(where);
		return { before, after: Number(a?.n ?? 0) };
	});

	const added = counts.after - counts.before;
	// DROP THE PER-BOOK MATCH AUTOMATON SO FRESHLY-MERGED TERMS ARE MATCHED *IMMEDIATELY* BY matchTerms. THE
	// EXTRACTION PIPELINE (addNewTerms) AND THE GLOSSARY IMPORT BOTH FLOW THROUGH HERE — WITHOUT THIS, JUST-
	// EXTRACTED TERMS STAY UNUSED (NOT INJECTED INTO TRANSLATION, ABSENT FROM "View terms") UNTIL A PROCESS
	// RESTART, BECAUSE THE IN-PROCESS AUTOMATON KEEPS ITS PRE-EXTRACTION SNAPSHOT. MIRRORS THE SINGLE-TERM CRUD.
	invalidate(scope, bookId);
	return { added, updated: rows.length - added };
}

// SAVE ONLY *NEW* TERMS INTO A BOOK'S GLOSSARY — TERMS WHOSE source ALREADY EXISTS IN THE EFFECTIVE
// GLOSSARY (BOOK ∪ GLOBAL OF THE SAME PAIR) ARE SKIPPED, NEVER OVERWRITTEN. KEEPS ESTABLISHED
// TRANSLATIONS STABLE SO EXTRACTION CAN'T "TAMPER" A TERM YOU ALREADY HAVE; IT ONLY ADDS WHAT'S MISSING.
export async function addNewTerms(
	bookId: string,
	terms: TermDraft[],
	// THE CHAPTER THESE TERMS WERE EXTRACTED FROM — STAMPED AS first_chapter_id (FIRST APPEARANCE) ON INSERT.
	chapterId?: number,
): Promise<{ added: number; skipped: number }> {
	if (terms.length === 0) return { added: 0, skipped: 0 };
	// OWNER DERIVED FROM THE BOOK (THE TRANSLATE/EXTRACT PIPELINE DOESN'T THREAD userId). NO OWNER → NO-OP.
	const userId = await bookOwner(bookId);
	if (!userId) return { added: 0, skipped: terms.length };
	const pair = await bookPair(bookId);
	// LOOK UP ONLY THE sources WE'RE ABOUT TO ADD (THIS USER'S BOOK ∪ GLOBAL-OF-PAIR), NOT THE WHOLE GLOSSARY.
	const sourceList = [...new Set(terms.map((t) => t.source.trim()).filter(Boolean))];
	const existing = sourceList.length
		? await db
				.select({ source: glossary.source })
				.from(glossary)
				.where(
					and(
						inArray(glossary.source, sourceList),
						eq(glossary.userId, userId),
						or(
							and(
								eq(glossary.scope, 'global'),
								isNull(glossary.bookId),
								eq(glossary.sourceLang, pair.sourceLang),
								eq(glossary.targetLang, pair.targetLang),
							),
							and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId)),
						),
					),
				)
		: [];
	const known = new Set(existing.map((e) => e.source));
	const freshTerms = terms.filter((t) => !known.has(t.source.trim()));
	const skipped = terms.length - freshTerms.length;
	// STAMP THE first-appearance CHAPTER AND MARK THESE auto-extracted BEFORE PERSISTING (mergeGlossary KEEPS
	// first_chapter_id OUT OF ITS CONFLICT set, SO THIS NEVER OVERWRITES AN EARLIER FIRST APPEARANCE).
	const fresh = freshTerms.map((t) => ({
		...t,
		status: 'ai' as const,
		firstChapterId: chapterId ?? t.firstChapterId ?? null,
	}));
	const { added } = await mergeGlossary('book', bookId, fresh, pair, userId);
	return { added, skipped };
}

// EXTRACT GLOSSARY TERM DRAFTS FROM A CHAPTER VIA DEEPSEEK (WHOLE CHAPTER, ROBUST, DEDUPED).
// `known` = THE BOOK'S EXISTING EFFECTIVE GLOSSARY; THE TERMS AMONG IT THAT APPEAR IN EACH CHUNK ARE
// FED TO THE MODEL AS AN "ESTABLISHED GLOSSARY" SO NEW TERMS ARE TRANSLATED CONSISTENTLY WITH THEM.
//
// COST GUARD: THE NUMBER OF CHUNKS IS *CAPPED* — EACH CHUNK IS A BILLED DEEPSEEK CALL, SO AN ABSURDLY LONG
// CHAPTER (UP TO THE 25MB INGEST LIMIT WOULD MEAN ~2,800 CALLS) MUST NOT RUN UNBOUNDED. ANY CHAPTER BEYOND
// THE CAP IS EXTRACTED UP TO THE CAP AND THE REMAINDER IS SKIPPED (EXTRACTION IS BEST-EFFORT — A CHAPTER
// PAST ~1.8MB OF SOURCE TEXT IS PATHOLOGICAL FOR A NOVEL CHAPTER ANYWAY).
export const MAX_EXTRACT_CHUNKS = 200;
export async function extractTerms(
	contentSource: string,
	pair: LangPair,
	known: TermDraft[] = [],
	signal?: AbortSignal,
	// PROGRESS CALLBACK — FIRED AFTER EACH CHUNK SO THE READER CAN SHOW "scanned 2/5 · 14 terms".
	onProgress?: (done: number, total: number, terms: number) => void,
	model: string = MODEL,
): Promise<{ terms: TermDraft[]; usage: TranslationUsage }> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	// A STANDARD AbortError (Node's DOMException IS GLOBAL HERE, BUT AN Error WITH name 'AbortError' WORKS
	// EVERYWHERE AND THE CALLER ONLY TESTS signal.aborted / name).
	const abortErr = () => Object.assign(new Error('Extraction aborted'), { name: 'AbortError' });
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const system = extractSystem(src, tgt);
	const chunks = chunkForExtraction(contentSource).slice(0, MAX_EXTRACT_CHUNKS);
	const bySource = new Map<string, TermDraft>();
	// SUM THE TOKENS/COST OF EVERY EXTRACTION CHUNK SO THIS PASS'S SPEND CAN BE BILLED — IT READS THE WHOLE
	// CHAPTER THROUGH THE MODEL ONCE AND WAS PREVIOUSLY DISCARDED, SILENTLY UNDER-REPORTING TOTAL COST.
	let usage: TranslationUsage = { model, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };
	// ANNOUNCE THE TOTAL WORK UP FRONT (0 DONE) SO THE READER CAN SHOW THE FULL SCOPE IMMEDIATELY.
	onProgress?.(0, chunks.length, 0);

	for (let i = 0; i < chunks.length; i++) {
		// A SUPERSEDED JOB (FORCE RE-RUN ABORTED THE PREVIOUS CONTROLLER) MUST STOP IMMEDIATELY — KEEPING GOING
		// WOULD BILL THE CHUNKS AND PERSIST TERMS/EXTRACTEDAt *AFTER* THE NEW JOB TOOK OVER (DOUBLE-BILLING).
		if (signal?.aborted) throw abortErr();
		const chunk = chunks[i];
		// CONNECTED CONTEXT = THE DB GLOSSARY *PLUS* TERMS ALREADY EXTRACTED IN EARLIER CHUNKS OF THIS RUN.
		// KEEPS LATER CHUNKS CONSISTENT WITH EARLIER ONES AND GIVES THE MODEL CANONICAL RENDERINGS TO REUSE.
		const established = new Map<string, TermDraft>();
		for (const t of bySource.values()) established.set(t.source, t); // THIS RUN'S EARLIER CHUNKS
		for (const t of known) established.set(t.source, t); // DB-FIXED TERMS TAKE PRECEDENCE
		// FEED THE MODEL THE CANONICAL RENDERINGS IT NEEDS — NOT JUST FOR EACH TERM'S OWN `target`, BUT FOR THE
		// OTHER ENTITIES IT NAMES INSIDE A `context` SENTENCE (A MASTER / SECT / PLACE …). THE OLD FILTER KEPT
		// ONLY TERMS LITERALLY IN THIS CHUNK, SO A CROSS-REFERENCED ENTITY ABSENT FROM THE CHUNK HAD NO CANONICAL
		// FORM AND THE MODEL INVENTED ONE (THE "context DRIFTS FROM THE GLOSSARY" BUG). WHEN THE WHOLE GLOSSARY
		// FITS THE CAP (THE COMMON CASE) FEED IT ALL IN A STABLE, CHUNK-INDEPENDENT ORDER SO THIS BLOCK IS
		// IDENTICAL ACROSS A CHAPTER'S CHUNKS AND CAN JOIN THE DEEPSEEK-CACHED PREFIX; ONLY A LARGE GLOSSARY THAT
		// OVERFLOWS THE CAP IS PRIORITISED (PINNED → IN-CHUNK → REST) AND TRUNCATED.
		const all = [...established.values()].filter((t) => t.source);
		const inChunk = (t: TermDraft) => chunk.includes(t.source);
		const cmpSource = (a: TermDraft, b: TermDraft) => a.source.localeCompare(b.source);
		const ctx =
			all.length <= MAX_CONTEXT_TERMS
				? [...all.filter((t) => t.pinned).sort(cmpSource), ...all.filter((t) => !t.pinned).sort(cmpSource)]
				: [
						...all.filter((t) => t.pinned),
						...all.filter((t) => !t.pinned && inChunk(t)),
						...all.filter((t) => !t.pinned && !inChunk(t)),
					].slice(0, MAX_CONTEXT_TERMS);
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
		if (ctx.length) {
			messages.push({
				role: 'system',
				content:
					`ESTABLISHED GLOSSARY (already saved — reuse each EXACT ${tgt.name} rendering everywhere you name these entities, INCLUDING inside any "context" description, and never contradict one):\n` +
					ctx.map((t) => `${t.source} = ${t.target}`).join('\n'),
			});
		}
		messages.push({ role: 'user', content: chunk });

		let text = '{}';
		try {
			// STREAM THE EXTRACTION SO THE READER SEES TERMS TICK UP LIVE — A SINGLE NON-STREAMED CALL LEAVES
			// THE UI "STUCK" ON Scanning… FOR THE WHOLE CALL (ESPECIALLY ON A ONE-CHUNK CHAPTER). WE COUNT
			// "source" KEYS AS THEY ARRIVE FOR A RUNNING FOUND-COUNT; THE DEDUPED COUNT IS REPORTED AFTER THE
			// FINAL PARSE BELOW.
			let acc = '';
			// THE STREAMED usage FRAME (EMPTY delta, FINAL CHUNK) — REQUIRES stream_options.include_usage.
			let usageRaw: Parameters<typeof computeUsage>[0] = undefined;
			await queued(async () => {
				const stream = await withRetry(() =>
					deepseek.chat.completions.create(
						{
							model,
							temperature: 0,
							max_tokens: 4096,
							response_format: { type: 'json_object' },
							stream: true,
							stream_options: { include_usage: true },
							messages,
							...thinkingParam(),
						},
						{ signal },
					),
				);
				for await (const part of stream) {
					// CAPTURE usage BEFORE THE `continue` BELOW — ITS FRAME CARRIES NO delta CONTENT.
					if (part.usage) usageRaw = part.usage;
					const d = part.choices[0]?.delta?.content ?? '';
					if (!d) continue;
					acc += d;
					const live = bySource.size + (acc.match(/"source"\s*:/g)?.length ?? 0);
					onProgress?.(i, chunks.length, live);
				}
			});
			// FOLD THIS CHUNK'S TOKENS INTO THE RUN TOTAL (DEDUPING IS LOCAL/FREE — ONLY THE API CALL BILLS).
			usage = addUsage(usage, computeUsage(usageRaw, model));
			text = acc || '{}';
		} catch (e) {
			// AN ABORT IS NOT A CHUNK FAILURE — PROPAGATE IT SO THE WHOLE RUN STOPS AND THE CALLER SKIPS ITS
			// BILLING/TERM WRITES (A SUPERSEDED RUN MUST NOT BILL THE REMAINING CHUNKS). ANY OTHER FAILURE IS
			// CHUNK-LOCAL: text STAYS '{}' (NO TERMS FROM THIS CHUNK) AND WE STILL REPORT PROGRESS BELOW.
			if (signal?.aborted) throw e;
			text = '{}';
		}
		for (const item of parseTermObjects(text)) {
			const t = item as {
				source?: unknown;
				target?: unknown;
				gender?: unknown;
				context?: unknown;
				category?: unknown;
				aliases?: unknown;
				pinned?: unknown;
			};
			const sourceTerm = String(t?.source ?? '').trim();
			const target = String(t?.target ?? '').trim();
			if (!sourceTerm || !target) continue;
			// ONLY KEEP TERMS WHOSE source ACTUALLY APPEARS IN THE CHAPTER — OTHERWISE AHO-CORASICK CAN
			// NEVER MATCH THEM (THE MODEL SOMETIMES NORMALIZES OR INVENTS A VARIANT FORM).
			if (!contentSource.includes(sourceTerm)) continue;
			if (bySource.has(sourceTerm)) continue; // FIRST OCCURRENCE WINS (STABLE)
			const category = TERM_CATEGORIES.includes(t?.category as TermCategory)
				? (t.category as TermCategory)
				: null;
			// gender IS MEANINGFUL ONLY FOR A character — FORCE neuter FOR EVERY OTHER CATEGORY (DEFENSIVE).
			const gender =
				category && category !== 'character'
					? 'neuter'
					: ((GENDERS.includes(t?.gender as Gender) ? t.gender : 'neuter') as Gender);
			const context = String(t?.context ?? '').trim() || null;
			const pinned = t?.pinned === true;
			// ALIASES: OTHER source FORMS OF THE SAME ENTITY THAT ACTUALLY APPEAR, VERBATIM, DISTINCT FROM source
			// (SO AHO-CORASICK CAN MATCH THEM). DEDUPED, CAPPED — A HALLUCINATED OR ABSENT FORM IS DROPPED.
			const aliases = Array.isArray(t?.aliases)
				? [
						...new Set(
							(t.aliases as unknown[])
								.map((a) => String(a ?? '').trim())
								.filter((a) => a && a !== sourceTerm && contentSource.includes(a)),
						),
					].slice(0, 8)
				: [];
			bySource.set(sourceTerm, {
				source: sourceTerm,
				target,
				gender,
				context,
				category,
				pinned,
				aliases: aliases.length ? aliases : null,
				status: 'ai',
			});
		}
		onProgress?.(i + 1, chunks.length, bySource.size);
	}

	// FOCUSED PLACE-NAME ROMANIZATION (SEE placeNameSystem). RE-RENDERS ONLY THE PLACE-TYPE TERMS THROUGH A
	// SINGLE NAMING CALL SO 雲霄村 RELIABLY BECOMES "Yunxiao Village" INSTEAD OF THE BULK PASS'S OCCASIONAL
	// "Cloud Soaring Village". BEST-EFFORT + DEFENSIVE: MATCHES RESULTS BACK BY source (ORDER-INDEPENDENT),
	// ADOPTS A LINE ONLY WHEN IT IS CLEAN target-LANGUAGE TEXT, AND ANY FAILURE LEAVES THE BULK RENDERINGS.
	const placeTerms = [...bySource.values()].filter((t) => PLACE_TAIL.test(t.source));
	if (placeTerms.length > 0 && tgt.script === 'latin' && src.romanization && hasApiKey()) {
		try {
			const res = await queued(() =>
				withRetry(() =>
					deepseek.chat.completions.create(
						{
							model,
							temperature: 0,
							messages: [
								{ role: 'system', content: placeNameSystem(src, tgt) },
								{
									role: 'user',
									content: placeTerms.map((t) => `${t.source} = ${t.target}`).join('\n'),
								},
							],
							...thinkingParam(),
						},
						{ signal },
					),
				),
			);
			usage = addUsage(usage, computeUsage(res.usage, model));
			for (const line of (res.choices[0]?.message?.content ?? '').split('\n')) {
				const eq = line.indexOf('=');
				if (eq < 0) continue;
				const term = bySource.get(line.slice(0, eq).trim());
				const target = line.slice(eq + 1).trim();
				if (term && target && !hasSourceResidue(target, pair.sourceLang)) term.target = target;
			}
		} catch {
			// BEST-EFFORT — LEAVE THE BULK-EXTRACTED PLACE RENDERINGS AS-IS ON ANY FAILURE.
		}
	}
	return { terms: [...bySource.values()], usage };
}
