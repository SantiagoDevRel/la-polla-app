-- New metadata only; no existing profile, prize email, or prediction is rewritten.
ALTER TABLE public.users ADD COLUMN profile_revision bigint NOT NULL DEFAULT 0 CHECK (profile_revision>=0);
CREATE FUNCTION public.user_profile_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (NEW.display_name,NEW.avatar_url,NEW.default_payout_method,NEW.default_payout_account,
      NEW.default_payout_account_name,NEW.default_payout_account_type)
    IS DISTINCT FROM (OLD.display_name,OLD.avatar_url,OLD.default_payout_method,OLD.default_payout_account,
      OLD.default_payout_account_name,OLD.default_payout_account_type) THEN
    NEW.profile_revision:=OLD.profile_revision+1;
  ELSE NEW.profile_revision:=OLD.profile_revision; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_profile_revision BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.user_profile_revision_guard();
REVOKE ALL ON FUNCTION public.user_profile_revision_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.user_profile_revision_guard() TO service_role;

ALTER TABLE public.casa_prize_contacts
  ADD COLUMN save_revision bigint NOT NULL DEFAULT 0 CHECK(save_revision>=0),
  ADD COLUMN last_request_id uuid,
  ADD COLUMN last_expected_revision bigint;
CREATE FUNCTION public.casa_prize_contact_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- Every actual RPC write advances the fence, including an unchanged email.
  NEW.save_revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.save_revision+1 END;
  NEW.last_request_id:=nullif(current_setting('app.casa_prize_request',true),'')::uuid;
  NEW.last_expected_revision:=nullif(current_setting('app.casa_prize_expected_revision',true),'')::bigint;
  RETURN NEW;
END $$;
CREATE TRIGGER casa_prize_contact_revision BEFORE INSERT OR UPDATE ON public.casa_prize_contacts
  FOR EACH ROW EXECUTE FUNCTION public.casa_prize_contact_revision_guard();
REVOKE ALL ON FUNCTION public.casa_prize_contact_revision_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_prize_contact_revision_guard() TO service_role;

-- The original writer retains all campaign/participant/winner/delivery guards.
-- Both legacy and versioned callers serialize before creating a missing contact.
DO $patch$
DECLARE definition text; needle text;
BEGIN
  SELECT pg_get_functiondef('public.casa_save_prize_contact(uuid,uuid,text)'::regprocedure) INTO definition;
  needle:='  -- The service-only caller must derive p_user_id from the validated session.';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect prize contact writer baseline'; END IF;
  definition:=replace(definition,needle,
    '  PERFORM pg_advisory_xact_lock(hashtextextended(''casa-prize-contact:''||p_polla_id::text||'':''||p_user_id::text,0));'||chr(10)||needle);
  EXECUTE definition;
END $patch$;

CREATE FUNCTION public.casa_save_prize_contact_v2(p_polla_id uuid,p_user_id uuid,p_email text,
  p_request_id uuid,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='2s' SET statement_timeout='10s' AS $$
DECLARE stored public.casa_prize_contacts; answer jsonb; prior_request text; prior_revision text;
  v_revision bigint:=0; e text:=btrim(p_email); winner boolean; editable boolean;
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PRIZE_REQUEST';
  END IF;
  IF p_polla_id IS DISTINCT FROM '85b88f91-7680-4241-9bf5-b37614cb520b'::uuid THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PRIZE_CONTACT_NOT_AVAILABLE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('casa-prize-contact:'||p_polla_id::text||':'||p_user_id::text,0));
  SELECT * INTO stored FROM public.casa_prize_contacts WHERE polla_id=p_polla_id AND user_id=p_user_id FOR UPDATE;
  IF FOUND THEN
    v_revision:=stored.save_revision;
    IF stored.last_request_id=p_request_id THEN
      IF stored.email IS DISTINCT FROM e OR stored.last_expected_revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PRIZE_REQUEST_REUSED';
      END IF;
      SELECT a.id IS NOT NULL,coalesce(a.delivered_at IS NULL AND (p.status<>'resuelta' OR a.id IS NOT NULL)
        AND p.status IN ('abierta','cerrada','resuelta') AND p.archived_at IS NULL
        AND p.publication_mode<>'oculta' AND p.opens_at<=clock_timestamp(),false)
        INTO winner,editable FROM public.casa_pollas p LEFT JOIN public.casa_payouts a
          ON a.polla_id=p.id AND a.user_id=p_user_id AND a.prize_kind='objeto' WHERE p.id=p_polla_id;
      RETURN jsonb_build_object('email',stored.email,'winner',coalesce(winner,false),
        'editable',coalesce(editable,false),'revision',stored.save_revision,'request_id',p_request_id);
    END IF;
  END IF;
  IF v_revision<>p_expected_revision THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'revision',v_revision);
  END IF;
  prior_request:=current_setting('app.casa_prize_request',true);
  prior_revision:=current_setting('app.casa_prize_expected_revision',true);
  PERFORM set_config('app.casa_prize_request',p_request_id::text,true);
  PERFORM set_config('app.casa_prize_expected_revision',p_expected_revision::text,true);
  answer:=public.casa_save_prize_contact(p_polla_id,p_user_id,e);
  SELECT * INTO stored FROM public.casa_prize_contacts WHERE polla_id=p_polla_id AND user_id=p_user_id;
  PERFORM set_config('app.casa_prize_request',coalesce(prior_request,''),true);
  PERFORM set_config('app.casa_prize_expected_revision',coalesce(prior_revision,''),true);
  RETURN answer||jsonb_build_object('revision',stored.save_revision,'request_id',p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.casa_save_prize_contact_v2(uuid,uuid,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_save_prize_contact_v2(uuid,uuid,text,uuid,bigint) TO service_role;
