// IMPORTED DEP-MODULES
import { sql } from 'drizzle-orm';
import {
	bigint,
	bigserial,
	boolean,
	doublePrecision,
	index,
	integer,
	pgTable,
	text,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

// -- CONSTANTS -- //

// MS-EPOCH TIMESTAMP COLUMN — bigint(mode:'number') KEEPS Date.now() + ALL STAT MATH UNCHANGED (NOT
// timestamptz). HELPER SO EVERY created_at/updated_at/…At COLUMN STAYS A PLAIN JS number.
const epochMs = (name: string) => bigint(name, { mode: 'number' });

// A REGISTERED ACCOUNT, KEYED BY THE FIREBASE uid. UPSERTED ON FIRST VERIFIED SIGN-IN (Phase 3). FIREBASE
// OWNS PASSWORDS / OAUTH / EMAIL-VERIFICATION — THIS TABLE JUST MIRRORS THE PROFILE + THE APP role SO THE
// SERVER STAYS AUTHORITATIVE FOR OWNERSHIP (Phase 4) AND ADMIN ACCESS.
export const users = pgTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	name: text('name'),
	avatarUrl: text('avatar_url'),
	role: text('role', { enum: ['user', 'admin'] })
		.notNull()
		.default('user'),
	createdAt: epochMs('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
});

// A LIBRARY ENTRY FROM ANY SOURCE. id IS THE SITE BOOK id FOR web, A GENERATED id FOR epub/txt.
export const books = pgTable(
	'books',
	{
		id: text('id').primaryKey(),
		// OWNERSHIP ROOT (Phase 4). chapters/translations/chapter-linked ai_usage INHERIT OWNERSHIP THROUGH
		// THE FK CHAIN; site_adapters/site_events STAY GLOBAL. DELETING THE USER CASCADES THEIR WHOLE LIBRARY.
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		sourceType: text('source_type', { enum: ['web', 'epub', 'txt', 'manual'] }).notNull(),
	// THE BOOK'S OWN TRANSLATION DIRECTION — BCP-47-ISH CODES FROM $lib/languages. PRE-EXISTING BOOKS ARE
	// BACKFILLED TO zh-Hant → en (THE APP'S ORIGINAL HARDCODED DIRECTION) BY THE MIGRATION.
	sourceLang: text('source_lang').notNull(),
	targetLang: text('target_lang').notNull(),
	// TITLE/AUTHOR AS WRITTEN IN THE SOURCE LANGUAGE.
	title: text('title').notNull(),
	// TITLE/AUTHOR RENDERED INTO THE TARGET LANGUAGE (LAZILY FILLED) — SO THE LIBRARY ISN'T MIXED-SCRIPT.
	titleTarget: text('title_target'),
	author: text('author'),
	authorTarget: text('author_target'),
	sourceUrl: text('source_url'),
	coverUrl: text('cover_url'),
	// RESUME POINTER → chapters.id (bigint). NO DECLARED FK (THE READER WRITES IT FREELY); STAYS bigint.
	lastChapterId: bigint('last_chapter_id', { mode: 'number' }),
	// WHEN ANY CHAPTER OF THIS BOOK WAS LAST OPENED — DRIVES THE "CONTINUE READING" PICK (MOST RECENT WINS)
	lastReadAt: epochMs('last_read_at'),
		createdAt: epochMs('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => [index('books_user_idx').on(t.userId)],
);

// CACHE OF FETCHED/IMPORTED CHAPTERS. WEB NAV USES prevUrl/nextUrl; EPUB/TXT NAV USES seq.
export const chapters = pgTable(
	'chapters',
	{
		// HIGH-VOLUME PK → bigint IDENTITY (mode:'number' SO JS STILL SEES A number, NOT a bigint).
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		// STABLE PUBLIC IDENTIFIER USED IN URLS (DECOUPLED FROM THE PK) — NATIVE uuid, DB-GENERATED.
		uuid: uuid('uuid').notNull().defaultRandom(),
		bookId: text('book_id')
			.notNull()
			.references(() => books.id, { onDelete: 'cascade' }),
		seq: integer('seq').notNull(),
		chapterUrl: text('chapter_url'),
		siteChapterId: text('site_chapter_id'),
		// SOURCE-LANGUAGE TITLE/BODY (AS FETCHED/IMPORTED) AND THEIR TARGET-LANGUAGE TRANSLATIONS.
		titleSource: text('title_source').notNull(),
		titleTarget: text('title_target'),
		contentSource: text('content_source').notNull(),
		contentTarget: text('content_target'),
		prevUrl: text('prev_url'),
		nextUrl: text('next_url'),
		indexUrl: text('index_url'),
		fetchedAt: epochMs('fetched_at'),
		translatedAt: epochMs('translated_at'),
		// WHEN GLOSSARY TERMS WERE AUTO-EXTRACTED FROM THIS CHAPTER (NULL = NEVER) — GATES RE-BILLING
		extractedAt: epochMs('extracted_at'),
		// HOW MUCH OF THE CHAPTER HAS ACTUALLY BEEN READ (0..1 = FRACTION OF CONTENT SCROLLED INTO VIEW,
		// MONOTONIC MAX). DRIVES THE "READ" CHECKMARK IN THE LISTS — A CHAPTER IS DONE ONLY WHEN THE READER
		// SCROLLED TO THE END, NOT JUST BECAUSE IT SITS BEFORE THE CURRENT ONE. NULL = NEVER OPENED.
		readProgress: doublePrecision('read_progress'),
	},
	(t) => [
		// STABLE URL IDENTIFIER
		uniqueIndex('chapters_uuid_unq').on(t.uuid),
		// UNIQUE PER BOOK+SEQ FOR ORDERED IMPORTS
		uniqueIndex('chapters_book_seq_unq').on(t.bookId, t.seq),
		// UNIQUE WEB URL *PER BOOK* (Phase 4): PER-USER LIBRARIES MEAN TWO USERS CAN EACH FETCH THE SAME SOURCE
		// URL INTO THEIR OWN (PER-USER) WEB BOOK, SO URL UNIQUENESS IS SCOPED TO THE BOOK, NOT GLOBAL. NULLS
		// ARE DISTINCT (epub/txt CHAPTERS HAVE NO URL), SO IMPORTS ARE UNAFFECTED.
		uniqueIndex('chapters_url_unq').on(t.bookId, t.chapterUrl),
		index('chapters_book_idx').on(t.bookId),
	],
);

// MEMOIZED TRANSLATIONS KEYED BY content+glossary+model+prompt FINGERPRINT.
export const translations = pgTable(
	'translations',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		chapterId: bigint('chapter_id', { mode: 'number' })
			.notNull()
			.references(() => chapters.id, { onDelete: 'cascade' }),
		cacheKey: text('cache_key').notNull(),
		contentTarget: text('content_target').notNull(),
		model: text('model').notNull(),
		promptTokens: integer('prompt_tokens'),
		cachedTokens: integer('cached_tokens'),
		completionTokens: integer('completion_tokens'),
		costUsd: doublePrecision('cost_usd'),
		createdAt: epochMs('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => [
		uniqueIndex('translations_cache_key_unq').on(t.cacheKey),
		index('translations_chapter_idx').on(t.chapterId),
	],
);

// scope='global' (bookId NULL) APPLIES TO EVERY BOOK *OF THE SAME LANGUAGE PAIR*; scope='book' IS PRIVATE.
// EFFECTIVE GLOSSARY FOR A BOOK = global(matching the book's sourceLang+targetLang) UNION book, WITH book
// OVERRIDING global ON THE SAME source. EACH ROW IS TAGGED WITH ITS LANGUAGE PAIR SO A CHINESE GLOSSARY
// NEVER LEAKS INTO A JAPANESE BOOK SHARING THE SAME LIBRARY.
export const glossary = pgTable(
	'glossary',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		// OWNER (Phase 4). global ROWS HAVE NO bookId, SO THE GLOBAL GLOSSARY IS PARTITIONED PER USER VIA THIS;
		// book ROWS ALSO CARRY IT (= THE BOOK OWNER) SO A USER-DELETE CASCADES THEM AND SO EVERY GLOSSARY QUERY
		// CAN BE userId-SCOPED (A GUESSED bookId FROM ANOTHER USER MATCHES NOTHING).
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		scope: text('scope', { enum: ['global', 'book'] }).notNull(),
		bookId: text('book_id').references(() => books.id, { onDelete: 'cascade' }),
		// THE PAIR THIS TERM BELONGS TO — FILTERS THE EFFECTIVE GLOSSARY TO THE READING BOOK'S DIRECTION.
		sourceLang: text('source_lang').notNull(),
		targetLang: text('target_lang').notNull(),
		// THE TERM IN THE SOURCE LANGUAGE AND THE TARGET-LANGUAGE RENDERING TO USE FOR IT.
		source: text('source').notNull(),
		target: text('target').notNull(),
		gender: text('gender', { enum: ['neuter', 'masculine', 'feminine'] })
			.notNull()
			.default('neuter'),
		// SHORT TRANSLATOR-FACING NOTE (e.g. "protagonist's senior martial brother", "fire-attribute sword art").
		// FED TO THE TRANSLATION PROMPT TO DISAMBIGUATE THE TERM AND SHOWN IN THE GLOSSARY EDITOR.
		context: text('context'),
		tags: text('tags'),
		createdAt: epochMs('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: epochMs('updated_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => [
		// PARTIAL UNIQUE INDEXES — ONE GLOBAL source PER (USER, LANGUAGE PAIR), ONE source PER BOOK.
		uniqueIndex('glossary_global_unq')
			.on(t.userId, t.sourceLang, t.targetLang, t.source)
			.where(sql`${t.scope} = 'global'`),
		uniqueIndex('glossary_book_unq')
			.on(t.bookId, t.source)
			.where(sql`${t.scope} = 'book'`),
		index('glossary_book_idx').on(t.bookId),
		index('glossary_user_idx').on(t.userId),
	],
);

// AI-LEARNED PARSING MAP FOR A SCRAPED SITE, KEYED BY HOST. THE TRANSPORT LAYER IS GENERIC; THIS TABLE
// IS HOW A NEW HOST BECOMES PARSEABLE WITHOUT CODE CHANGES. THE AI MAPS *SELECTORS* ONCE PER SITE
// (NOT CONTENT PER PAGE), SO EVERY LATER CHAPTER IS PARSED DETERMINISTICALLY AT ZERO LLM COST. WHEN
// THE SELECTORS STOP MATCHING (SITE REDESIGN) THE FETCHER RE-LEARNS AND BUMPS version (SELF-HEALING).
// STAYS GLOBAL/SHARED ACROSS USERS — A LEARNED SELECTOR MAP IS NOT PER-USER (NO RE-LEARN COST PER USER).
export const siteAdapters = pgTable('site_adapters', {
	// REGISTRABLE HOST WITH A LEADING www. STRIPPED (e.g. 'uukanshu.cc')
	host: text('host').primaryKey(),
	// JSON SelectorMap (title/body/prev/next/index/author/idUrlPattern) — see $lib/server/site-adapter
	mapping: text('mapping').notNull(),
	// WHICH MODEL LEARNED THIS MAP (FOR AUDIT / RE-LEARN DECISIONS)
	model: text('model').notNull(),
	// INCREMENTS ON EVERY RE-HEAL SO AN OLD MAP CAN BE DIFFED / ROLLED BACK
	version: integer('version').notNull().default(1),
	// THE PAGE THE MAP WAS LEARNED FROM
	sampleUrl: text('sample_url'),
	// COOLDOWN ANCHOR — BLOCKS RE-HEALING THE SAME HOST MORE THAN ONCE PER WINDOW (ANTI-THRASH / COST)
	lastHealAt: epochMs('last_heal_at'),
	createdAt: epochMs('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
	updatedAt: epochMs('updated_at')
		.notNull()
		.$defaultFn(() => Date.now()),
});

// LOG OF EVERY WEB-CHAPTER FETCH OUTCOME — POWERS THE SITES DASHBOARD: WHICH HOSTS WORK, WHICH FAIL,
// AND WHY (BY OUR TYPED ERROR KINDS + STATUS CODES). ONE ROW PER fetchChapter ATTEMPT. GLOBAL/SHARED.
export const siteEvents = pgTable(
	'site_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		// REGISTRABLE HOST WITH A LEADING www. STRIPPED (e.g. 'uukanshu.cc')
		host: text('host').notNull(),
		url: text('url').notNull(),
		// 1 = SUCCESS, 0 = FAILURE (KEPT AS integer 0/1 — NOT A boolean — SO EXISTING ok=1/ok=0 QUERIES STAND)
		ok: integer('ok').notNull(),
		// 'ok' ON SUCCESS, ELSE A FetchErrorKind (invalid_url / blocked_bot / unsupported_site / …)
		kind: text('kind').notNull(),
		// HTTP-ISH STATUS THE USER WOULD SEE (200, 404, 422, 502, …)
		status: integer('status').notNull(),
		// THE FRIENDLY FAILURE MESSAGE (NULL ON SUCCESS)
		message: text('message'),
		createdAt: epochMs('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => [
		index('site_events_host_idx').on(t.host),
		index('site_events_created_idx').on(t.createdAt),
		index('site_events_kind_idx').on(t.kind),
	],
);

// LEDGER OF AI SPEND OUTSIDE THE translations CACHE — CURRENTLY THE SITE-MAPPING (SELECTOR-LEARNING)
// CALLS. RECORDED AT THE CALL SITE SO COST IS CAPTURED EVEN IF THE OVERALL FETCH LATER FAILS. THE
// DASHBOARD UNIONS THIS WITH translations (PER-CHAPTER TRANSLATION COST) FOR THE TOTAL AI SPEND.
export const aiUsage = pgTable(
	'ai_usage',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		// 'map' = SITE SELECTOR LEARNING; 'extract' | 'title' | 'term' | 'repair' = PER-CHAPTER PIPELINE SPEND
		kind: text('kind').notNull(),
		host: text('host'),
		// THE CHAPTER THIS SPEND BELONGS TO (NULL FOR NON-CHAPTER CALLS LIKE SITE MAPPING OR A BOOK-TITLE
		// BACKFILL) — LETS THE CHAPTER STATS DIALOG COUNT EXTRACTION/TITLE/REPAIR ALONGSIDE THE BODY COST.
		// CHAPTER-LINKED ROWS INHERIT PER-USER OWNERSHIP THROUGH THIS FK CHAIN (PHASE 4); 'map' STAYS GLOBAL.
		chapterId: bigint('chapter_id', { mode: 'number' }).references(() => chapters.id, { onDelete: 'cascade' }),
		model: text('model').notNull(),
		promptTokens: integer('prompt_tokens').notNull().default(0),
		cachedTokens: integer('cached_tokens').notNull().default(0),
		completionTokens: integer('completion_tokens').notNull().default(0),
		costUsd: doublePrecision('cost_usd').notNull().default(0),
		createdAt: epochMs('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => [
		index('ai_usage_created_idx').on(t.createdAt),
		index('ai_usage_kind_idx').on(t.kind),
		index('ai_usage_chapter_idx').on(t.chapterId),
	],
);

// -- TYPES -- //

export type User = typeof users.$inferSelect;

export type Book = typeof books.$inferSelect;

export type NewBook = typeof books.$inferInsert;

export type Chapter = typeof chapters.$inferSelect;

export type NewChapter = typeof chapters.$inferInsert;

export type Translation = typeof translations.$inferSelect;

export type GlossaryEntry = typeof glossary.$inferSelect;

export type NewGlossaryEntry = typeof glossary.$inferInsert;

export type SiteAdapter = typeof siteAdapters.$inferSelect;

export type SiteEvent = typeof siteEvents.$inferSelect;

export type AiUsage = typeof aiUsage.$inferSelect;
