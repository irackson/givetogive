-- REVIEWED SOURCE PROPOSAL ONLY. Never executed by the application/build.
-- Admit current-history/restore authority and capacity before any initialization.
-- No IF NOT EXISTS, reset, expiry, deletion, takeover, backfill or automatic grant.
CREATE TABLE public.give_mail_receipt_ledger_v1 (
  id text PRIMARY KEY CHECK (id = 'capacity:v1'),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
);

CREATE FUNCTION public.give_mail_fields_v1(v jsonb, allowed text[], required text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
  SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN false
    ELSE COALESCE(v - allowed = '{}'::jsonb AND v ?& required, false) END
$$;

CREATE FUNCTION public.give_mail_request_v1(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
  SELECT COALESCE(public.give_mail_fields_v1(v,
    ARRAY['key','binding','app','providerScope','recipientBinding','templateVersion','messageExpiresAt'],
    ARRAY['key','binding','app','providerScope'])
    AND v->>'key' ~ '^mail:[a-f0-9]{32}$'
    AND v->>'binding' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(v->'binding')='string'
    AND v->>'app' = 'givetogive' AND v->>'providerScope' = 'mailgun:us:ianrackson.com'
    AND (NOT v ? 'recipientBinding' OR (jsonb_typeof(v->'recipientBinding')='string' AND v->>'recipientBinding' ~ '^[a-f0-9]{64}$'))
    AND (NOT v ? 'templateVersion' OR (jsonb_typeof(v->'templateVersion')='string' AND length(v->>'templateVersion') BETWEEN 1 AND 80))
    AND (NOT v ? 'messageExpiresAt' OR (jsonb_typeof(v->'messageExpiresAt')='number' AND v->>'messageExpiresAt' ~ '^[1-9][0-9]{0,13}$')),false)
$$;

CREATE FUNCTION public.give_mail_outcome_v1(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
  SELECT COALESCE(CASE v->>'state'
    WHEN 'accepted' THEN public.give_mail_fields_v1(v,ARRAY['state','providerMessageId'],ARRAY['state','providerMessageId'])
      AND jsonb_typeof(v->'providerMessageId')='string' AND v->>'providerMessageId' ~ '^[!-~]{1,512}$'
    WHEN 'unknown' THEN public.give_mail_fields_v1(v,ARRAY['state','reason'],ARRAY['state','reason'])
      AND v->>'reason'=ANY(ARRAY['deadline','network_or_body','unrecognized_response','malformed_acceptance','receipt_unavailable','in_progress_or_uncertain','provider_id_conflict','intent_conflict'])
    WHEN 'rejected' THEN public.give_mail_fields_v1(v,ARRAY['state','reason','httpStatus'],ARRAY['state','reason'])
      AND v->>'reason'=ANY(ARRAY['provider_rejection','intent_conflict','invalid_message'])
      AND (NOT v ? 'httpStatus' OR (jsonb_typeof(v->'httpStatus')='number' AND v->>'httpStatus' ~ '^[45][0-9]{2}$'))
    ELSE false END,false)
$$;

-- The locked persistent singleton is the transaction serialization point.
-- The application installs server statement/lock deadlines before calling.
-- Any raised error rolls the complete statement/transaction back; no HTTP occurs
-- without an acknowledged new claim. Lost/late acknowledgement never allows resend.
CREATE FUNCTION public.give_mail_receipt_command_v1(operation text, payload jsonb, capacity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  s jsonb; r jsonb; req jsonb; terminal jsonb; expected jsonb := '{}'::jsonb;
  k text; pid text; claim text; used integer; records integer := 0; collision boolean := false;
BEGIN
  IF capacity IS NULL OR operation IS NULL OR capacity NOT BETWEEN 1 AND 10000 OR operation NOT IN ('reserve','complete')
    OR payload IS NULL OR octet_length(payload::text)>4096 THEN
    RAISE EXCEPTION 'give_mail_receipt_unavailable';
  END IF;
  SELECT state INTO s FROM public.give_mail_receipt_ledger_v1 WHERE id='capacity:v1' FOR UPDATE;
  IF NOT FOUND OR public.give_mail_fields_v1(s,ARRAY['schema','maxRecords','used','receipts','providers'],ARRAY['schema','maxRecords','used','receipts','providers']) IS DISTINCT FROM true
    OR s->>'schema' IS DISTINCT FROM 'give-mail-receipts-v1'
    OR jsonb_typeof(s->'maxRecords') IS DISTINCT FROM 'number'
    OR s->>'maxRecords' IS DISTINCT FROM capacity::text
    OR jsonb_typeof(s->'used') IS DISTINCT FROM 'number'
    OR (s->>'used' ~ '^(0|[1-9][0-9]{0,4})$') IS DISTINCT FROM true
    OR jsonb_typeof(s->'receipts') IS DISTINCT FROM 'object'
    OR jsonb_typeof(s->'providers') IS DISTINCT FROM 'object'
    OR octet_length(s::text)>50000000 THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
  used := (s->>'used')::integer;
  IF used>capacity THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
  FOR k,r IN SELECT key,value FROM jsonb_each(s->'receipts') LOOP
    records := records+1;
    IF records>capacity OR k !~ '^mail:[a-f0-9]{32}$' OR octet_length(r::text)>4096
      OR public.give_mail_fields_v1(r,ARRAY['request','claim','phase','outcome'],ARRAY['request','claim','phase']) IS DISTINCT FROM true
      OR public.give_mail_request_v1(r->'request') IS DISTINCT FROM true
      OR r->'request'->>'key' IS DISTINCT FROM k
      OR (r->>'claim' ~ '^mail:[a-f0-9]{32}\.[a-f0-9]{32}$') IS DISTINCT FROM true
      OR split_part(r->>'claim','.',1) IS DISTINCT FROM k THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
    IF r->>'phase'='submitting' THEN
      IF r ? 'outcome' THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
    ELSIF r->>'phase'='completed' THEN
      IF public.give_mail_outcome_v1(r->'outcome') IS DISTINCT FROM true THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
      IF r->'outcome'->>'state'='accepted' THEN
        pid:=r->'outcome'->>'providerMessageId';
        IF expected ? pid THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
        expected:=expected || jsonb_build_object(pid,k);
      END IF;
    ELSE RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
  END LOOP;
  IF records<>used OR s->'providers' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;

  IF operation='reserve' THEN
    IF public.give_mail_fields_v1(payload,ARRAY['request','claim'],ARRAY['request','claim']) IS DISTINCT FROM true
      OR public.give_mail_request_v1(payload->'request') IS DISTINCT FROM true THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
    req:=payload->'request'; k:=req->>'key'; claim:=payload->>'claim';
    IF (claim ~ '^mail:[a-f0-9]{32}\.[a-f0-9]{32}$') IS DISTINCT FROM true OR split_part(claim,'.',1) IS DISTINCT FROM k THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
    r:=s->'receipts'->k;
    IF r IS NOT NULL THEN
      IF r->'request' IS DISTINCT FROM req THEN RETURN jsonb_build_object('state','conflict'); END IF;
      IF r->>'phase'='completed' THEN RETURN jsonb_build_object('state','existing','outcome',r->'outcome'); END IF;
      RETURN jsonb_build_object('state','existing');
    END IF;
    IF used>=capacity THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
    r:=jsonb_build_object('request',req,'claim',claim,'phase','submitting');
    s:=jsonb_set(s,ARRAY['receipts',k],r);
    s:=jsonb_set(s,ARRAY['used'],to_jsonb(used+1));
    UPDATE public.give_mail_receipt_ledger_v1 SET state=s WHERE id='capacity:v1';
    RETURN jsonb_build_object('state','new','claim',claim);
  END IF;

  IF public.give_mail_fields_v1(payload,ARRAY['claim','outcome'],ARRAY['claim','outcome']) IS DISTINCT FROM true
    OR public.give_mail_outcome_v1(payload->'outcome') IS DISTINCT FROM true THEN RAISE EXCEPTION 'give_mail_receipt_unavailable'; END IF;
  claim:=payload->>'claim';
  IF (claim ~ '^mail:[a-f0-9]{32}\.[a-f0-9]{32}$') IS DISTINCT FROM true THEN RETURN to_jsonb('stale'::text); END IF;
  k:=split_part(claim,'.',1); r:=s->'receipts'->k; terminal:=payload->'outcome';
  IF r IS NULL OR r->>'claim' IS DISTINCT FROM claim THEN RETURN to_jsonb('stale'::text); END IF;
  IF r->>'phase'='completed' THEN
    IF r->'outcome'=terminal THEN RETURN to_jsonb('saved'::text); END IF;
    RETURN to_jsonb('stale'::text);
  END IF;
  IF terminal->>'state'='accepted' THEN
    pid:=terminal->>'providerMessageId';
    IF s->'providers' ? pid THEN
      terminal:=jsonb_build_object('state','unknown','reason','provider_id_conflict'); collision:=true;
    ELSE s:=jsonb_set(s,ARRAY['providers',pid],to_jsonb(k)); END IF;
  END IF;
  r:=r || jsonb_build_object('phase','completed','outcome',terminal);
  s:=jsonb_set(s,ARRAY['receipts',k],r);
  UPDATE public.give_mail_receipt_ledger_v1 SET state=s WHERE id='capacity:v1';
  RETURN to_jsonb((CASE WHEN collision THEN 'provider_id_conflict' ELSE 'saved' END)::text);
END
$$;

-- No initializer is executed here. A separately admitted first-use initialization
-- would insert exactly one immutable-scope control row with used=0, empty receipts
-- and provider map, ONLY after independent history/recovery checks. Never insert
-- automatically on missing state. No trigger, role/grant or financial table change.
