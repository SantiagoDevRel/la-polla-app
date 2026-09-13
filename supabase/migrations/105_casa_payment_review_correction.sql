-- Review corrections only; no existing payments, picks or awards are changed.
ALTER TABLE public.casa_entry_proof_attempts
  ADD COLUMN review_revision integer NOT NULL DEFAULT 0 CHECK(review_revision >= 0);

-- Each correction retains the complete approval it supersedes. The proof stays
-- in its original private path; no history or file is deleted/replaced.
CREATE TABLE public.casa_payment_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.casa_entry_proof_attempts(id),
  entry_id uuid NOT NULL REFERENCES public.casa_entries(id),
  revision integer NOT NULL CHECK(revision > 0),
  previous_reviewed_at timestamptz NOT NULL,
  previous_entry_reviewed_at timestamptz,
  previous_reviewed_by uuid REFERENCES public.users(id),
  previous_reviewed_chat_id bigint REFERENCES public.telegram_admins(chat_id),
  previous_review_reason text,
  corrected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  corrected_by uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),
  UNIQUE(attempt_id,revision)
);
ALTER TABLE public.casa_payment_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY casa_payment_corrections_deny ON public.casa_payment_corrections
  FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
GRANT SELECT,INSERT ON public.casa_payment_corrections TO service_role;
REVOKE ALL ON public.casa_payment_corrections FROM PUBLIC,anon,authenticated;
REVOKE UPDATE,DELETE ON public.casa_payment_corrections FROM service_role;

-- Preserve all other guards verbatim. A paid entry can only return to pending
-- through the exact audit record created inside the correction transaction.
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.casa_v2_write_guard()'::regprocedure) INTO definition;
  definition:=replace(definition,chr(13),'');
  needle := $needle$IF OLD.status='pagada' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_PAID';
      END IF;$needle$;
  replacement := $replacement$IF OLD.status='pagada' AND NEW IS DISTINCT FROM OLD THEN
        -- Legacy paid receipts can bind their existing proof once, preserving
        -- every original field and the original approval metadata.
        IF OLD.current_proof_attempt_id IS NULL AND NEW.current_proof_attempt_id IS NOT NULL
          AND (to_jsonb(NEW)-'current_proof_attempt_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'current_proof_attempt_id')
          AND EXISTS(SELECT 1 FROM public.casa_entry_proof_attempts a WHERE a.id=NEW.current_proof_attempt_id
            AND a.entry_id=OLD.id AND a.user_id=OLD.user_id AND a.state='confirmed'
            AND a.proof_path=OLD.proof_path AND a.decision='pagada'
            AND a.reviewed_at=coalesce(OLD.reviewed_at,OLD.created_at)) THEN RETURN NEW; END IF;
        IF NEW.status<>'pendiente' OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_by IS NOT NULL
          OR NEW.reject_reason IS NOT NULL
          OR (to_jsonb(NEW)-ARRAY['status','reviewed_at','reviewed_by','reject_reason']) IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['status','reviewed_at','reviewed_by','reject_reason'])
          OR NOT EXISTS(SELECT 1 FROM public.casa_payment_corrections c
            WHERE c.id::text=current_setting('app.casa_payment_correction',true)
              AND c.entry_id=OLD.id AND c.attempt_id=OLD.current_proof_attempt_id
              AND c.previous_entry_reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at)
        THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_PAID'; END IF;
      END IF;$replacement$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Paid-entry guard differs; inspect before applying 105'; END IF;
  EXECUTE replace(definition,needle,replacement);

  SELECT pg_get_functiondef('public.casa_review_attempt_v2(uuid,text,text,integer,uuid,bigint)'::regprocedure) INTO definition;
  definition:=replace(definition,chr(13),'');
  needle := 'SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id FOR UPDATE;';
  replacement := needle || $replacement$
  IF a.review_revision>0 AND current_setting('app.casa_review_revision',true) IS DISTINCT FROM
    (a.id::text||':'||a.review_revision::text) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPDATE_REQUIRED';
  END IF;$replacement$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Review lock differs; inspect before applying 105'; END IF;
  EXECUTE replace(definition,needle,replacement);
END $$;

CREATE FUNCTION public.casa_review_attempt_v3(
  p_attempt_id uuid,p_revision integer,p_decision text,p_reason text,p_contract integer,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.casa_entry_proof_attempts; e public.casa_entries; result jsonb;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id;
  PERFORM public.casa_v2_lock_polla(e.polla_id);
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF a.review_revision IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_REVIEWED';
  END IF;
  PERFORM set_config('app.casa_review_revision',a.id::text||':'||a.review_revision::text,true);
  result:=public.casa_review_attempt_v2(p_attempt_id,p_decision,p_reason,p_contract,p_actor_id,NULL);
  PERFORM set_config('app.casa_review_revision','',true);
  RETURN result;
END $$;

CREATE FUNCTION public.casa_unpay_attempt_v2(
  p_attempt_id uuid,p_revision integer,p_reason text,p_contract integer,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.casa_entry_proof_attempts; e public.casa_entries; p public.casa_pollas; correction_id uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REVIEW';
  END IF;
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id;
  p:=public.casa_v2_lock_polla(e.polla_id);
  IF p.status NOT IN ('abierta','cerrada') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_FINAL'; END IF;
  IF p.settled_at IS NOT NULL OR p.settlement_outcome IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED';
  END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id FOR UPDATE;
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF e.current_proof_attempt_id IS DISTINCT FROM a.id OR a.state<>'confirmed'
    OR e.proof_path IS DISTINCT FROM a.proof_path THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED';
  END IF;
  -- Retrying a correction is safe, but must never undo a later approval.
  IF e.status='pendiente' AND a.decision IS NULL AND a.review_revision=p_revision+1 THEN
    RETURN jsonb_build_object('changed',false,'entry_id',e.id,'polla_id',e.polla_id,'status','pendiente');
  END IF;
  IF a.review_revision IS DISTINCT FROM p_revision OR e.status<>'pagada' OR a.decision IS DISTINCT FROM 'pagada' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_REVIEWED';
  END IF;
  INSERT INTO public.casa_payment_corrections(attempt_id,entry_id,revision,previous_reviewed_at,previous_entry_reviewed_at,
    previous_reviewed_by,previous_reviewed_chat_id,previous_review_reason,corrected_by,reason)
    VALUES(a.id,e.id,a.review_revision+1,a.reviewed_at,e.reviewed_at,a.reviewed_by,a.reviewed_chat_id,a.review_reason,p_actor_id,btrim(p_reason))
    RETURNING id INTO correction_id;
  PERFORM set_config('app.casa_payment_correction',correction_id::text,true);
  UPDATE public.casa_entries SET status='pendiente',reviewed_at=NULL,reviewed_by=NULL,reject_reason=NULL WHERE id=e.id;
  UPDATE public.casa_entry_proof_attempts SET decision=NULL,reviewed_at=NULL,reviewed_by=NULL,
    reviewed_chat_id=NULL,review_reason=NULL,review_revision=review_revision+1 WHERE id=a.id;
  PERFORM set_config('app.casa_payment_correction','',true);
  RETURN jsonb_build_object('changed',true,'entry_id',e.id,'polla_id',e.polla_id,'status','pendiente');
END $$;

REVOKE ALL ON FUNCTION public.casa_review_attempt_v3(uuid,integer,text,text,integer,uuid),
  public.casa_unpay_attempt_v2(uuid,integer,text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_review_attempt_v3(uuid,integer,text,text,integer,uuid),
  public.casa_unpay_attempt_v2(uuid,integer,text,integer,uuid) TO service_role;

CREATE INDEX casa_entries_payment_review_order_idx ON public.casa_entries(status,proof_uploaded_at DESC NULLS LAST,id DESC)
  WHERE proof_path IS NOT NULL;
