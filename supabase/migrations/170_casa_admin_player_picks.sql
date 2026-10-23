-- Administrator-authored picks use the existing versioned writer and locks.
-- Installation creates no entries or picks and changes no historical predictions.
CREATE TABLE public.casa_admin_player_pick_events (
  entry_id uuid NOT NULL REFERENCES public.casa_entries(id),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(entry_id,request_id)
);
ALTER TABLE public.casa_admin_player_pick_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY casa_admin_player_pick_events_deny ON public.casa_admin_player_pick_events
  FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON public.casa_admin_player_pick_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.casa_admin_player_pick_events TO service_role;

CREATE FUNCTION public.casa_admin_player_pick_entry(p_polla_id uuid,p_user_id uuid,p_actor_id uuid)
RETURNS public.casa_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries;
BEGIN
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF NOT EXISTS(SELECT 1 FROM public.casa_admin_players WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MANAGED_PLAYER';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=p_polla_id AND archived_at IS NULL
    AND campaign_draft IS NULL AND publication_mode<>'oculta' AND opens_at<=clock_timestamp() AND status<>'borrador') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_PUBLISHED';
  END IF;
  SELECT * INTO e FROM public.casa_entries WHERE polla_id=p_polla_id AND user_id=p_user_id
    AND status='pagada' ORDER BY created_at,id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MANAGED_ENTRY_REQUIRED'; END IF;
  IF e.proof_path IS NOT NULL OR e.current_proof_attempt_id IS NOT NULL
    OR (SELECT count(*) FROM public.casa_entries WHERE polla_id=p_polla_id AND user_id=p_user_id)<>1
    OR NOT coalesce((SELECT selected FROM public.casa_admin_player_events WHERE entry_id=e.id ORDER BY revision DESC LIMIT 1),false) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MANAGED_ENTRY_CONFLICT';
  END IF;
  RETURN e;
END $$;

CREATE FUNCTION public.casa_admin_player_pick_state(p_polla_id uuid,p_user_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries; state jsonb;
BEGIN
  e:=public.casa_admin_player_pick_entry(p_polla_id,p_user_id,p_actor_id);
  state:=public.casa_pick_save_state_v1(p_polla_id,p_user_id,e.id);
  IF state IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_PUBLISHED'; END IF;
  RETURN state||jsonb_build_object('entryId',e.id,'ownerId',p_user_id,'entryNumber',e.entry_number);
END $$;

CREATE FUNCTION public.casa_admin_save_player_picks(
  p_polla_id uuid,p_user_id uuid,p_actor_id uuid,p_entry_id uuid,
  p_request_id uuid,p_expected_revision bigint,p_picks jsonb,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='2s' SET statement_timeout='10s' AS $$
DECLARE e public.casa_entries; result jsonb;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PICK_REQUEST';
  END IF;
  -- Same parent-before-child lock order as enrollment/settlement; a withdrawal
  -- cannot race the paid-entry check or the versioned save.
  PERFORM id FROM public.casa_pollas WHERE id=p_polla_id FOR SHARE NOWAIT;
  e:=public.casa_admin_player_pick_entry(p_polla_id,p_user_id,p_actor_id);
  IF e.id IS DISTINCT FROM p_entry_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MANAGED_ENTRY_CONFLICT'; END IF;
  result:=public.casa_save_picks_v1(p_polla_id,p_user_id,e.id,p_request_id,p_expected_revision,p_picks);
  IF result->>'ok'='true' THEN
    INSERT INTO public.casa_admin_player_pick_events(entry_id,request_id,actor_id)
      VALUES(e.id,p_request_id,p_actor_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.casa_admin_player_pick_entry(uuid,uuid,uuid),
  public.casa_admin_player_pick_state(uuid,uuid,uuid),
  public.casa_admin_save_player_picks(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_admin_player_pick_entry(uuid,uuid,uuid),
  public.casa_admin_player_pick_state(uuid,uuid,uuid),
  public.casa_admin_save_player_picks(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,integer) TO service_role;
