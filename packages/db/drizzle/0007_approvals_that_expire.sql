ALTER TABLE "tool_calls" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "first_approved_by" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "first_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "first_approved_via" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "expire_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "escalate_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "expire_hours" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "two_person" text;