ALTER TABLE "materials" ADD COLUMN "thicknesses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "tone" text DEFAULT 'natural' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "grain" double precision;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "sheet_sizes" jsonb DEFAULT '[]'::jsonb NOT NULL;