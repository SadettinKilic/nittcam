CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."command_actor" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."export_kind" AS ENUM('nc', 'dxf', 'pdf', 'report');--> statement-breakpoint
CREATE TYPE "public"."offcut_status" AS ENUM('available', 'reserved', 'used');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'produced', 'completed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator');--> statement-breakpoint
CREATE TYPE "public"."validation_level" AS ENUM('nittcam_tested', 'user_approved');--> statement-breakpoint
CREATE TYPE "public"."validation_stage" AS ENUM('draft', 'air_cut_approved', 'test_cut_approved', 'verified');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"month" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_company_month_uq" UNIQUE("company_id","month"),
	CONSTRAINT "ai_usage_month_first_day" CHECK (extract(day from "ai_usage"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"suggested_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_key" text,
	"plan" text DEFAULT 'trial' NOT NULL,
	"ai_quota_monthly" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_revision" integer NOT NULL,
	"machine_profile_version_id" uuid NOT NULL,
	"post_version" text NOT NULL,
	"kind" "export_kind" NOT NULL,
	"file_key" text NOT NULL,
	"sha256" text NOT NULL,
	"validation_stage" "validation_stage" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"post_config" jsonb NOT NULL,
	"post_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mpv_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "mpv_machine_version_uq" UNIQUE("machine_id","version"),
	CONSTRAINT "mpv_version_positive" CHECK ("machine_profile_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"maintenance_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_company_id_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"thickness" double precision NOT NULL,
	"feed" double precision NOT NULL,
	"spindle_speed" integer NOT NULL,
	"step_down" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offcuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"material" text NOT NULL,
	"thickness" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"grain" integer,
	"source_project_id" uuid,
	"status" "offcut_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offcuts_grain" CHECK ("offcuts"."grain" is null or "offcuts"."grain" in (0, 90)),
	CONSTRAINT "offcuts_size_positive" CHECK ("offcuts"."width" > 0 and "offcuts"."height" > 0 and "offcuts"."thickness" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"seq" integer NOT NULL,
	"command" text NOT NULL,
	"params" jsonb NOT NULL,
	"actor" "command_actor" NOT NULL,
	"user_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pc_project_revision_seq_uq" UNIQUE("project_id","revision","seq")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "projects_revision_positive" CHECK ("projects"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"geometry" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tv_template_version_uq" UNIQUE("template_id","version"),
	CONSTRAINT "tv_version_positive" CHECK ("template_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_company_id_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"type" text NOT NULL,
	"diameter" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_machine_number_uq" UNIQUE("machine_id","number"),
	CONSTRAINT "tools_number_positive" CHECK ("tools"."number" >= 1),
	CONSTRAINT "tools_diameter_positive" CHECK ("tools"."diameter" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" "user_role" DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_company_id_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_profile_version_id" uuid NOT NULL,
	"tool_set" jsonb NOT NULL,
	"post_version" text NOT NULL,
	"stage" "validation_stage" NOT NULL,
	"level" "validation_level" DEFAULT 'user_approved' NOT NULL,
	"measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_mpv_fk" FOREIGN KEY ("company_id","machine_profile_version_id") REFERENCES "public"."machine_profile_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_user_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_profile_versions" ADD CONSTRAINT "machine_profile_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_profile_versions" ADD CONSTRAINT "mpv_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offcuts" ADD CONSTRAINT "offcuts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offcuts" ADD CONSTRAINT "offcuts_project_fk" FOREIGN KEY ("company_id","source_project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_commands" ADD CONSTRAINT "project_commands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_commands" ADD CONSTRAINT "pc_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_commands" ADD CONSTRAINT "pc_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "tv_template_fk" FOREIGN KEY ("company_id","template_id") REFERENCES "public"."templates"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validations" ADD CONSTRAINT "validations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validations" ADD CONSTRAINT "validations_mpv_fk" FOREIGN KEY ("company_id","machine_profile_version_id") REFERENCES "public"."machine_profile_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validations" ADD CONSTRAINT "validations_user_fk" FOREIGN KEY ("company_id","approved_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_company_project_idx" ON "chat_messages" USING btree ("company_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "exports_company_project_idx" ON "exports" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "mpv_company_machine_idx" ON "machine_profile_versions" USING btree ("company_id","machine_id");--> statement-breakpoint
CREATE INDEX "materials_company_idx" ON "materials" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "offcuts_company_material_idx" ON "offcuts" USING btree ("company_id","material","thickness");--> statement-breakpoint
CREATE INDEX "pc_company_project_idx" ON "project_commands" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "projects_company_updated_idx" ON "projects" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "tv_company_template_idx" ON "template_versions" USING btree ("company_id","template_id");--> statement-breakpoint
CREATE INDEX "tools_company_machine_idx" ON "tools" USING btree ("company_id","machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "validations_company_mpv_idx" ON "validations" USING btree ("company_id","machine_profile_version_id");