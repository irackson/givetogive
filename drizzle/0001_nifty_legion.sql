CREATE TABLE IF NOT EXISTS "givetogive_ask" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"estimated_minutes_to_complete" integer NOT NULL,
	"status" varchar(50) DEFAULT 'not_started' NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"fulfilled_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX IF EXISTS "created_by_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "name_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "givetogive_ask" ADD CONSTRAINT "givetogive_ask_created_by_givetogive_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "givetogive_ask" ADD CONSTRAINT "givetogive_ask_fulfilled_by_givetogive_user_id_fk" FOREIGN KEY ("fulfilled_by") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_created_by_idx" ON "givetogive_ask" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_title_idx" ON "givetogive_ask" USING btree ("title");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_created_by_idx" ON "givetogive_post" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_name_idx" ON "givetogive_post" USING btree ("name");