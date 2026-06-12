DROP INDEX IF EXISTS "chapters_url_unq";--> statement-breakpoint
DROP INDEX IF EXISTS "glossary_global_unq";--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "glossary" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "books" ADD CONSTRAINT "books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glossary" ADD CONSTRAINT "glossary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_user_idx" ON "books" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glossary_user_idx" ON "glossary" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_url_unq" ON "chapters" USING btree ("book_id","chapter_url");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glossary_global_unq" ON "glossary" USING btree ("user_id","source_lang","target_lang","source") WHERE "glossary"."scope" = 'global';