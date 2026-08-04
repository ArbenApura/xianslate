CREATE TABLE IF NOT EXISTS "fetch_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"host" text,
	"provider" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fetch_usage" ADD CONSTRAINT "fetch_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetch_usage_user_idx" ON "fetch_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetch_usage_created_idx" ON "fetch_usage" USING btree ("created_at");