CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "slack_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"bot_user_id" text,
	"bot_token" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_messages" (
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"ts" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_messages_run_id_tool_call_id_user_id_pk" PRIMARY KEY("run_id","tool_call_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "email_alerts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_accounts" ADD CONSTRAINT "slack_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_accounts_team_user_idx" ON "slack_accounts" USING btree ("team_id","slack_user_id");