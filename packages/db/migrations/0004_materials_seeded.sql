ALTER TABLE "companies" ADD COLUMN "materials_seeded_at" timestamp with time zone;--> statement-breakpoint
-- D-044: companies that already have a library count as seeded (an emptied one stays empty).
UPDATE "companies" SET "materials_seeded_at" = now() WHERE EXISTS (SELECT 1 FROM "materials" WHERE "materials"."company_id" = "companies"."id");
