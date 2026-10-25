ALTER TABLE "tool_calls" ADD COLUMN "execute_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "undo_seconds" integer DEFAULT 10 NOT NULL;