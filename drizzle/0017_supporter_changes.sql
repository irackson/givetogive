CREATE TABLE "givetogive_supporter_change" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"subscription_id" varchar(255) NOT NULL,
	"livemode" boolean NOT NULL,
	"action" varchar(24) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"expected_revision" integer NOT NULL,
	"source_price_id" varchar(255) NOT NULL,
	"target_price_id" varchar(255),
	"item_id" varchar(255) NOT NULL,
	"provider_fingerprint" varchar(64) NOT NULL,
	"proration_date" integer,
	"quote_amount" integer,
	"quote_expires_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"invoice_id" varchar(255),
	"payment_intent_id" varchar(255),
	"schedule_id" varchar(255),
	"status" varchar(32) DEFAULT 'quoted' NOT NULL,
	"step" varchar(64) DEFAULT 'quote' NOT NULL,
	"provider_started_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"target_operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supporter_change_action_valid" CHECK ("givetogive_supporter_change"."action" IN ('upgrade','downgrade','undo','cancel','resume')),
	CONSTRAINT "supporter_change_status_valid" CHECK ("givetogive_supporter_change"."status" IN ('quoted','reserved','processing','pending_payment','scheduled','applied','expired','failed','recovery_required')),
	CONSTRAINT "supporter_change_revision_valid" CHECK ("givetogive_supporter_change"."expected_revision" >= 0 AND "givetogive_supporter_change"."attempts" >= 0),
	CONSTRAINT "supporter_change_quote_valid" CHECK ("givetogive_supporter_change"."quote_amount" IS NULL OR "givetogive_supporter_change"."quote_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "givetogive_supporter_paid_coverage" (
	"invoice_line_id" varchar(255) NOT NULL,
	"livemode" boolean NOT NULL,
	"invoice_id" varchar(255) NOT NULL,
	"payment_id" uuid NOT NULL,
	"subscription_id" varchar(255) NOT NULL,
	"price_id" varchar(255) NOT NULL,
	"tier" varchar(20) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"proration" boolean NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_supporter_paid_coverage_invoice_line_id_livemode_pk" PRIMARY KEY("invoice_line_id","livemode"),
	CONSTRAINT "supporter_coverage_period_valid" CHECK ("givetogive_supporter_paid_coverage"."period_start" < "givetogive_supporter_paid_coverage"."period_end"),
	CONSTRAINT "supporter_coverage_tier_valid" CHECK ("givetogive_supporter_paid_coverage"."tier" IN ('supporter','sustainer'))
);
--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "item_id" varchar(255);--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "schedule_id" varchar(255);--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "latest_invoice_id" varchar(255);--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "pending_update_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "provider_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "change_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "active_mutation_id" uuid;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "pending_change_id" uuid;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_change" ADD CONSTRAINT "givetogive_supporter_change_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_change" ADD CONSTRAINT "givetogive_supporter_change_subscription_id_givetogive_payment_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."givetogive_payment_subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_paid_coverage" ADD CONSTRAINT "givetogive_supporter_paid_coverage_payment_id_givetogive_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."givetogive_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_paid_coverage" ADD CONSTRAINT "givetogive_supporter_paid_coverage_subscription_id_givetogive_payment_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."givetogive_payment_subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supporter_change_actor_idx" ON "givetogive_supporter_change" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "supporter_change_recovery_idx" ON "givetogive_supporter_change" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "supporter_coverage_subscription_idx" ON "givetogive_supporter_paid_coverage" USING btree ("subscription_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "supporter_coverage_payment_idx" ON "givetogive_supporter_paid_coverage" USING btree ("payment_id");