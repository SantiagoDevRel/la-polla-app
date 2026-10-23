-- Owned, isolated CI database only. All synthetic rows and trigger roll back.
BEGIN;
SELECT public.casa_v2_context(2);
CREATE FUNCTION pg_temp.random_default_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.polla_id::text=current_setting('test.random_defaults_fail',true) THEN
    RAISE EXCEPTION 'Forced random default save failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER random_default_failure BEFORE INSERT OR UPDATE ON public.casa_picks
  FOR EACH ROW EXECUTE FUNCTION pg_temp.random_default_failure();
CREATE FUNCTION pg_temp.random_expect_failure(q text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    ASSERT position(expected IN msg)>0,format('Expected %s, got %s',expected,msg); RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %',expected;
END $$;
DO $$
DECLARE actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  outcomes uuid:=gen_random_uuid(); failed uuid:=gen_random_uuid(); player uuid; e uuid; original uuid;
  m uuid; mids uuid[]:='{}'; i integer; mode text; result jsonb; snapshot jsonb; state jsonb;
BEGIN
  INSERT INTO public.users(id,display_name,is_admin) VALUES(actor,'Random default admin',true),(outsider,'Unmanaged random fixture',false);
  FOR i IN 1..7 LOOP
    m:=public.upsert_match_safe('rnd-'||p||'-'||i,'premier_2025',1,'league',
      'Random home '||p||'-'||i,'Random away '||p||'-'||i,NULL,NULL,
      clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
    mids:=array_append(mids,m);
  END LOOP;
  FOREACH mode IN ARRAY ARRAY['marcador','1x2'] LOOP
    INSERT INTO public.casa_pollas(id,slug,name,kind,scoring_mode,status,closes_at,opens_at,created_by,
      entry_price_cop,payout_method,payout_account)
      VALUES(CASE WHEN mode='marcador' THEN p ELSE outcomes END,'random-'||p||'-'||mode,'Random fixture','partidos',mode::public.casa_scoring_mode,
        'abierta',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour',actor,10000,'otro','fixture');
    INSERT INTO public.casa_polla_matches(polla_id,match_id)
      SELECT CASE WHEN mode='marcador' THEN p ELSE outcomes END,unnest(mids);
  END LOOP;
  -- Three editable cases: confirmed future, unknown-time past and cancelled
  -- before play. Four blocked: live, elapsed>0, confirmed cutoff, pool void.
  UPDATE public.matches SET scheduled_at=clock_timestamp()-interval '1 day',scheduled_at_confirmed=false WHERE id=mids[2];
  UPDATE public.matches SET status='cancelled' WHERE id=mids[3];
  UPDATE public.matches SET status='live',elapsed=1 WHERE id=mids[4];
  UPDATE public.matches SET elapsed=1 WHERE id=mids[5];
  UPDATE public.matches SET scheduled_at=clock_timestamp()+interval '4 minutes' WHERE id=mids[6];
  UPDATE public.casa_polla_matches SET voided_at=clock_timestamp() WHERE match_id=mids[7];

  FOR player IN SELECT user_id FROM public.casa_admin_players ORDER BY position LOOP
    result:=public.casa_set_admin_player(p,player,true,0,actor,2);
    ASSERT result->>'randomPicksSaved'='3';
    SELECT id INTO e FROM public.casa_entries WHERE polla_id=p AND user_id=player;
    ASSERT (SELECT count(*) FROM public.casa_picks WHERE entry_id=e)=3;
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=e AND
      (pick_1x2 IS NOT NULL OR home_score IS NULL OR away_score IS NULL OR home_score NOT BETWEEN 0 AND 4 OR away_score NOT BETWEEN 0 AND 4));
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE entry_id=e AND match_id=ANY(mids[4:7]));
    ASSERT (SELECT revision=1 FROM public.casa_pick_save_state WHERE entry_id=e);
    ASSERT (SELECT count(*) FROM public.casa_admin_player_pick_events WHERE entry_id=e AND actor_id=actor)=1;
    snapshot:=public.casa_admin_player_pick_state(p,player,actor);
    PERFORM public.casa_set_admin_player(p,player,true,0,actor,2);
    PERFORM public.casa_set_admin_player(p,player,true,1,actor,2);
    ASSERT public.casa_admin_player_pick_state(p,player,actor)=snapshot,'Retries must not regenerate or rewrite defaults';
    ASSERT (SELECT count(*) FROM public.casa_admin_player_events WHERE entry_id=e)=1;
  END LOOP;
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p)=20;
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE polla_id=p)=60;
  RAISE NOTICE 'PASS all20 profiles receive audited saved scores; provisional/cancelled timing and play/cutoff/void locks retained';

  SELECT user_id INTO player FROM public.casa_admin_players WHERE position=1;
  result:=public.casa_set_admin_player(outcomes,player,true,0,actor,2);
  SELECT id INTO e FROM public.casa_entries WHERE polla_id=outcomes AND user_id=player;
  ASSERT result->>'randomPicksSaved'='3';
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE entry_id=e AND pick_1x2 IN ('L','E','V') AND home_score IS NULL AND away_score IS NULL)=3;
  state:=public.casa_admin_player_pick_state(outcomes,player,actor);
  result:=public.casa_admin_save_player_picks(outcomes,player,actor,e,gen_random_uuid(),(state->>'revision')::bigint,
    jsonb_build_array(jsonb_build_object('matchId',mids[1],'pick1x2','E')),2);
  ASSERT result->>'guardados'='1';
  snapshot:=public.casa_admin_player_pick_state(outcomes,player,actor);
  original:=e;
  PERFORM public.casa_set_admin_player(outcomes,player,false,1,actor,2);
  result:=public.casa_set_admin_player(outcomes,player,true,2,actor,2);
  ASSERT result->>'randomPicksSaved'='0';
  ASSERT public.casa_admin_player_pick_state(outcomes,player,actor)=snapshot;
  ASSERT (SELECT id=original FROM public.casa_entries WHERE polla_id=outcomes AND user_id=player);
  ASSERT (SELECT pick_1x2='E' FROM public.casa_picks WHERE entry_id=e AND match_id=mids[1]);
  RAISE NOTICE 'PASS1X2 defaults, manual overrides, withdrawal/re-add preserve picks and revision';

  INSERT INTO public.casa_pollas(id,slug,name,kind,scoring_mode,status,closes_at,opens_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(failed,'random-failed-'||p,'Atomic random fixture','partidos','marcador','abierta',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour',actor,10000,'otro','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(failed,mids[1]);
  PERFORM set_config('test.random_defaults_fail',failed::text,true);
  PERFORM pg_temp.random_expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',failed,player,actor),'Forced random default save failure');
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=failed);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_picks WHERE polla_id=failed);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pick_save_state WHERE polla_id=failed);
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_admin_player_pick_events ev JOIN public.casa_entries ce ON ce.id=ev.entry_id WHERE ce.polla_id=failed);
  PERFORM set_config('test.random_defaults_fail','',true);
  PERFORM pg_temp.random_expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',failed,player,outsider),'ADMIN_REQUIRED');
  PERFORM pg_temp.random_expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',failed,outsider,actor),'INVALID_MANAGED_PLAYER');
  ASSERT NOT EXISTS(SELECT 1 FROM public.predictions);
  RAISE NOTICE 'PASS atomic rollback on save failure, exact administrator/roster scope, no historical predictions';
END $$;
ROLLBACK;
