ALTER TABLE "rheo_context_receipts" ADD COLUMN "entry_revisions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rheo_entries" ADD CONSTRAINT "rheo_entries_org_id_space_id_rheo_spaces_org_id_id_fk" FOREIGN KEY ("org_id","space_id") REFERENCES "public"."rheo_spaces"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rheo_entries_space_idx" ON "rheo_entries" USING btree ("org_id","space_id","state","visibility");