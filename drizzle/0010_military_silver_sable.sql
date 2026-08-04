DROP TABLE "credit_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "usage_counters" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "tier";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "tier_status";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "tier_current_period_end";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "credit_balance";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "mor_customer_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "mor_sub_id";