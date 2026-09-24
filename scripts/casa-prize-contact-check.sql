-- LOCAL Docker only; synthetic fixtures, all changes rolled back.
-- Apply migration 149 locally first. Run with psql -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
CREATE FUNCTION pg_temp.prize_contact_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    IF position(expected IN msg)=0 THEN RAISE EXCEPTION 'Expected %, got %',expected,msg; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %, but operation succeeded',expected;
END $$;

DO $$
DECLARE p uuid := '85b88f91-7680-4241-9bf5-b37614cb520b';
  participant uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); entry uuid; award uuid;
  result jsonb; existing_name text;
BEGIN
  SELECT name INTO existing_name FROM public.casa_pollas WHERE id=p;
  IF existing_name IS NOT NULL AND existing_name<>'POLLA REGALO PRUEBA QUENTRO' THEN
    RAISE EXCEPTION 'Refusing non-test campaign. Run only against local fixtures.';
  END IF;
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (participant,'+1667'||substr(replace(participant::text,'-',''),1,10),'Local Quentro participant',false),
    (outsider,'+1667'||substr(replace(outsider::text,'-',''),1,10),'Local Quentro outsider',false);
  IF existing_name IS NULL THEN
    INSERT INTO public.casa_pollas(id,slug,name,kind,scoring_mode,tournament,entry_price_cop,prize_kind,
      prize_object,status,opens_at,closes_at,created_by,referral_every)
    VALUES(p,'local-quentro-'||gen_random_uuid(),'POLLA REGALO PRUEBA QUENTRO','partidos','marcador','nations_2026',0,
      'objeto','Local test tickets','abierta',now()-interval '1 day',now()+interval '1 day',participant,NULL);
  END IF;
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,participant,'pagada',0) RETURNING id INTO entry;
  result:=public.casa_save_prize_contact(p,participant,' local+ticket@example.com ');
  ASSERT result->>'email'='local+ticket@example.com' AND result->>'winner'='false';
  PERFORM public.casa_save_prize_contact(p,participant,'corrected@example.com');
  ASSERT (SELECT count(*)=1 AND min(email)='corrected@example.com' FROM public.casa_prize_contacts WHERE polla_id=p AND user_id=participant);
  PERFORM pg_temp.prize_contact_must_fail(format('SELECT public.casa_save_prize_contact(%L,%L,''x@example.com'')',p,outsider),'PRIZE_PARTICIPANT_REQUIRED');
  PERFORM pg_temp.prize_contact_must_fail(format('SELECT public.casa_save_prize_contact(%L,%L,''x@example.com'')',gen_random_uuid(),participant),'PRIZE_CONTACT_NOT_AVAILABLE');
  PERFORM pg_temp.prize_contact_must_fail(format('SELECT public.casa_save_prize_contact(%L,%L,''not-an-email'')',p,participant),'INVALID_PRIZE_EMAIL');
  RAISE NOTICE 'PASS saved, corrected idempotently, rejected outsider/unrelated campaign/invalid email';

  ASSERT NOT has_table_privilege('anon','public.casa_prize_contacts','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.casa_prize_contacts','INSERT');
  ASSERT NOT has_table_privilege('service_role','public.casa_prize_contacts','UPDATE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_save_prize_contact(uuid,uuid,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_save_prize_contact(uuid,uuid,text)','EXECUTE');
  PERFORM set_config('request.jwt.claim.sub',participant::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*)=1 FROM public.casa_prize_contacts WHERE polla_id='85b88f91-7680-4241-9bf5-b37614cb520b');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_prize_contacts WHERE polla_id='85b88f91-7680-4241-9bf5-b37614cb520b');
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS own-only RLS; no anonymous, direct service-write, or authenticated RPC access';

  UPDATE public.casa_pollas SET publication_mode='oculta' WHERE id=p;
  PERFORM pg_temp.prize_contact_must_fail(format('SELECT public.casa_save_prize_contact(%L,%L,''x@example.com'')',p,participant),'PRIZE_CONTACT_NOT_AVAILABLE');
  UPDATE public.casa_pollas SET publication_mode='ahora' WHERE id=p;
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,outsider,'pagada',0);
  INSERT INTO public.casa_payouts(polla_id,user_id,place,amount_cop,prize_kind,prize_object)
    VALUES(p,participant,1,0,'objeto','Local test tickets') RETURNING id INTO award;
  UPDATE public.casa_pollas SET status='resuelta' WHERE id=p;
  PERFORM pg_temp.prize_contact_must_fail(format('SELECT public.casa_save_prize_contact(%L,%L,''loser@example.com'')',p,outsider),'PRIZE_WINNER_REQUIRED');
  result:=public.casa_save_prize_contact(p,participant,'winner@example.com');
  ASSERT result->>'winner'='true';
  UPDATE public.casa_payouts SET delivered_at=clock_timestamp() WHERE id=award;
  PERFORM pg_temp.prize_contact_must_fail(format('SELECT public.casa_save_prize_contact(%L,%L,''late@example.com'')',p,participant),'PRIZE_ALREADY_DELIVERED');
  ASSERT (SELECT email='winner@example.com' FROM public.casa_prize_contacts WHERE polla_id=p AND user_id=participant);
  RAISE NOTICE 'PASS hidden campaign guard; settled loser denied; winner can complete email; delivery locks destination';
END $$;
ROLLBACK;
