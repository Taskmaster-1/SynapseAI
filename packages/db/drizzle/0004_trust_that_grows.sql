ALTER TABLE "runs" ADD COLUMN "plan_grants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "execute_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "dismissed_suggestions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "undo_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
CREATE INDEX "tool_calls_user_decided_idx" ON "tool_calls" USING btree ("user_id","decided_at");