// IMPORTED DEP-TYPES
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
// IMPORTED TYPES
import type { Gender, GlossaryScope, TermDraft } from '$lib/types';
// IMPORTED DEP-MODULES
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { db } from './db';
import { glossary, type GlossaryEntry } from './db/schema';
import { deepseek, MODEL, hasApiKey, queued, thinkingParam, withRetry } from './deepseek';
import { invalidateAll, invalidateBook } from './glossary-match';

// -- CONSTANTS -- //

const GENDERS: Gender[] = ['neuter', 'masculine', 'feminine'];

const EXTRACT_SYSTEM = `You build a translation glossary from a passage of a Traditional Chinese web novel (xianxia / xuanhuan / wuxia).

Return ONLY a JSON object of exactly this shape — no markdown, no comments, no extra text:
{"terms":[{"raw":"<chinese copied verbatim from the passage>","translation":"<natural English>","gender":"neuter|masculine|feminine"}]}

Capture the recurring PROPER NOUNS and setting-specific TERMS that must stay consistent across the whole book:
- People: character names and distinctive epithets / forms of address.
- Places: realms, regions, cities, mountains, palaces, halls, sect locations.
- Organizations: sects, clans, factions, orders, families.
- Powers: cultivation techniques, martial / sword / fist arts, skills, spells, bloodlines.
- Items: artifacts, weapons, pills, treasures, manuals.
- World terms: cultivation realms / ranks, named creatures, unique concepts.

Hard rules:
- "raw" MUST be copied EXACTLY as it appears in the passage — identical characters, no added or removed spaces or punctuation — so it can be found again by exact string match. Prefer the bare name over a name + title combination.
- "translation" must be natural, idiomatic English that reads smoothly INSIDE a sentence, the way a professional novelist-translator would write it — never a stiff word-for-word gloss. Use Title Case for proper nouns. Romanize personal names with pinyin and NO tone marks (李澈 → "Li Che", 蘇媚 → "Su Mei"). Translate meaningful terms by sense and keep them concise (龍象金剛 → "Dragon-Elephant Vajra", 洞天 → "Cave Heaven", 結丹 → "Core Formation").
- "gender": masculine or feminine ONLY for an individual person whose gender is clear from the passage; everything else is neuter.
- Skip common words, generic vocabulary, pronouns, numbers, and anything that is not a name or distinctive term. Favor quality and consistency over sheer count.
- CONSISTENCY: if an "ESTABLISHED GLOSSARY" message is provided, treat those translations as FIXED. Reuse the exact English for any of those terms that appear, and translate any NEW related term to match that wording and style (shared name components, naming conventions) so the book stays consistent. Never contradict an established translation.`;

const EXTRACT_CHUNK_CHARS = 9000;

// MAX ESTABLISHED TERMS TO FEED AS CONTEXT PER CHUNK (BOUNDS PROMPT TOKENS ON LARGE GLOSSARIES).
const MAX_CONTEXT_TERMS = 120;

// -- FUNCTIONS -- //

// CASE-INSENSITIVE "CONTAINS" THAT TREATS THE USER'S % _ \ AS LITERALS (NOT LIKE WILDCARDS)
function likeContains(col: SQLiteColumn, q: string) {
	const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
	return sql`${col} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`;
}

function invalidate(scope: GlossaryScope, bookId: string | null): void {
	if (scope === 'global') invalidateAll();
	else if (bookId) invalidateBook(bookId);
}

// SPLIT THE WHOLE CHAPTER INTO PARAGRAPH-ALIGNED CHUNKS SO EVERY PART IS SCANNED FOR TERMS — THE OLD
// SINGLE 12k SLICE MISSED EVERYTHING PAST IT IN LONG CHAPTERS.
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

// ROWS FOR A SINGLE SCOPE (EDITOR VIEW)
export async function getGlossary(scope: GlossaryScope, bookId: string | null): Promise<GlossaryEntry[]> {
	const where =
		scope === 'global'
			? and(eq(glossary.scope, 'global'), isNull(glossary.bookId))
			: and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId!));
	return db.select().from(glossary).where(where).orderBy(glossary.raw);
}

// EFFECTIVE GLOSSARY FOR A BOOK = global ∪ book, WITH book OVERRIDING global ON THE SAME raw
export async function getEffectiveGlossary(bookId: string): Promise<TermDraft[]> {
	const globals = await db
		.select()
		.from(glossary)
		.where(and(eq(glossary.scope, 'global'), isNull(glossary.bookId)));
	const bookRows = await db
		.select()
		.from(glossary)
		.where(and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId)));

	const map = new Map<string, TermDraft>();
	for (const g of globals) map.set(g.raw, { raw: g.raw, translation: g.translation, gender: g.gender, tags: g.tags });
	for (const b of bookRows)
		map.set(b.raw, { raw: b.raw, translation: b.translation, gender: b.gender, tags: b.tags });
	return [...map.values()];
}

// PAGINATED + SEARCHABLE GLOSSARY ROWS FOR THE EDITOR
export async function getGlossaryPage(
	scope: GlossaryScope,
	bookId: string | null,
	opts: { q?: string; limit: number; offset: number },
): Promise<{ rows: GlossaryEntry[]; total: number }> {
	const scopeWhere =
		scope === 'global'
			? and(eq(glossary.scope, 'global'), isNull(glossary.bookId))
			: and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId!));
	const q = opts.q?.trim();
	const where = q
		? and(scopeWhere, or(likeContains(glossary.raw, q), likeContains(glossary.translation, q)))
		: scopeWhere;

	const rows = await db
		.select()
		.from(glossary)
		.where(where)
		.orderBy(glossary.raw)
		.limit(opts.limit)
		.offset(opts.offset);
	const [c] = await db
		.select({ n: sql<number>`count(*)` })
		.from(glossary)
		.where(where);
	return { rows, total: Number(c?.n ?? 0) };
}

export async function countGlossary(scope: GlossaryScope, bookId: string | null): Promise<number> {
	const where =
		scope === 'global'
			? and(eq(glossary.scope, 'global'), isNull(glossary.bookId))
			: and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId!));
	const [r] = await db
		.select({ n: sql<number>`count(*)` })
		.from(glossary)
		.where(where);
	return Number(r?.n ?? 0);
}

export async function addTerm(scope: GlossaryScope, bookId: string | null, draft: TermDraft): Promise<GlossaryEntry> {
	const [row] = await db
		.insert(glossary)
		.values({
			scope,
			bookId: scope === 'global' ? null : bookId,
			raw: draft.raw.trim(),
			translation: draft.translation.trim(),
			gender: draft.gender,
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
			raw: patch.raw?.trim() ?? existing.raw,
			translation: patch.translation?.trim() ?? existing.translation,
			gender: patch.gender ?? existing.gender,
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
): Promise<{ added: number; updated: number }> {
	if (terms.length === 0) return { added: 0, updated: 0 };
	const effBookId = scope === 'global' ? null : bookId;

	// DE-DUPE BY raw (LAST-WINS) BEFORE BATCHING: TWO ROWS WITH THE SAME raw IN ONE INSERT THROW SQLite's
	// "ON CONFLICT ... cannot affect row a second time" AND 400 THE WHOLE IMPORT.
	const now = Date.now();
	const byRaw = new Map<string, typeof glossary.$inferInsert>();
	for (const t of terms) {
		const raw = t.raw.trim();
		const translation = t.translation.trim();
		if (!raw || !translation) continue;
		byRaw.set(raw, {
			scope,
			bookId: effBookId,
			raw,
			translation,
			gender: t.gender,
			tags: t.tags ?? null,
			createdAt: now,
			updatedAt: now,
		});
	}
	const rows = [...byRaw.values()];
	if (rows.length === 0) return { added: 0, updated: 0 };

	const set = {
		translation: sql`excluded.translation`,
		gender: sql`excluded.gender`,
		tags: sql`excluded.tags`,
		updatedAt: sql`excluded.updated_at`,
	};

	// THE ENTIRE MERGE RUNS IN ONE TRANSACTION: A FAILURE ON ANY CHUNK ROLLS BACK EVERYTHING (NO PARTIAL
	// IMPORTS), AND THE before/after COUNTS ARE READ INSIDE THE SAME TX SO CONCURRENT WRITERS CAN'T CORRUPT
	// THE added/updated ACCOUNTING.
	const CHUNK = 200;
	const counts = await db.transaction(async (tx) => {
		const scopeWhere =
			scope === 'global'
				? and(eq(glossary.scope, 'global'), isNull(glossary.bookId))
				: and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId!));
		const [b] = await tx
			.select({ n: sql<number>`count(*)` })
			.from(glossary)
			.where(scopeWhere);
		const before = Number(b?.n ?? 0);

		for (let i = 0; i < rows.length; i += CHUNK) {
			const slice = rows.slice(i, i + CHUNK);
			if (scope === 'global') {
				await tx
					.insert(glossary)
					.values(slice)
					.onConflictDoUpdate({ target: glossary.raw, targetWhere: sql`${glossary.scope} = 'global'`, set });
			} else {
				await tx
					.insert(glossary)
					.values(slice)
					.onConflictDoUpdate({
						target: [glossary.bookId, glossary.raw],
						targetWhere: sql`${glossary.scope} = 'book'`,
						set,
					});
			}
		}

		const [a] = await tx
			.select({ n: sql<number>`count(*)` })
			.from(glossary)
			.where(scopeWhere);
		return { before, after: Number(a?.n ?? 0) };
	});

	const added = counts.after - counts.before;
	return { added, updated: rows.length - added };
}

// SAVE ONLY *NEW* TERMS INTO A BOOK'S GLOSSARY — TERMS WHOSE raw ALREADY EXISTS IN THE EFFECTIVE
// GLOSSARY (BOOK ∪ GLOBAL) ARE SKIPPED, NEVER OVERWRITTEN. THIS KEEPS ESTABLISHED TRANSLATIONS STABLE
// SO EXTRACTION CAN'T "TAMPER" A TERM YOU ALREADY HAVE; IT ONLY ADDS WHAT'S GENUINELY MISSING.
export async function addNewTerms(bookId: string, terms: TermDraft[]): Promise<{ added: number; skipped: number }> {
	if (terms.length === 0) return { added: 0, skipped: 0 };
	// LOOK UP ONLY THE raws WE'RE ABOUT TO ADD (BOOK ∪ GLOBAL), NOT THE WHOLE 7000-TERM GLOSSARY.
	const rawList = [...new Set(terms.map((t) => t.raw.trim()).filter(Boolean))];
	const existing = rawList.length
		? await db
				.select({ raw: glossary.raw })
				.from(glossary)
				.where(
					and(
						inArray(glossary.raw, rawList),
						or(
							and(eq(glossary.scope, 'global'), isNull(glossary.bookId)),
							and(eq(glossary.scope, 'book'), eq(glossary.bookId, bookId)),
						),
					),
				)
		: [];
	const known = new Set(existing.map((e) => e.raw));
	const fresh = terms.filter((t) => !known.has(t.raw.trim()));
	const skipped = terms.length - fresh.length;
	const { added } = await mergeGlossary('book', bookId, fresh);
	return { added, skipped };
}

// EXTRACT GLOSSARY TERM DRAFTS FROM A CHAPTER VIA DEEPSEEK (WHOLE CHAPTER, ROBUST, DEDUPED).
// `known` = THE BOOK'S EXISTING EFFECTIVE GLOSSARY; THE TERMS AMONG IT THAT APPEAR IN EACH CHUNK ARE
// FED TO THE MODEL AS AN "ESTABLISHED GLOSSARY" SO NEW TERMS ARE TRANSLATED CONSISTENTLY WITH THEM.
export async function extractTerms(
	contentZh: string,
	known: TermDraft[] = [],
	signal?: AbortSignal,
): Promise<TermDraft[]> {
	if (!hasApiKey()) throw new Error('DEEPSEEK_API_KEY is not configured.');
	const chunks = chunkForExtraction(contentZh);
	const byRaw = new Map<string, TermDraft>();

	for (const chunk of chunks) {
		// CONNECTED CONTEXT = THE DB GLOSSARY *PLUS* TERMS ALREADY EXTRACTED IN EARLIER CHUNKS OF THIS
		// RUN, FILTERED TO THOSE APPEARING IN THIS CHUNK. THIS KEEPS LATER CHUNKS CONSISTENT WITH EARLIER
		// ONES (NO SAME-TERM DRIFT ACROSS CHUNKS) AND WITH WHAT'S ALREADY SAVED.
		const established = new Map<string, TermDraft>();
		for (const t of byRaw.values()) established.set(t.raw, t); // THIS RUN'S EARLIER CHUNKS
		for (const t of known) established.set(t.raw, t); // DB-FIXED TERMS TAKE PRECEDENCE
		const ctx = [...established.values()].filter((t) => t.raw && chunk.includes(t.raw)).slice(0, MAX_CONTEXT_TERMS);
		const messages: { role: 'system' | 'user'; content: string }[] = [{ role: 'system', content: EXTRACT_SYSTEM }];
		if (ctx.length) {
			messages.push({
				role: 'system',
				content:
					'ESTABLISHED GLOSSARY (already saved — keep these EXACT and stay consistent with them):\n' +
					ctx.map((t) => `${t.raw} = ${t.translation}`).join('\n'),
			});
		}
		messages.push({ role: 'user', content: chunk });

		let text = '{}';
		try {
			const res = await queued(() =>
				withRetry(() =>
					deepseek.chat.completions.create(
						{
							model: MODEL,
							temperature: 0,
							max_tokens: 4096,
							response_format: { type: 'json_object' },
							messages,
							...thinkingParam(),
						},
						{ signal },
					),
				),
			);
			text = res.choices[0]?.message?.content ?? '{}';
		} catch {
			// ONE CHUNK FAILING MUST NOT LOSE THE TERMS FROM THE REST OF THE CHAPTER
			continue;
		}
		for (const item of parseTermObjects(text)) {
			const t = item as { raw?: unknown; translation?: unknown; gender?: unknown };
			const rawTerm = String(t?.raw ?? '').trim();
			const translation = String(t?.translation ?? '').trim();
			if (!rawTerm || !translation) continue;
			// ONLY KEEP TERMS WHOSE raw ACTUALLY APPEARS IN THE CHAPTER — OTHERWISE AHO-CORASICK CAN
			// NEVER MATCH THEM (THE MODEL SOMETIMES NORMALIZES OR INVENTS A VARIANT FORM).
			if (!contentZh.includes(rawTerm)) continue;
			if (byRaw.has(rawTerm)) continue; // FIRST OCCURRENCE WINS (STABLE)
			const gender = (GENDERS.includes(t?.gender as Gender) ? t.gender : 'neuter') as Gender;
			byRaw.set(rawTerm, { raw: rawTerm, translation, gender });
		}
	}
	return [...byRaw.values()];
}
