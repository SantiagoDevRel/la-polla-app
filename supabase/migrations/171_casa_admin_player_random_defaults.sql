-- The owner explicitly requested saved random predictions on checkbox enrollment.
-- Installation changes no entries or picks. Only a new selected transition runs
-- this code; readbacks, desired-state retries and already selected entries do not.
CREATE OR REPLACE FUNCTION public.casa_set_admin_player(
  p_polla_id uuid,p_user_id uuid,p_selected boolean,p_revision integer,p_actor_id uuid,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='2s' SET statement_timeout='10s' AS $$
DECLARE p public.casa_pollas; e public.casa_entries; v_revision integer; v_event uuid; v_ticket integer;
  candidate record; picks jsonb:='[]'; state jsonb; result jsonb; v_saved integer:=0;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_selected IS NULL OR p_revision IS NULL OR p_revision<0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PLAYER_SELECTION';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.casa_admin_players WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MANAGED_PLAYER';
  END IF;
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p.status<>'abierta' OR p.closes_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED';
  END IF;
  IF p.publication_mode='oculta' OR p.opens_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_PUBLISHED';
  END IF;
  IF (SELECT count(*) FROM public.casa_entries WHERE polla_id=p.id AND user_id=p_user_id)>1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MANAGED_ENTRY_CONFLICT';
  END IF;
  SELECT * INTO e FROM public.casa_entries WHERE polla_id=p.id AND user_id=p_user_id FOR UPDATE;
  SELECT coalesce(max(revision),0) INTO v_revision FROM public.casa_admin_player_events WHERE entry_id=e.id;
  IF e.id IS NOT NULL AND (v_revision=0 OR e.proof_path IS NOT NULL OR e.current_proof_attempt_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MANAGED_ENTRY_CONFLICT';
  END IF;
  IF p_revision<>v_revision THEN
    IF p_revision=v_revision-1 AND p_selected=(e.status='pagada') THEN
      RETURN public.casa_get_admin_players(p.id,p_actor_id);
    END IF;
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PLAYER_SELECTION_CHANGED';
  END IF;
  IF p_selected=coalesce(e.status='pagada',false) THEN
    RETURN public.casa_get_admin_players(p.id,p_actor_id);
  END IF;
  IF e.id IS NULL THEN
    IF p.kind='rifa' THEN
      SELECT n INTO v_ticket FROM generate_series(1,p.ticket_count) n
        WHERE NOT EXISTS(SELECT 1 FROM public.casa_entries ce WHERE ce.polla_id=p.id AND ce.ticket_number=n)
        ORDER BY n LIMIT 1;
      IF v_ticket IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_AVAILABLE_TICKETS'; END IF;
    END IF;
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number,reviewed_at,reviewed_by)
      VALUES(p.id,p_user_id,'pagada',p.entry_price_cop,v_ticket,clock_timestamp(),p_actor_id) RETURNING * INTO e;
  END IF;
  INSERT INTO public.casa_admin_player_events(entry_id,actor_id,revision,selected)
    VALUES(e.id,p_actor_id,v_revision+1,p_selected) RETURNING id INTO v_event;
  PERFORM set_config('app.casa_admin_player_event',v_event::text,true);
  IF p_selected AND e.status<>'pagada' THEN
    UPDATE public.casa_entries SET status='pagada',reviewed_at=clock_timestamp(),reviewed_by=p_actor_id WHERE id=e.id;
  ELSIF NOT p_selected THEN
    UPDATE public.casa_entries SET status='anulada' WHERE id=e.id;
  END IF;

  IF p_selected AND p.kind='partidos' THEN
    -- Lock candidates in identity order while retaining the parent's enrollment
    -- lock. Real kickoff/void/play evidence always wins, including provisional
    -- dates and cancelled matches that have not started. The existing writer
    -- and lifecycle trigger check every candidate again before persistence.
    FOR candidate IN
      SELECT m.id,k.pick_1x2,k.home_score,k.away_score
      FROM public.casa_polla_matches pm JOIN public.matches m ON m.id=pm.match_id
      LEFT JOIN public.casa_picks k ON k.entry_id=e.id AND k.match_id=m.id
      WHERE pm.polla_id=p.id AND pm.voided_at IS NULL AND m.final_verified_at IS NULL
        AND (m.status='scheduled' OR (m.status='cancelled' AND coalesce(m.elapsed,0)=0))
        AND coalesce(m.elapsed,0)=0
        AND (NOT m.scheduled_at_confirmed OR m.scheduled_at-interval '5 minutes'>clock_timestamp())
        AND CASE WHEN p.scoring_mode='1x2' THEN k.pick_1x2 IS NULL
          ELSE k.home_score IS NULL OR k.away_score IS NULL END
      ORDER BY m.id FOR SHARE OF m NOWAIT
    LOOP
      picks:=picks||jsonb_build_array(CASE WHEN p.scoring_mode='1x2' THEN
        jsonb_build_object('matchId',candidate.id,'pick1x2',(ARRAY['L','E','V'])[1+floor(random()*3)::integer])
      ELSE jsonb_build_object('matchId',candidate.id,
        'homeScore',coalesce(candidate.home_score,floor(random()*5)::integer),
        'awayScore',coalesce(candidate.away_score,floor(random()*5)::integer)) END);
    END LOOP;
    IF jsonb_array_length(picks)>0 THEN
      state:=public.casa_pick_save_state_v1(p.id,p_user_id,e.id);
      result:=public.casa_admin_save_player_picks(p.id,p_user_id,p_actor_id,e.id,v_event,
        (state->>'revision')::bigint,picks,p_contract);
      v_saved:=coalesce((result->>'guardados')::integer,0);
      IF result->>'ok' IS DISTINCT FROM 'true' OR v_saved<>jsonb_array_length(picks) THEN
        -- No half-enrolled player on conflicts, elapsed cutoff or a failed save.
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='No se pudo completar la inscripción con sus pronósticos. Actualiza la lista e intenta de nuevo.';
      END IF;
    END IF;
  END IF;
  RETURN public.casa_get_admin_players(p.id,p_actor_id)||jsonb_build_object('randomPicksSaved',v_saved);
END $$;

REVOKE ALL ON FUNCTION public.casa_set_admin_player(uuid,uuid,boolean,integer,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_set_admin_player(uuid,uuid,boolean,integer,uuid,integer) TO service_role;
