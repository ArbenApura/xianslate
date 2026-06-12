// IMPORTED DEP-TYPES
import type { Column } from 'drizzle-orm';
// IMPORTED TYPES
import type { Gender, GlossaryScope, LangPair, TermDraft, TranslationUsage } from '$lib/types';
// IMPORTED DEP-MODULES
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { getLanguage, type Language } from '$lib/languages';
import { db } from './db';
import { books, glossary, type GlossaryEntry } from './db/schema';
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
{"terms":[{"source":"<${src.name} copied verbatim from the passage>","target":"<natural ${tgt.name}>","gender":"neuter|masculine|feminine","context":"<short ${tgt.name} note>"}]}

Capture the recurring PROPER NOUNS and setting-specific TERMS that must stay consistent across the whole book:
- People: character names and distinctive epithets / forms of address.
- Places: realms, regions, cities, mountains, palaces, halls, sect/guild locations.
- Organizations: sects, clans, factions, orders, guilds, families.
- Powers: cultivation/martial techniques, arts, skills, spells, bloodlines, classes.
- Items: artifacts, weapons, pills, treasures, manuals.
- World terms: ranks/realms, named creatures, named units of measure, unique concepts.

Hard rules:
- "source" MUST be copied EXACTLY as it appears in the passage — identical characters, no added or removed spaces or punctuation — so it can be found again by exact string match. Capture the bare recurring form: prefer the standalone name over a name + title combination, and the dictionary/base form of a term over an inflected one, so the entry matches every later occurrence. Do not normalize, merge variants, or invent a form that is not literally in the text.
- "target" must be natural, idiomatic ${tgt.name} that reads smoothly INSIDE a sentence, the way a professional novelist-translator would write it — never a stiff word-for-word gloss. Render proper NAMES as names; render meaningful descriptive terms (techniques, realms, ranks, honorifics) by SENSE into an evocative, concise rendering; convey four-character idioms by meaning, not character by character. Use Title Case for proper nouns where ${tgt.name} uses casing.${roman} Keep a consistent naming style across related terms that share a component (a sect and its founder, a technique family).
- "gender": set "masculine" or "feminine" ONLY when the passage itself makes that person's gender explicit — through gendered pronouns used for them, or gendered honorifics / titles / role or kinship words referring to them (e.g. emperor, king, prince, young master, lord, father, brother, son, husband → masculine; empress, queen, princess, concubine, young miss, lady, mother, sister, daughter, wife → feminine). Do NOT infer gender from the characters, surname, or spelling of the name itself, and do NOT guess from vibes or stereotypes. If the passage gives no explicit gendered reference for that exact person, use "neuter". When in any doubt, use "neuter" — a wrong masculine/feminine tag forces wrong pronouns throughout the translation, so only commit to a gender when the textual evidence is unambiguous. (Non-persons — places, items, organizations, techniques — are ALWAYS "neuter".)
- "context": a SHORT ${tgt.name} note (a phrase, ≤ 12 words) that helps a translator render this term correctly later — who a character is and their relationships/role, what kind of thing a term is, its tone/register, or a disambiguation from a similar term. Be concrete and specific to THIS book. Omit only when the term is wholly self-explanatory; prefer to fill it in for names and distinctive terms.
- Skip common words, generic vocabulary, pronouns, numbers, and anything that is not a name or distinctive term. Favor quality and consistency over sheer count — a small set of correct, reusable entries beats a long noisy list.
- CONSISTENCY: if an "ESTABLISHED GLOSSARY" message is provided, treat those translations as FIXED. Reuse the exact ${tgt.name} for any of those terms that appear, and translate any NEW related term to match that wording and style (shared name components, naming conventions) so the book stays consistent. Never contradict an established translation.`;
}

const EXTRACT_CHUNK_CHARS = 9000;

// MAX ESTABLISHED TERMS TO FEED AS CONTEXT PER CHUNK (BOUNDS PROMPT TOKENS ON LARGE GLOSSARIES).
const MAX_CONTEXT_TERMS = 120;

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

// READ A BOOK'S TRANSLATION DIRECTION — THE PAIR ITS GLOSSARY ROWS BELONG TO.
export async function bookPair(bookId: string): Promise<LangPair> {
	const [b] = await db
		.select({ sourceLang: books.sourceLang, targetLang: books.targetLang })
		.from(books)
		.where(eq(books.id, bookId))
		.limit(1);
	return { sourceLang: b?.sourceLang ?? 'zh-Hant', targetLang: b?.targetLang ?? 'en' };
}

// SPLIT THE WHOLE CHAPTER INTO PARAGRAPH-ALIGNED CHUNKS SO EVERY PART IS SCANNED FOR TERMS.
function chunkForExtraction(content: string): string[] {
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
function scopeWhere(scope: GlossaryScope, bookId: string | null, pair?: LangPair) {
	if (scope === 'global') {
		const base = and(eq(glossary.scope, 'global'), isNull(glossary.bookId));
		if (!pair) return base;
		return and(base, eq(glossary.sourceLang, pair.sourceLang), eq(glossary.targetLang, pair.targetLang));
	}
	return and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId!));
}

// ROWS FOR A SINGLE SCOPE (EDITOR VIEW)
export async function getGlossary(
	scope: GlossaryScope,
	bookId: string | null,
	pair?: LangPair,
): Promise<GlossaryEntry[]> {
	return db
		.select()
		.from(glossary)
		.where(scopeWhere(scope, bookId, pair))
		.orderBy(glossary.source);
}

// EFFECTIVE GLOSSARY FOR A BOOK = global(SAME PAIR) ∪ book, WITH book OVERRIDING global ON THE SAME source.
export async function getEffectiveGlossary(bookId: string): Promise<TermDraft[]> {
	const pair = await bookPair(bookId);
	const globals = await db
		.select()
		.from(glossary)
		.where(
			and(
				eq(glossary.scope, 'global'),
				isNull(glossary.bookId),
				eq(glossary.sourceLang, pair.sourceLang),
				eq(glossary.targetLang, pair.targetLang),
			),
		);
	const bookRows = await db
		.select()
		.from(glossary)
		.where(and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId)));

	const map = new Map<string, TermDraft>();
	for (const g of globals)
		map.set(g.source, {
			source: g.source,
			target: g.target,
			gender: g.gender,
			context: g.context,
			tags: g.tags,
			createdAt: g.createdAt,
		});
	for (const b of bookRows)
		map.set(b.source, {
			source: b.source,
			target: b.target,
			gender: b.gender,
			context: b.context,
			tags: b.tags,
			createdAt: b.createdAt,
		});
	return [...map.values()];
}

// PAGINATED + SEARCHABLE GLOSSARY ROWS FOR THE EDITOR
export async function getGlossaryPage(
	scope: GlossaryScope,
	bookId: string | null,
	opts: { q?: string; limit: number; offset: number; pair?: LangPair },
): Promise<{ rows: GlossaryEntry[]; total: number }> {
	const base = scopeWhere(scope, bookId, opts.pair);
	const q = opts.q?.trim();
	const where = q ? and(base, or(likeContains(glossary.source, q), likeContains(glossary.target, q))) : base;

	const rows = await db
		.select()
		.from(glossary)
		.where(where)
		.orderBy(glossary.source)
		.limit(opts.limit)
		.offset(opts.offset);
	const [c] = await db
		.select({ n: sql<number>`count(*)` })
		.from(glossary)
		.where(where);
	return { rows, total: Number(c?.n ?? 0) };
}

export async function countGlossary(scope: GlossaryScope, bookId: string | null, pair?: LangPair): Promise<number> {
	const [r] = await db
		.select({ n: sql<number>`count(*)` })
		.from(glossary)
		.where(scopeWhere(scope, bookId, pair));
	return Number(r?.n ?? 0);
}

export async function addTerm(
	scope: GlossaryScope,
	bookId: string | null,
	draft: TermDraft,
	pair: LangPair,
): Promise<GlossaryEntry> {
	const [row] = await db
		.insert(glossary)
		.values({
			scope,
			bookId: scope === 'global' ? null : bookId,
			sourceLang: pair.sourceLang,
			targetLang: pair.targetLang,
			source: draft.source.trim(),
			target: draft.target.trim(),
			gender: draft.gender,
			context: draft.context?.trim() || null,
			tags: draft.tags ?? null,
		})
		.returning();
	invalidate(scope, bookId);
	return row;
}

export async function updateTerm(id: number, patch: Partial<TermDraft>): Promise<GlossaryEntry | null> {
	const [existing] = await db.select().from(glossary).where(eq(glossary.id, id)).limit(1);
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
			updatedAt: Date.now(),
		})
		.where(eq(glossary.id, id))
		.returning();
	invalidate(existing.scope, existing.bookId);
	return row;
}

export async function deleteTerm(id: number): Promise<void> {
	const [existing] = await db.select().from(glossary).where(eq(glossary.id, id)).limit(1);
	if (!existing) return;
	await db.delete(glossary).where(eq(glossary.id, id));
	invalidate(existing.scope, existing.bookId);
}

// BULK UPSERT TERMS INTO ONE SCOPE; RETURNS {added, updated}. ATOMIC — ALL-OR-NOTHING.
export async function mergeGlossary(
	scope: GlossaryScope,
	bookId: string | null,
	terms: TermDraft[],
	pair: LangPair,
): Promise<{ added: number; updated: number }> {
	if (terms.length === 0) return { added: 0, updated: 0 };
	const effBookId = scope === 'global' ? null : bookId;

	// DE-DUPE BY source (LAST-WINS) BEFORE BATCHING: TWO ROWS WITH THE SAME source IN ONE INSERT THROW
	// SQLite's "ON CONFLICT ... cannot affect row a second time" AND 400 THE WHOLE IMPORT.
	const now = Date.now();
	const bySource = new Map<string, typeof glossary.$inferInsert>();
	for (const t of terms) {
		const source = t.source.trim();
		const target = t.target.trim();
		if (!source || !target) continue;
		bySource.set(source, {
			scope,
			bookId: effBookId,
			sourceLang: pair.sourceLang,
			targetLang: pair.targetLang,
			source,
			target,
			gender: t.gender,
			context: t.context?.trim() || null,
			tags: t.tags ?? null,
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
		updatedAt: sql`excluded.updated_at`,
	};

	// THE ENTIRE MERGE RUNS IN ONE TRANSACTION: A FAILURE ON ANY CHUNK ROLLS BACK EVERYTHING (NO PARTIAL
	// IMPORTS), AND THE before/after COUNTS ARE READ INSIDE THE SAME TX SO CONCURRENT WRITERS CAN'T CORRUPT
	// THE added/updated ACCOUNTING.
	const CHUNK = 200;
	const counts = await db.transaction(async (tx) => {
		const where = scopeWhere(scope, bookId, scope === 'global' ? pair : undefined);
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
						target: [glossary.sourceLang, glossary.targetLang, glossary.source],
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
	return { added, updated: rows.length - added };
}

// SAVE ONLY *NEW* TERMS INTO A BOOK'S GLOSSARY — TERMS WHOSE source ALREADY EXISTS IN THE EFFECTIVE
// GLOSSARY (BOOK ∪ GLOBAL OF THE SAME PAIR) ARE SKIPPED, NEVER OVERWRITTEN. KEEPS ESTABLISHED
// TRANSLATIONS STABLE SO EXTRACTION CAN'T "TAMPER" A TERM YOU ALREADY HAVE; IT ONLY ADDS WHAT'S MISSING.
export async function addNewTerms(bookId: string, terms: TermDraft[]): Promise<{ added: number; skipped: number }> {
	if (terms.length === 0) return { added: 0, skipped: 0 };
	const pair = await bookPair(bookId);
	// LOOK UP ONLY THE sources WE'RE ABOUT TO ADD (BOOK ∪ GLOBAL-OF-PAIR), NOT THE WHOLE GLOSSARY.
	const sourceList = [...new Set(terms.map((t) => t.source.trim()).filter(Boolean))];
	const existing = sourceList.length
		? await db
				.select({ source: glossary.source })
				.from(glossary)
				.where(
					and(
						inArray(glossary.source, sourceList),
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
	const fresh = terms.filter((t) => !known.has(t.source.trim()));
	const skipped = terms.length - fresh.length;
	const { added } = await mergeGlossary('book', bookId, fresh, pair);
	return { added, skipped };
}

// EXTRACT GLOSSARY TERM DRAFTS FROM A CHAPTER VIA DEEPSEEK (WHOLE CHAPTER, ROBUST, DEDUPED).
// `known` = THE BOOK'S EXISTING EFFECTIVE GLOSSARY; THE TERMS AMONG IT THAT APPEAR IN EACH CHUNK ARE
// FED TO THE MODEL AS AN "ESTABLISHED GLOSSARY" SO NEW TERMS ARE TRANSLATED CONSISTENTLY WITH THEM.
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
	const src = getLanguage(pair.sourceLang);
	const tgt = getLanguage(pair.targetLang);
	const system = extractSystem(src, tgt);
	const chunks = chunkForExtraction(contentSource);
	const bySource = new Map<string, TermDraft>();
	// SUM THE TOKENS/COST OF EVERY EXTRACTION CHUNK SO THIS PASS'S SPEND CAN BE BILLED — IT READS THE WHOLE
	// CHAPTER THROUGH THE MODEL ONCE AND WAS PREVIOUSLY DISCARDED, SILENTLY UNDER-REPORTING TOTAL COST.
	let usage: TranslationUsage = { model, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };
	// ANNOUNCE THE TOTAL WORK UP FRONT (0 DONE) SO THE READER CAN SHOW THE FULL SCOPE IMMEDIATELY.
	onProgress?.(0, chunks.length, 0);

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		// CONNECTED CONTEXT = THE DB GLOSSARY *PLUS* TERMS ALREADY EXTRACTED IN EARLIER CHUNKS OF THIS
		// RUN, FILTERED TO THOSE APPEARING IN THIS CHUNK. KEEPS LATER CHUNKS CONSISTENT WITH EARLIER ONES.
		const established = new Map<string, TermDraft>();
		for (const t of bySource.values()) established.set(t.source, t); // THIS RUN'S EARLIER CHUNKS
		for (const t of known) established.set(t.source, t); // DB-FIXED TERMS TAKE PRECEDENCE
		const ctx = [...established.values()]
			.filter((t) => t.source && chunk.includes(t.source))
			.slice(0, MAX_CONTEXT_TERMS);
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: system }];
		if (ctx.length) {
			messages.push({
				role: 'system',
				content:
					'ESTABLISHED GLOSSARY (already saved — keep these EXACT and stay consistent with them):\n' +
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
		} catch {
			// ONE CHUNK FAILING MUST NOT LOSE THE TERMS FROM THE REST OF THE CHAPTER — text STAYS '{}'
			// (NO TERMS FROM THIS CHUNK) AND WE STILL REPORT PROGRESS BELOW.
			text = '{}';
		}
		for (const item of parseTermObjects(text)) {
			const t = item as { source?: unknown; target?: unknown; gender?: unknown; context?: unknown };
			const sourceTerm = String(t?.source ?? '').trim();
			const target = String(t?.target ?? '').trim();
			if (!sourceTerm || !target) continue;
			// ONLY KEEP TERMS WHOSE source ACTUALLY APPEARS IN THE CHAPTER — OTHERWISE AHO-CORASICK CAN
			// NEVER MATCH THEM (THE MODEL SOMETIMES NORMALIZES OR INVENTS A VARIANT FORM).
			if (!contentSource.includes(sourceTerm)) continue;
			if (bySource.has(sourceTerm)) continue; // FIRST OCCURRENCE WINS (STABLE)
			const gender = (GENDERS.includes(t?.gender as Gender) ? t.gender : 'neuter') as Gender;
			const context = String(t?.context ?? '').trim() || null;
			bySource.set(sourceTerm, { source: sourceTerm, target, gender, context });
		}
		onProgress?.(i + 1, chunks.length, bySource.size);
	}
	return { terms: [...bySource.values()], usage };
}
