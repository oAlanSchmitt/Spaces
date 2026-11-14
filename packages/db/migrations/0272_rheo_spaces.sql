CREATE TABLE "rheo_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rheo_businesses_orgId_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "rheo_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"native_org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"request_key" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rheo_projects_nativeOrgId_unique" UNIQUE("native_org_id"),
	CONSTRAINT "rheo_projects_orgId_requestKey_unique" UNIQUE("org_id","request_key"),
	CONSTRAINT "rheo_project_state" CHECK ("rheo_projects"."state" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "rheo_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rheo_spaces_orgId_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "rheo_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"instructions" text NOT NULL,
	CONSTRAINT "rheo_templates_orgId_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "rheo_templates_orgId_name_version_unique" UNIQUE("org_id","name","version")
);
--> statement-breakpoint
CREATE TABLE "rheo_workspaces" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"control_org_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "rheo_workspace_kind" CHECK ("rheo_workspaces"."kind" in ('control', 'project')),
	CONSTRAINT "rheo_workspace_state" CHECK ("rheo_workspaces"."state" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rheo_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rheo_businesses" ADD CONSTRAINT "rheo_businesses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD CONSTRAINT "rheo_projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD CONSTRAINT "rheo_projects_native_org_id_organizations_id_fk" FOREIGN KEY ("native_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD CONSTRAINT "rheo_projects_org_id_space_id_rheo_spaces_org_id_id_fk" FOREIGN KEY ("org_id","space_id") REFERENCES "public"."rheo_spaces"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD CONSTRAINT "rheo_projects_org_id_template_id_rheo_templates_org_id_id_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."rheo_templates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD CONSTRAINT "rheo_projects_native_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("native_org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_spaces" ADD CONSTRAINT "rheo_spaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_spaces" ADD CONSTRAINT "rheo_spaces_org_id_business_id_rheo_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."rheo_businesses"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_templates" ADD CONSTRAINT "rheo_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_workspaces" ADD CONSTRAINT "rheo_workspaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_workspaces" ADD CONSTRAINT "rheo_workspaces_control_org_id_organizations_id_fk" FOREIGN KEY ("control_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rheo_workspaces" ADD CONSTRAINT "rheo_workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rheo_business_name" ON "rheo_businesses" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "rheo_space_name" ON "rheo_spaces" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "rheo_owner_control" ON "rheo_workspaces" USING btree ("owner_user_id") WHERE "rheo_workspaces"."kind" = 'control';