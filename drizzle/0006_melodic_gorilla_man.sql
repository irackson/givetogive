ALTER TABLE "givetogive_user" ADD COLUMN "hashed_password" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_difficulty_idx" ON "givetogive_ask" USING btree ("difficulty");