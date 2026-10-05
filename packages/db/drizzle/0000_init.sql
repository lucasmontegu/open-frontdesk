CREATE TABLE "bot_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"eval_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"published_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bot_version_id" text NOT NULL,
	"passed" boolean NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"effect" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"when_expr" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real NOT NULL,
	"source_event_id" text NOT NULL,
	"source_conversation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"display_name" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"do_not_call" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"portfolio_id" text,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"amount" numeric(14, 2),
	"currency" text,
	"due_at" timestamp with time zone,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"owner" text,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"contact_id" text,
	"bot_version_id" text NOT NULL,
	"mission_id" text,
	"outcome" text,
	"summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"conversation_id" text,
	"bot_version_id" text,
	"contact_id" text,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bot_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"created_by" text NOT NULL,
	"instruction" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"plan" jsonb,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_bot_version_id_bot_versions_id_fk" FOREIGN KEY ("bot_version_id") REFERENCES "public"."bot_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_facts" ADD CONSTRAINT "contact_facts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_versions_bot_version_uq" ON "bot_versions" USING btree ("org_id","bot_id","version");--> statement-breakpoint
CREATE INDEX "bots_org_idx" ON "bots" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_org_version_idx" ON "eval_runs" USING btree ("org_id","bot_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_org_rule_uq" ON "policies" USING btree ("org_id","rule_id");--> statement-breakpoint
CREATE INDEX "contact_facts_org_contact_idx" ON "contact_facts" USING btree ("org_id","contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_lookup_uq" ON "contact_identities" USING btree ("org_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_identities_contact_idx" ON "contact_identities" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "contacts_org_created_idx" ON "contacts" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "obligations_org_contact_idx" ON "obligations" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "obligations_org_due_idx" ON "obligations" USING btree ("org_id","due_at");--> statement-breakpoint
CREATE INDEX "portfolios_org_idx" ON "portfolios" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_org_contact_idx" ON "conversations" USING btree ("org_id","contact_id","started_at");--> statement-breakpoint
CREATE INDEX "events_org_conversation_idx" ON "events" USING btree ("org_id","conversation_id","occurred_at","seq");--> statement-breakpoint
CREATE INDEX "events_org_occurred_idx" ON "events" USING btree ("org_id","occurred_at" DESC NULLS LAST,"seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_docs_org_idx" ON "knowledge_docs" USING btree ("org_id","bot_id");--> statement-breakpoint
CREATE INDEX "missions_org_created_idx" ON "missions" USING btree ("org_id","created_at");