DROP INDEX "exports_company_project_idx";--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "post_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "verification_state" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "unverified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "accepted_unverified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_accepted_by_fk" FOREIGN KEY ("company_id","accepted_by") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exports_idempotency_uq" ON "exports" USING btree ("company_id","project_id","project_revision","machine_profile_version_id","post_id","post_version","kind","sha256");--> statement-breakpoint
CREATE INDEX "exports_company_project_idx" ON "exports" USING btree ("company_id","project_id","created_at");--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_unverified_accepted" CHECK ("exports"."unverified" = false OR "exports"."accepted_unverified_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_verification_state" CHECK ("exports"."verification_state" IN ('draft', 'air_cut_approved', 'test_cut_approved', 'verified', 'reverify_needed'));