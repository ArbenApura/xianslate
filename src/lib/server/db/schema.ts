// IMPORTED DEP-MODULES
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// -- CONSTANTS -- //

// A LIBRARY ENTRY FROM ANY SOURCE. id IS THE SITE BOOK id FOR web, A GENERATED id FOR epub/txt.
export const books = sqliteTable('books', {
	id: text('id').primaryKey(),
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
	lastChapterId: integer('last_chapter_id'),
	// WHEN ANY CHAPTER OF THIS BOOK WAS LAST OPENED — DRIVES THE "CONTINUE READING" PICK (MOST RECENT WINS)
	lastReadAt: integer('last_read_at'),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
});

// CACHE OF FETCHED/IMPORTED CHAPTERS. WEB NAV USES prevUrl/nextUrl; EPUB/TXT NAV USES seq.
export const chapters = sqliteTable(
	'chapters',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// STABLE PUBLIC IDENTIFIER USED IN URLS (DECOUPLED FROM THE AUTOINCREMENT PK)
		uuid: text('uuid')
			.notNull()
			.$defaultFn(() => crypto.randomUUID()),
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
		fetchedAt: integer('fetched_at'),
		translatedAt: integer('translated_at'),
		// WHEN GLOSSARY TERMS WERE AUTO-EXTRACTED FROM THIS CHAPTER (NULL = NEVER) — GATES RE-BILLING
		extractedAt: integer('extracted_at'),
		// HOW MUCH OF THE CHAPTER HAS ACTUALLY BEEN READ (0..1 = FRACTION OF CONTENT SCROLLED INTO VIEW,
		// MONOTONIC MAX). DRIVES THE "READ" CHECKMARK IN THE LISTS — A CHAPTER IS DONE ONLY WHEN THE READER
		// SCROLLED TO THE END, NOT JUST BECAUSE IT SITS BEFORE THE CURRENT ONE. NULL = NEVER OPENED.
		readProgress: real('read_progress'),
	},
	(t) => ({
		// STABLE URL IDENTIFIER
		uuidUnq: uniqueIndex('chapters_uuid_unq').on(t.uuid),
		// UNIQUE PER BOOK+SEQ FOR ORDERED IMPORTS
		bookSeqUnq: uniqueIndex('chapters_book_seq_unq').on(t.bookId, t.seq),
		// UNIQUE WEB URL (NULLS ARE DISTINCT IN SQLITE, SO IMPORTS ARE UNAFFECTED)
		chapterUrlUnq: uniqueIndex('chapters_url_unq').on(t.chapterUrl),
		bookIdx: index('chapters_book_idx').on(t.bookId),
	}),
);

// MEMOIZED TRANSLATIONS KEYED BY content+glossary+model+prompt FINGERPRINT.
export const translations = sqliteTable(
	'translations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		chapterId: integer('chapter_id')
			.notNull()
			.references(() => chapters.id, { onDelete: 'cascade' }),
		cacheKey: text('cache_key').notNull(),
		contentTarget: text('content_target').notNull(),
		model: text('model').notNull(),
		promptTokens: integer('prompt_tokens'),
		cachedTokens: integer('cached_tokens'),
		completionTokens: integer('completion_tokens'),
		costUsd: real('cost_usd'),
		createdAt: integer('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => ({
		cacheKeyUnq: uniqueIndex('translations_cache_key_unq').on(t.cacheKey),
		chapterIdx: index('translations_chapter_idx').on(t.chapterId),
	}),
);

// scope='global' (bookId NULL) APPLIES TO EVERY BOOK *OF THE SAME LANGUAGE PAIR*; scope='book' IS PRIVATE.
// EFFECTIVE GLOSSARY FOR A BOOK = global(matching the book's sourceLang+targetLang) UNION book, WITH book
// OVERRIDING global ON THE SAME source. EACH ROW IS TAGGED WITH ITS LANGUAGE PAIR SO A CHINESE GLOSSARY
// NEVER LEAKS INTO A JAPANESE BOOK SHARING THE SAME LIBRARY.
export const glossary = sqliteTable(
	'glossary',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
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
		createdAt: integer('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer('updated_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => ({
		// PARTIAL UNIQUE INDEXES — ONE GLOBAL source PER LANGUAGE PAIR, ONE source PER BOOK
		globalUnq: uniqueIndex('glossary_global_unq')
			.on(t.sourceLang, t.targetLang, t.source)
			.where(sql`${t.scope} = 'global'`),
		bookUnq: uniqueIndex('glossary_book_unq')
			.on(t.bookId, t.source)
			.where(sql`${t.scope} = 'book'`),
		bookIdx: index('glossary_book_idx').on(t.bookId),
	}),
);

// AI-LEARNED PARSING MAP FOR A SCRAPED SITE, KEYED BY HOST. THE TRANSPORT LAYER IS GENERIC; THIS TABLE
// IS HOW A NEW HOST BECOMES PARSEABLE WITHOUT CODE CHANGES. THE AI MAPS *SELECTORS* ONCE PER SITE
// (NOT CONTENT PER PAGE), SO EVERY LATER CHAPTER IS PARSED DETERMINISTICALLY AT ZERO LLM COST. WHEN
// THE SELECTORS STOP MATCHING (SITE REDESIGN) THE FETCHER RE-LEARNS AND BUMPS version (SELF-HEALING).
export const siteAdapters = sqliteTable('site_adapters', {
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
	lastHealAt: integer('last_heal_at'),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
	updatedAt: integer('updated_at')
		.notNull()
		.$defaultFn(() => Date.now()),
});

// LOG OF EVERY WEB-CHAPTER FETCH OUTCOME — POWERS THE SITES DASHBOARD: WHICH HOSTS WORK, WHICH FAIL,
// AND WHY (BY OUR TYPED ERROR KINDS + STATUS CODES). ONE ROW PER fetchChapter ATTEMPT.
export const siteEvents = sqliteTable(
	'site_events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// REGISTRABLE HOST WITH A LEADING www. STRIPPED (e.g. 'uukanshu.cc')
		host: text('host').notNull(),
		url: text('url').notNull(),
		// 1 = SUCCESS, 0 = FAILURE
		ok: integer('ok').notNull(),
		// 'ok' ON SUCCESS, ELSE A FetchErrorKind (invalid_url / blocked_bot / unsupported_site / …)
		kind: text('kind').notNull(),
		// HTTP-ISH STATUS THE USER WOULD SEE (200, 404, 422, 502, …)
		status: integer('status').notNull(),
		// THE FRIENDLY FAILURE MESSAGE (NULL ON SUCCESS)
		message: text('message'),
		createdAt: integer('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => ({
		hostIdx: index('site_events_host_idx').on(t.host),
		createdIdx: index('site_events_created_idx').on(t.createdAt),
		kindIdx: index('site_events_kind_idx').on(t.kind),
	}),
);

// LEDGER OF AI SPEND OUTSIDE THE translations CACHE — CURRENTLY THE SITE-MAPPING (SELECTOR-LEARNING)
// CALLS. RECORDED AT THE CALL SITE SO COST IS CAPTURED EVEN IF THE OVERALL FETCH LATER FAILS. THE
// DASHBOARD UNIONS THIS WITH translations (PER-CHAPTER TRANSLATION COST) FOR THE TOTAL AI SPEND.
export const aiUsage = sqliteTable(
	'ai_usage',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// 'map' = SITE SELECTOR LEARNING (ROOM FOR 'extract' ETC. LATER)
		kind: text('kind').notNull(),
		host: text('host'),
		model: text('model').notNull(),
		promptTokens: integer('prompt_tokens').notNull().default(0),
		cachedTokens: integer('cached_tokens').notNull().default(0),
		completionTokens: integer('completion_tokens').notNull().default(0),
		costUsd: real('cost_usd').notNull().default(0),
		createdAt: integer('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => ({
		createdIdx: index('ai_usage_created_idx').on(t.createdAt),
		kindIdx: index('ai_usage_kind_idx').on(t.kind),
	}),
);

// -- TYPES -- //

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
