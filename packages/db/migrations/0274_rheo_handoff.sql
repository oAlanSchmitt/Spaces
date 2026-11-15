ALTER TABLE "rheo_projects" ADD COLUMN "folder_path" text;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD COLUMN "handoff_objective" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rheo_projects" ADD COLUMN "handoff_criteria" text DEFAULT '' NOT NULL;