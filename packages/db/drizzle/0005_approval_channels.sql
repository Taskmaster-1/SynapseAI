ALTER TABLE "tool_calls" ADD COLUMN "decided_via" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "notified_at" timestamp with time zone;