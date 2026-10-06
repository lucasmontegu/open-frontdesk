CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"contact_window" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
