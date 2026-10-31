ALTER TABLE "slack_accounts" ADD COLUMN "user_token" text;--> statement-breakpoint
ALTER TABLE "slack_accounts" ADD COLUMN "user_scopes" text DEFAULT '' NOT NULL;