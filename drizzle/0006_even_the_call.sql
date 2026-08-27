ALTER TABLE "givetogive_user" ADD COLUMN "hashed_password" varchar(255);--> statement-breakpoint
CREATE INDEX "ask_difficulty_idx" ON "givetogive_ask" USING btree ("difficulty");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_unique_idx" ON "givetogive_user" USING btree (lower("email"));