ALTER TABLE "materials" DROP COLUMN "thickness";--> statement-breakpoint
ALTER TABLE "materials" DROP COLUMN "feed";--> statement-breakpoint
ALTER TABLE "materials" DROP COLUMN "spindle_speed";--> statement-breakpoint
ALTER TABLE "materials" DROP COLUMN "step_down";--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_id_uq" UNIQUE("company_id","id");