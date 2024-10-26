-- auto generated
-- ALTER TABLE "givetogive_ask" ADD COLUMN "slug" varchar(256) NOT NULL;--> statement-breakpoint
-- CREATE INDEX IF NOT EXISTS "asks_slug_idx" ON "givetogive_ask" USING btree ("slug");--> statement-breakpoint
-- ALTER TABLE "givetogive_ask" ADD CONSTRAINT "givetogive_ask_slug_unique" UNIQUE("slug");

-- manual implementation to backfill the slug column
-- Step 1: Add the `slug` column as nullable initially
ALTER TABLE "givetogive_ask" ADD COLUMN "slug" varchar(256);

-- Step 2: Backfill existing rows with unique slugs based on the `id`
UPDATE "givetogive_ask" SET "slug" = CONCAT('backfilled-slug', id) WHERE "slug" IS NULL;

-- Step 3: Alter the `slug` column to be NOT NULL after backfilling
ALTER TABLE "givetogive_ask" ALTER COLUMN "slug" SET NOT NULL;

-- Step 4: Add a unique index and unique constraint to ensure `slug` remains unique
CREATE INDEX IF NOT EXISTS "asks_slug_idx" ON "givetogive_ask" USING btree ("slug");
ALTER TABLE "givetogive_ask" ADD CONSTRAINT "givetogive_ask_slug_unique" UNIQUE("slug");
