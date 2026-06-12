CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"avatar_url" text,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
