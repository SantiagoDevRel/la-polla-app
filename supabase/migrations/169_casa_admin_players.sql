-- The approved roster only. Installing this migration enrolls nobody and
-- changes no existing user, payment, prediction, pick or award.
CREATE TABLE public.casa_admin_players (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  position integer NOT NULL UNIQUE CHECK(position BETWEEN 1 AND 20)
);
CREATE TABLE public.casa_admin_player_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.casa_entries(id),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  revision integer NOT NULL CHECK(revision > 0),
  selected boolean NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(entry_id,revision)
);
ALTER TABLE public.casa_admin_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_admin_player_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY casa_admin_players_deny ON public.casa_admin_players
  FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY casa_admin_player_events_deny ON public.casa_admin_player_events
  FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON public.casa_admin_players,public.casa_admin_player_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.casa_admin_players,public.casa_admin_player_events TO service_role;

-- A fresh installation may not have these private, administrator-created
-- profiles. Never manufacture replacement users or match somebody by name.
INSERT INTO public.casa_admin_players(user_id,position)
SELECT u.id,r.position FROM (VALUES
  ('cf482734-5791-4671-b180-9878da2a41fa'::uuid,1),
  ('ada52d2b-10b1-4a91-8301-fd6f86f5abce'::uuid,2),
  ('a3a0ae72-560a-4182-b2aa-7b46c4f27e0b'::uuid,3),
  ('ff8c4465-1b2f-42a4-a0d2-1e2da448d338'::uuid,4),
  ('deb9d67c-66d1-4bf0-be26-a06cd2133e63'::uuid,5),
  ('ceaa32f1-cb83-4343-a179-8be090da502a'::uuid,6),
  ('30ed8c74-3499-4569-a99d-106a0aa41e2a'::uuid,7),
  ('0a285753-a7c1-447f-965c-19a427bd6419'::uuid,8),
  ('359fbba6-57ca-445d-b6bf-bdc060f8d55a'::uuid,9),
  ('29c22121-1bec-4ea0-b2bf-91f7ddcc7808'::uuid,10),
  ('6b233cd3-c747-41ce-bba1-eb68940a4d76'::uuid,11),
  ('74adc058-99f6-4bed-90b1-1472fcc58863'::uuid,12),
  ('c07027b4-b864-4c38-a99e-4b563fb4b5e5'::uuid,13),
  ('89737fda-aebc-4dd6-ac95-2bd8924ca426'::uuid,14),
  ('20cfe7f9-359f-4a5f-9da4-4663b6069fd5'::uuid,15),
  ('978a261f-09df-453c-9e7b-fa22fbfdced2'::uuid,16),
  ('3903611c-e036-4f22-b2ed-e1775ec75a26'::uuid,17),
  ('80ffecc2-6fbb-4a7b-982b-9b9e83aaca2b'::uuid,18),
  ('e41580b4-380e-4ceb-9613-e58cccfb28a9'::uuid,19),
  ('82256107-d805-445d-acbd-9e69c61aa879'::uuid,20)
) r(user_id,position) JOIN public.users u ON u.id=r.user_id;

-- Retain the installed payment/proof guards verbatim. The sole additional
-- transition is paid -> annulled for this selector's receipt-free entries,
-- backed by an immutable event in the same transaction. No proof is fabricated.
DO $$ DECLARE definition text; needle text; addition text;
BEGIN
  SELECT pg_get_functiondef('public.casa_v2_write_guard()'::regprocedure) INTO definition;
  definition:=replace(definition,chr(13),'');
  needle:=$needle$IF OLD.status='pagada' AND NEW IS DISTINCT FROM OLD THEN$needle$;
  addition:=$addition$
        IF NEW.status='anulada' AND OLD.proof_path IS NULL AND OLD.current_proof_attempt_id IS NULL
          AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM
              (to_jsonb(OLD)-ARRAY['status','updated_at'])
          AND p.status='abierta' AND p.closes_at>clock_timestamp()
          AND EXISTS(SELECT 1 FROM public.casa_admin_player_events ev
            JOIN public.casa_admin_players roster ON roster.user_id=OLD.user_id
            JOIN public.users actor ON actor.id=ev.actor_id AND actor.is_admin
            WHERE ev.id::text=current_setting('app.casa_admin_player_event',true)
              AND ev.entry_id=OLD.id AND NOT ev.selected
              AND ev.transaction_id=txid_current()
              AND ev.revision=(SELECT max(latest.revision) FROM public.casa_admin_player_events latest WHERE latest.entry_id=OLD.id)
              AND EXISTS(SELECT 1 FROM public.casa_admin_player_events prior
                WHERE prior.entry_id=OLD.id AND prior.selected AND prior.revision<ev.revision))
        THEN RETURN NEW; END IF;
  $addition$;
  IF position(needle IN definition)=0 THEN
    RAISE EXCEPTION 'Paid-entry guard differs; inspect before applying 169';
  END IF;
  EXECUTE replace(definition,needle,needle||addition);
END $$;

CREATE FUNCTION public.casa_get_admin_players(p_polla_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; players jsonb;
BEGIN
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'name',u.display_name,'avatar',u.avatar_url,
    'selected',coalesce(e.status='pagada',false),'ticket',e.ticket_number,
    'revision',coalesce(ev.revision,0),
    'conflict',e.id IS NOT NULL AND (ev.revision IS NULL OR e.proof_path IS NOT NULL
      OR e.current_proof_attempt_id IS NOT NULL OR e.entry_count>1)
  ) ORDER BY r.position),'[]'::jsonb) INTO players
  FROM public.casa_admin_players r JOIN public.users u ON u.id=r.user_id
  LEFT JOIN LATERAL (
    SELECT ce.id,ce.status,ce.ticket_number,ce.proof_path,ce.current_proof_attempt_id,
      count(*) OVER() AS entry_count
    FROM public.casa_entries ce WHERE ce.polla_id=p.id AND ce.user_id=r.user_id
    ORDER BY ce.created_at,ce.id LIMIT 1
  ) e ON true
  LEFT JOIN LATERAL (
    SELECT max(revision) AS revision FROM public.casa_admin_player_events WHERE entry_id=e.id
  ) ev ON true;
  RETURN jsonb_build_object('players',players,'editable',
    p.status='abierta' AND p.closes_at>clock_timestamp() AND p.opens_at<=clock_timestamp()
    AND p.publication_mode<>'oculta'
    AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id)
    AND EXISTS(SELECT 1 FROM public.casa_operation_control WHERE singleton AND mode='v2'));
END $$;

CREATE FUNCTION public.casa_set_admin_player(
  p_polla_id uuid,p_user_id uuid,p_selected boolean,p_revision integer,p_actor_id uuid,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; e public.casa_entries; v_revision integer; v_event uuid; v_ticket integer;
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
  -- Desired-state retries are safe after a lost response; a stale request may
  -- never reverse a newer admin action (including an add/remove/add sequence).
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
      -- A retained failed/annulled ticket is still owned. Never steal it.
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
  -- No writes to predictions/casa_picks, no settlement and no JS money math.
  RETURN public.casa_get_admin_players(p.id,p_actor_id);
END $$;

REVOKE ALL ON FUNCTION public.casa_get_admin_players(uuid,uuid),
  public.casa_set_admin_player(uuid,uuid,boolean,integer,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_get_admin_players(uuid,uuid),
  public.casa_set_admin_player(uuid,uuid,boolean,integer,uuid,integer) TO service_role;
