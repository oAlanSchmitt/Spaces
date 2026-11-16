ALTER TABLE "rheo_projects" ADD CONSTRAINT "rheo_projects_nativeOrgId_id_unique" UNIQUE("native_org_id","id");
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_orgId_id_unique" UNIQUE("org_id","id");
--> statement-breakpoint
CREATE TABLE "rheo_project_work" (
	"org_id" uuid NOT NULL,
	"project_id" uuid PRIMARY KEY NOT NULL,
	"folder_path" text NOT NULL,
	"host_id" text NOT NULL,
	"account_fingerprint" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"probe_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rheo_project_work_orgId_projectId_unique" UNIQUE("org_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "rheo_work_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"binding_revision" uuid NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rheo_work_turns_orgId_runId_callId_unique" UNIQUE("org_id","run_id","call_id")
);
--> statement-breakpoint
ALTER TABLE "rheo_project_work" ADD CONSTRAINT "rheo_project_work_org_id_project_id_rheo_projects_native_org_id_id_fk" FOREIGN KEY ("org_id","project_id") REFERENCES "public"."rheo_projects"("native_org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_work_turns" ADD CONSTRAINT "rheo_work_turns_org_id_project_id_rheo_projects_native_org_id_id_fk" FOREIGN KEY ("org_id","project_id") REFERENCES "public"."rheo_projects"("native_org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_work_turns" ADD CONSTRAINT "rheo_work_turns_org_id_run_id_agent_runs_org_id_id_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."agent_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
