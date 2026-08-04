ALTER TABLE "fetch_usage" ADD COLUMN "chapter_id" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fetch_usage" ADD CONSTRAINT "fetch_usage_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetch_usage_chapter_idx" ON "fetch_usage" USING btree ("chapter_id");