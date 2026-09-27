-- Journals and audit events are append-only, including for application owners.
CREATE FUNCTION givetogive_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial and operational history is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION givetogive_validate_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line jsonb;
  total numeric := 0;
BEGIN
  IF jsonb_typeof(NEW.lines) <> 'array' OR jsonb_array_length(NEW.lines) < 2 THEN
    RAISE EXCEPTION 'A journal requires at least two lines' USING ERRCODE = '23514';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) LOOP
    IF jsonb_typeof(line->'amount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(line->'account') IS DISTINCT FROM 'string'
      OR length(line->>'account') NOT BETWEEN 1 AND 255
      OR (line->>'amount')::numeric <> trunc((line->>'amount')::numeric)
      OR abs((line->>'amount')::numeric) > 9007199254740991 THEN
      RAISE EXCEPTION 'Journal amounts must be safe integer minor units and accounts must be named' USING ERRCODE = '23514';
    END IF;
    total := total + (line->>'amount')::numeric;
  END LOOP;
  IF total <> 0 THEN
    RAISE EXCEPTION 'Journal is not balanced' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER givetogive_payment_ledger_balance BEFORE INSERT ON givetogive_payment_ledger
FOR EACH ROW EXECUTE FUNCTION givetogive_validate_journal();
--> statement-breakpoint
CREATE TRIGGER givetogive_payment_ledger_immutable BEFORE UPDATE OR DELETE ON givetogive_payment_ledger
FOR EACH ROW EXECUTE FUNCTION givetogive_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER givetogive_payment_ledger_no_truncate BEFORE TRUNCATE ON givetogive_payment_ledger
FOR EACH STATEMENT EXECUTE FUNCTION givetogive_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER givetogive_operation_event_immutable BEFORE UPDATE OR DELETE ON givetogive_operation_event
FOR EACH ROW EXECUTE FUNCTION givetogive_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER givetogive_operation_event_no_truncate BEFORE TRUNCATE ON givetogive_operation_event
FOR EACH STATEMENT EXECUTE FUNCTION givetogive_reject_history_mutation();
