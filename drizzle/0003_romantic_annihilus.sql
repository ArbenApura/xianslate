ALTER TABLE "glossary" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "glossary" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "glossary" ADD COLUMN "status" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "glossary" ADD COLUMN "aliases" text;--> statement-breakpoint
ALTER TABLE "glossary" ADD COLUMN "first_chapter_id" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glossary" ADD CONSTRAINT "glossary_first_chapter_id_chapters_id_fk" FOREIGN KEY ("first_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
