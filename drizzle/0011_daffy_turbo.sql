CREATE TABLE "givetogive_api_token" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"environment" varchar(20) DEFAULT 'staging' NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "givetogive_api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "givetogive_email_sink" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"url_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_environment_identity" (
	"id" integer PRIMARY KEY NOT NULL,
	"environment" varchar(20) NOT NULL,
	"database_name" varchar(128) NOT NULL,
	"identity" varchar(128) NOT NULL,
	CONSTRAINT "givetogive_environment_identity_identity_unique" UNIQUE("identity")
);
--> statement-breakpoint
CREATE TABLE "givetogive_operation_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"external_id" varchar(255),
	"environment" varchar(20) NOT NULL,
	"actor_id" varchar(255),
	"entity_type" varchar(60) NOT NULL,
	"entity_id" varchar(255),
	"action" varchar(100) NOT NULL,
	"outcome" varchar(40) NOT NULL,
	"correlation_id" varchar(255),
	"run_id" varchar(64),
	"summary" varchar(500),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_simulation_agent" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(160) NOT NULL,
	"tier" varchar(20) DEFAULT 'neighbor' NOT NULL,
	"state" varchar(40) DEFAULT 'idle' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"cycles" integer DEFAULT 0 NOT NULL,
	"persona" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_action" varchar(500),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_simulation_command" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"type" varchar(40) NOT NULL,
	"agent_id" varchar(64),
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_simulation_run" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'created' NOT NULL,
	"mode" varchar(30) DEFAULT 'autonomous' NOT NULL,
	"environment" varchar(20) DEFAULT 'staging' NOT NULL,
	"database_identity" varchar(128) NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"agent_count" integer DEFAULT 100 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_tool_operation" (
	"actor_id" varchar(255) NOT NULL,
	"correlation_id" varchar(64) NOT NULL,
	"tool" varchar(80) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_tool_operation_actor_id_correlation_id_pk" PRIMARY KEY("actor_id","correlation_id")
);
--> statement-breakpoint
CREATE TABLE "givetogive_user_security" (
	"user_id" varchar(255) PRIMARY KEY NOT NULL,
	"totp_ciphertext" text,
	"totp_pending_ciphertext" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_community_fund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_community_fund_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "givetogive_fund_allocation_source" (
	"allocation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reversed_amount" integer DEFAULT 0 NOT NULL,
	"transfer_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_fund_allocation_source_allocation_id_payment_id_pk" PRIMARY KEY("allocation_id","payment_id"),
	CONSTRAINT "givetogive_fund_allocation_source_transfer_id_unique" UNIQUE("transfer_id"),
	CONSTRAINT "fund_allocation_source_amount_positive" CHECK ("givetogive_fund_allocation_source"."amount" > 0 AND "givetogive_fund_allocation_source"."reversed_amount" BETWEEN 0 AND "givetogive_fund_allocation_source"."amount")
);
--> statement-breakpoint
CREATE TABLE "givetogive_fund_allocation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fund_id" uuid NOT NULL,
	"ask_id" integer NOT NULL,
	"approved_by_id" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"reversed_amount" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"livemode" boolean NOT NULL,
	"status" varchar(30) DEFAULT 'reserved' NOT NULL,
	"destination_account_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_allocation_amount_positive" CHECK ("givetogive_fund_allocation"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_account" (
	"user_id" varchar(255) NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"livemode" boolean NOT NULL,
	"recipient_requested" boolean DEFAULT false NOT NULL,
	"transfers_active" boolean DEFAULT false NOT NULL,
	"payouts_active" boolean DEFAULT false NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_payment_account_user_id_livemode_pk" PRIMARY KEY("user_id","livemode")
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_ask_settings" (
	"ask_id" integer PRIMARY KEY NOT NULL,
	"goal_amount" integer NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ask_goal_positive" CHECK ("givetogive_payment_ask_settings"."goal_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(255) NOT NULL,
	"payment_id" uuid,
	"account_id" varchar(255),
	"category" varchar(60) NOT NULL,
	"summary" varchar(500) NOT NULL,
	"stripe_object_id" varchar(255),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_payment_case_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_key" varchar(255) NOT NULL,
	"payment_id" uuid,
	"fund_id" uuid,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"livemode" boolean NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_payment_ledger_operation_key_unique" UNIQUE("operation_key")
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(40) NOT NULL,
	"payment_id" uuid,
	"actor_id" varchar(255),
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"stripe_object_id" varchar(255),
	"last_error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_subscription" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"livemode" boolean NOT NULL,
	"kind" varchar(20) NOT NULL,
	"fund_id" uuid,
	"tier" varchar(20),
	"price_id" varchar(255),
	"status" varchar(40) NOT NULL,
	"paid_through" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"fee_snapshot" jsonb NOT NULL,
	"initial_payment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment_webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" varchar(255) NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"livemode" boolean NOT NULL,
	"type" varchar(160) NOT NULL,
	"object_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "givetogive_payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"ask_id" integer,
	"fund_id" uuid,
	"tier" varchar(20),
	"recurring" boolean DEFAULT false NOT NULL,
	"livemode" boolean NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"gross_amount" integer NOT NULL,
	"platform_fee" integer NOT NULL,
	"processing_estimate" integer NOT NULL,
	"recipient_amount" integer NOT NULL,
	"fee_snapshot" jsonb NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"refunded_recipient_amount" integer DEFAULT 0 NOT NULL,
	"actual_processing_fee" integer,
	"allocated_amount" integer DEFAULT 0 NOT NULL,
	"disputed_amount" integer DEFAULT 0 NOT NULL,
	"status" varchar(30) DEFAULT 'reserved' NOT NULL,
	"checkout_id" varchar(255),
	"checkout_url" text,
	"payment_intent_id" varchar(255),
	"charge_id" varchar(255),
	"invoice_id" varchar(255),
	"subscription_id" varchar(255),
	"destination_account_id" varchar(255),
	"transfer_id" varchar(255),
	"receipt_url" text,
	"available_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"last_error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_payment_checkout_id_unique" UNIQUE("checkout_id"),
	CONSTRAINT "givetogive_payment_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "givetogive_payment_charge_id_unique" UNIQUE("charge_id"),
	CONSTRAINT "givetogive_payment_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "payment_amounts_valid" CHECK ("givetogive_payment"."gross_amount" > 0 AND "givetogive_payment"."platform_fee" >= 0 AND "givetogive_payment"."processing_estimate" >= 0 AND "givetogive_payment"."recipient_amount" >= 0 AND "givetogive_payment"."gross_amount" = "givetogive_payment"."platform_fee" + "givetogive_payment"."processing_estimate" + "givetogive_payment"."recipient_amount"),
	CONSTRAINT "payment_refund_valid" CHECK ("givetogive_payment"."refunded_amount" BETWEEN 0 AND "givetogive_payment"."gross_amount" AND "givetogive_payment"."refunded_recipient_amount" BETWEEN 0 AND "givetogive_payment"."recipient_amount"),
	CONSTRAINT "payment_kind_valid" CHECK ("givetogive_payment"."kind" IN ('ask','fund','supporter')),
	CONSTRAINT "payment_status_valid" CHECK ("givetogive_payment"."status" IN ('reserved','checkout_open','pending','succeeded','failed','expired','partially_refunded','refunded','disputed'))
);
--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "role" varchar(16) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_user" ADD COLUMN "is_synthetic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_api_token" ADD CONSTRAINT "givetogive_api_token_user_id_givetogive_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."givetogive_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_api_token" ADD CONSTRAINT "givetogive_api_token_run_id_givetogive_simulation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."givetogive_simulation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_simulation_agent" ADD CONSTRAINT "givetogive_simulation_agent_run_id_givetogive_simulation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."givetogive_simulation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_simulation_agent" ADD CONSTRAINT "givetogive_simulation_agent_user_id_givetogive_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_simulation_command" ADD CONSTRAINT "givetogive_simulation_command_run_id_givetogive_simulation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."givetogive_simulation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_simulation_command" ADD CONSTRAINT "givetogive_simulation_command_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_simulation_run" ADD CONSTRAINT "givetogive_simulation_run_created_by_givetogive_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_tool_operation" ADD CONSTRAINT "givetogive_tool_operation_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_user_security" ADD CONSTRAINT "givetogive_user_security_user_id_givetogive_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."givetogive_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_community_fund" ADD CONSTRAINT "givetogive_community_fund_created_by_id_givetogive_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_fund_allocation_source" ADD CONSTRAINT "givetogive_fund_allocation_source_allocation_id_givetogive_fund_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."givetogive_fund_allocation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_fund_allocation_source" ADD CONSTRAINT "givetogive_fund_allocation_source_payment_id_givetogive_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."givetogive_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_fund_allocation" ADD CONSTRAINT "givetogive_fund_allocation_fund_id_givetogive_community_fund_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."givetogive_community_fund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_fund_allocation" ADD CONSTRAINT "givetogive_fund_allocation_ask_id_givetogive_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."givetogive_ask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_fund_allocation" ADD CONSTRAINT "givetogive_fund_allocation_approved_by_id_givetogive_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_account" ADD CONSTRAINT "givetogive_payment_account_user_id_givetogive_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_ask_settings" ADD CONSTRAINT "givetogive_payment_ask_settings_ask_id_givetogive_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."givetogive_ask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_case" ADD CONSTRAINT "givetogive_payment_case_payment_id_givetogive_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."givetogive_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_ledger" ADD CONSTRAINT "givetogive_payment_ledger_payment_id_givetogive_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."givetogive_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_ledger" ADD CONSTRAINT "givetogive_payment_ledger_fund_id_givetogive_community_fund_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."givetogive_community_fund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_operation" ADD CONSTRAINT "givetogive_payment_operation_payment_id_givetogive_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."givetogive_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_operation" ADD CONSTRAINT "givetogive_payment_operation_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD CONSTRAINT "givetogive_payment_subscription_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD CONSTRAINT "givetogive_payment_subscription_fund_id_givetogive_community_fund_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."givetogive_community_fund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD CONSTRAINT "givetogive_payment_subscription_initial_payment_id_givetogive_payment_id_fk" FOREIGN KEY ("initial_payment_id") REFERENCES "public"."givetogive_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment" ADD CONSTRAINT "givetogive_payment_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment" ADD CONSTRAINT "givetogive_payment_ask_id_givetogive_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."givetogive_ask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_payment" ADD CONSTRAINT "givetogive_payment_fund_id_givetogive_community_fund_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."givetogive_community_fund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_event_external_unique" ON "givetogive_operation_event" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "operation_event_run_id_idx" ON "givetogive_operation_event" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "operation_event_entity_idx" ON "givetogive_operation_event" USING btree ("entity_type","entity_id","id");--> statement-breakpoint
CREATE INDEX "operation_event_actor_idx" ON "givetogive_operation_event" USING btree ("actor_id","id");--> statement-breakpoint
CREATE INDEX "operation_event_environment_created_idx" ON "givetogive_operation_event" USING btree ("environment","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_agent_run_user_unique" ON "givetogive_simulation_agent" USING btree ("run_id","user_id");--> statement-breakpoint
CREATE INDEX "simulation_command_cursor_idx" ON "givetogive_simulation_command" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "fund_allocation_fund_idx" ON "givetogive_fund_allocation" USING btree ("fund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_account_stripe_unique" ON "givetogive_payment_account" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "payment_ledger_payment_idx" ON "givetogive_payment_ledger" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_ledger_fund_idx" ON "givetogive_payment_ledger" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "payment_subscription_actor_idx" ON "givetogive_payment_subscription" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_supporter_subscription" ON "givetogive_payment_subscription" USING btree ("actor_id","livemode") WHERE "givetogive_payment_subscription"."kind" = 'supporter' AND "givetogive_payment_subscription"."status" NOT IN ('canceled','incomplete_expired');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_unique" ON "givetogive_payment_webhook_inbox" USING btree ("stripe_account_id","livemode","stripe_event_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_pending_idx" ON "givetogive_payment_webhook_inbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_actor_idx" ON "givetogive_payment" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_ask_idx" ON "givetogive_payment" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "payment_fund_idx" ON "givetogive_payment" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "payment_recovery_idx" ON "givetogive_payment" USING btree ("status","updated_at");