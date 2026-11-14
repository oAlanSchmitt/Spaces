CREATE TABLE "rheo_context_receipts" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rheo_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"visibility" text DEFAULT 'project' NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rheo_entries_orgId_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "rheo_context_receipts" ADD CONSTRAINT "rheo_context_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_context_receipts" ADD CONSTRAINT "rheo_receipt_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_context_receipts" ADD CONSTRAINT "rheo_receipt_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_context_receipts" ADD CONSTRAINT "rheo_receipt_agent_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD CONSTRAINT "rheo_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD CONSTRAINT "rheo_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD CONSTRAINT "rheo_entries_org_id_created_by_agent_id_agents_org_id_id_fk" FOREIGN KEY ("org_id","created_by_agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD CONSTRAINT "rheo_entry_source_run_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rheo_entries_scope_idx" ON "rheo_entries" USING btree ("org_id","kind","state","visibility");