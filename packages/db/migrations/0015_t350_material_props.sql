ALTER TABLE "materials" ADD COLUMN "props" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "offcuts" ADD COLUMN "props" jsonb DEFAULT '{}'::jsonb NOT NULL;