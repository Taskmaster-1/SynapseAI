ALTER TABLE "automations" ADD COLUMN "run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "kind" text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "timezone" text;