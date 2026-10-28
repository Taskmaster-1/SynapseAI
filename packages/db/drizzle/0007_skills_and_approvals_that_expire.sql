CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "untrusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "first_approved_by" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "first_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "first_approved_via" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "skills" jsonb;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "disabled_skills" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "expire_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "escalate_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "expire_hours" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "two_person" text;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_user_name_idx" ON "skills" USING btree ("user_id","name");