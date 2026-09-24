CREATE TABLE "givetogive_ask_contribution" (
	"id" serial PRIMARY KEY NOT NULL,
	"ask_id" integer NOT NULL,
	"contributor_id" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	"status" varchar(20) DEFAULT 'pledged' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "givetogive_auth_rate_limit" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_auth_token" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"purpose" varchar(30) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "givetogive_auth_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "givetogive_user" ALTER COLUMN "email_verified" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD COLUMN "type" varchar(20) DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD COLUMN "goal_amount" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "givetogive_ask_contribution" ADD CONSTRAINT "givetogive_ask_contribution_ask_id_givetogive_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."givetogive_ask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_ask_contribution" ADD CONSTRAINT "givetogive_ask_contribution_contributor_id_givetogive_user_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_auth_token" ADD CONSTRAINT "givetogive_auth_token_user_id_givetogive_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."givetogive_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_contribution_ask_idx" ON "givetogive_ask_contribution" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "ask_contribution_contributor_idx" ON "givetogive_ask_contribution" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "ask_contribution_status_idx" ON "givetogive_ask_contribution" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auth_token_user_purpose_idx" ON "givetogive_auth_token" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "ask_status_idx" ON "givetogive_ask" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ask_type_idx" ON "givetogive_ask" USING btree ("type");