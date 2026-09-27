CREATE TABLE "givetogive_supporter_application_evidence" (
	"stripe_event_id" varchar(255) NOT NULL,
	"livemode" boolean NOT NULL,
	"platform_account_id" varchar(255) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"subscription_id" varchar(255) NOT NULL,
	"invoice_id" varchar(255) NOT NULL,
	"item_id" varchar(255) NOT NULL,
	"price_id" varchar(255) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"provider_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "givetogive_supporter_application_evidence_stripe_event_id_livemode_pk" PRIMARY KEY("stripe_event_id","livemode"),
	CONSTRAINT "supporter_application_period_valid" CHECK ("givetogive_supporter_application_evidence"."period_start" < "givetogive_supporter_application_evidence"."period_end")
);
--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "provider_read_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "givetogive_payment_subscription" ADD COLUMN "provider_read_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_change" ADD COLUMN "source_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_paid_coverage" ADD COLUMN "item_id" varchar(255);--> statement-breakpoint
ALTER TABLE "givetogive_supporter_application_evidence" ADD CONSTRAINT "givetogive_supporter_application_evidence_actor_id_givetogive_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."givetogive_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "givetogive_supporter_application_evidence" ADD CONSTRAINT "givetogive_supporter_application_evidence_subscription_id_givetogive_payment_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."givetogive_payment_subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supporter_application_invoice_idx" ON "givetogive_supporter_application_evidence" USING btree ("subscription_id","invoice_id","livemode");
--> statement-breakpoint
-- Authentic application evidence is append-only, including for application owners.
CREATE TRIGGER givetogive_supporter_application_immutable
BEFORE UPDATE OR DELETE ON givetogive_supporter_application_evidence
FOR EACH ROW EXECUTE FUNCTION givetogive_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER givetogive_supporter_application_no_truncate
BEFORE TRUNCATE ON givetogive_supporter_application_evidence
FOR EACH STATEMENT EXECUTE FUNCTION givetogive_reject_history_mutation();
--> statement-breakpoint
-- Legacy rows have no item ID until a verified replay of the same invoice supplies it.
-- All other provenance is immutable. Application can only move NULL -> timestamp once.
CREATE FUNCTION givetogive_guard_supporter_coverage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_id IS NOT NULL AND length(trim(NEW.item_id)) = 0 THEN
    RAISE EXCEPTION 'Supporter coverage requires a nonempty item ID' USING ERRCODE = '23514';
  END IF;
  IF NEW.applied_at IS NOT NULL AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'Supporter application requires item provenance' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'applied_at' - 'item_id') IS DISTINCT FROM (to_jsonb(OLD) - 'applied_at' - 'item_id')
    OR (OLD.applied_at IS NOT NULL AND NEW.applied_at IS DISTINCT FROM OLD.applied_at)
    OR (OLD.item_id IS NOT NULL AND NEW.item_id IS DISTINCT FROM OLD.item_id)
    OR NOT ((OLD.applied_at IS NULL AND NEW.applied_at IS NOT NULL)
      OR (OLD.item_id IS NULL AND NEW.item_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Supporter coverage provenance is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER givetogive_supporter_coverage_provenance
BEFORE INSERT OR UPDATE ON givetogive_supporter_paid_coverage
FOR EACH ROW EXECUTE FUNCTION givetogive_guard_supporter_coverage();
--> statement-breakpoint
CREATE TRIGGER givetogive_supporter_coverage_no_delete
BEFORE DELETE ON givetogive_supporter_paid_coverage
FOR EACH ROW EXECUTE FUNCTION givetogive_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER givetogive_supporter_coverage_no_truncate
BEFORE TRUNCATE ON givetogive_supporter_paid_coverage
FOR EACH STATEMENT EXECUTE FUNCTION givetogive_reject_history_mutation();
