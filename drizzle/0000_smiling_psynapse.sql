CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"host" text,
	"chapter_id" bigint,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "books" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"title" text NOT NULL,
	"title_target" text,
	"author" text,
	"author_target" text,
	"source_url" text,
	"cover_url" text,
	"last_chapter_id" bigint,
	"last_read_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"book_id" text NOT NULL,
	"seq" integer NOT NULL,
	"chapter_url" text,
	"site_chapter_id" text,
	"title_source" text NOT NULL,
	"title_target" text,
	"content_source" text NOT NULL,
	"content_target" text,
	"prev_url" text,
	"next_url" text,
	"index_url" text,
	"fetched_at" bigint,
	"translated_at" bigint,
	"extracted_at" bigint,
	"read_progress" double precision
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "glossary" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"book_id" text,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"gender" text DEFAULT 'neuter' NOT NULL,
	"context" text,
	"tags" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_adapters" (
	"host" text PRIMARY KEY NOT NULL,
	"mapping" text NOT NULL,
	"model" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sample_url" text,
	"last_heal_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"url" text NOT NULL,
	"ok" integer NOT NULL,
	"kind" text NOT NULL,
	"status" integer NOT NULL,
	"message" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chapter_id" bigint NOT NULL,
	"cache_key" text NOT NULL,
	"content_target" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"cached_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" double precision,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glossary" ADD CONSTRAINT "glossary_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translations" ADD CONSTRAINT "translations_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_kind_idx" ON "ai_usage" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_chapter_idx" ON "ai_usage" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_uuid_unq" ON "chapters" USING btree ("uuid");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_book_seq_unq" ON "chapters" USING btree ("book_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_url_unq" ON "chapters" USING btree ("chapter_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_book_idx" ON "chapters" USING btree ("book_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glossary_global_unq" ON "glossary" USING btree ("source_lang","target_lang","source") WHERE "glossary"."scope" = 'global';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glossary_book_unq" ON "glossary" USING btree ("book_id","source") WHERE "glossary"."scope" = 'book';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glossary_book_idx" ON "glossary" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_host_idx" ON "site_events" USING btree ("host");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_created_idx" ON "site_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_kind_idx" ON "site_events" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "translations_cache_key_unq" ON "translations" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_chapter_idx" ON "translations" USING btree ("chapter_id");