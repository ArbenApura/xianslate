ALTER TABLE "books" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;