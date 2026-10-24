CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"account" text NOT NULL,
	"status" text NOT NULL,
	"secret" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ALTER COLUMN "schedule" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "trigger" jsonb DEFAULT '{"type":"schedule"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "cursor" jsonb;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_provider_idx" ON "integrations" USING btree ("user_id","provider");