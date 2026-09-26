CREATE TABLE "givetogive_ask_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"ask_id" integer NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"contribution_id" integer,
	"type" varchar(40) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ask_activity_type_check" CHECK ("givetogive_ask_activity"."type" IN ('ask_created', 'ask_updated', 'contribution_created', 'contribution_completed', 'contribution_cancelled'))
);
--> statement-breakpoint
CREATE TABLE "givetogive_saved_ask" (
	"user_id" varchar(255) NOT NULL,
	"ask_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "givetogive_saved_ask_user_id_ask_id_pk" PRIMARY KEY("user_id","ask_id")
);
--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "location" varchar(120);--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_user" ALTER COLUMN "joined_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "givetogive_ask_activity" ADD CONSTRAINT "givetogive_ask_activity_ask_id_givetogive_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."givetogive_ask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_ask_activity" ADD CONSTRAINT "givetogive_ask_activity_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_ask_activity" ADD CONSTRAINT "givetogive_ask_activity_contribution_id_givetogive_ask_contribution_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."givetogive_ask_contribution"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_saved_ask" ADD CONSTRAINT "givetogive_saved_ask_user_id_givetogive_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."givetogive_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_saved_ask" ADD CONSTRAINT "givetogive_saved_ask_ask_id_givetogive_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."givetogive_ask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_activity_ask_idx" ON "givetogive_ask_activity" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "ask_activity_actor_idx" ON "givetogive_ask_activity" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "saved_ask_ask_idx" ON "givetogive_saved_ask" USING btree ("ask_id");
