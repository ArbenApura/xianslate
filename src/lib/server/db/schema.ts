import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// -- BOOKS -- //
// A LIBRARY ENTRY FROM ANY SOURCE. id IS THE SITE BOOK id FOR web, A GENERATED id FOR epub/txt.

export const books = sqliteTable('books', {
	id: text('id').primaryKey(),
	sourceType: text('source_type', { enum: ['web', 'epub', 'txt', 'manual'] }).notNull(),
	title: text('title').notNull(),
	titleEn: text('title_en'),
	author: text('author'),
	sourceUrl: text('source_url'),
	coverUrl: text('cover_url'),
	lastChapterId: integer('last_chapter_id'),
	// WHEN ANY CHAPTER OF THIS BOOK WAS LAST OPENED — DRIVES THE "CONTINUE READING" PICK (MOST RECENT WINS)
	lastReadAt: integer('last_read_at'),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
});

// -- CHAPTERS -- //
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
		titleZh: text('title_zh').notNull(),
		titleEn: text('title_en'),
		contentZh: text('content_zh').notNull(),
		contentEn: text('content_en'),
		prevUrl: text('prev_url'),
		nextUrl: text('next_url'),
		indexUrl: text('index_url'),
		fetchedAt: integer('fetched_at'),
		translatedAt: integer('translated_at'),
		// WHEN GLOSSARY TERMS WERE AUTO-EXTRACTED FROM THIS CHAPTER (NULL = NEVER) — GATES RE-BILLING
		extractedAt: integer('extracted_at'),
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

// -- TRANSLATIONS -- //
// MEMOIZED TRANSLATIONS KEYED BY content+glossary+model+prompt FINGERPRINT.

export const translations = sqliteTable(
	'translations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		chapterId: integer('chapter_id')
			.notNull()
			.references(() => chapters.id, { onDelete: 'cascade' }),
		cacheKey: text('cache_key').notNull(),
		contentEn: text('content_en').notNull(),
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

// -- GLOSSARY -- //
// scope='global' (bookId NULL) APPLIES TO EVERY BOOK; scope='book' IS PRIVATE.
// EFFECTIVE GLOSSARY = global UNION book, WITH book OVERRIDING global ON THE SAME raw.

export const glossary = sqliteTable(
	'glossary',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		scope: text('scope', { enum: ['global', 'book'] }).notNull(),
		bookId: text('book_id').references(() => books.id, { onDelete: 'cascade' }),
		raw: text('raw').notNull(),
		translation: text('translation').notNull(),
		gender: text('gender', { enum: ['neuter', 'masculine', 'feminine'] })
			.notNull()
			.default('neuter'),
		tags: text('tags'),
		createdAt: integer('created_at')
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer('updated_at')
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(t) => ({
		// PARTIAL UNIQUE INDEXES — ONE GLOBAL raw, ONE raw PER BOOK
		globalUnq: uniqueIndex('glossary_global_unq')
			.on(t.raw)
			.where(sql`${t.scope} = 'global'`),
		bookUnq: uniqueIndex('glossary_book_unq')
			.on(t.bookId, t.raw)
			.where(sql`${t.scope} = 'book'`),
		bookIdx: index('glossary_book_idx').on(t.bookId),
	}),
);

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
export type Translation = typeof translations.$inferSelect;
export type GlossaryEntry = typeof glossary.$inferSelect;
export type NewGlossaryEntry = typeof glossary.$inferInsert;
