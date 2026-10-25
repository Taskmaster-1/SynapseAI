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
ALTER TABLE "slack_accounts" ADD CONSTRAINT "slack_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_accounts_team_user_idx" ON "slack_accounts" USING btree ("team_id","slack_user_id");