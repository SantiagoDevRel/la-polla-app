-- Private campaign drafts have no global fixtures, entries or operational scoring.
-- Their future slots and proposed tiebreak remain reviewable only by chosen admins.
-- Existing pools and their prize/settlement rules are unchanged.
ALTER TABLE public.casa_pollas ADD COLUMN campaign_draft jsonb;

CREATE FUNCTION public.casa_private_draft_valid(p_draft jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE item jsonb; actor text;
BEGIN
  IF p_draft IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object'
    OR p_draft->>'version' IS DISTINCT FROM '1'
    OR p_draft->>'tie_break' IS DISTINCT FROM 'earliest_registration'
    OR p_draft->'schedule_confirmed' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(p_draft->'allowed_admin_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_draft->'slots') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_draft->'sources') IS DISTINCT FROM 'array'
    OR NOT (p_draft ? 'image_path') THEN RETURN false; END IF;
  IF jsonb_array_length(p_draft->'allowed_admin_ids') NOT BETWEEN 1 AND 10
    OR jsonb_array_length(p_draft->'slots') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(p_draft->'sources')>20
    OR (p_draft->'image_path'<>'null'::jsonb AND
      (jsonb_typeof(p_draft->'image_path')<>'string' OR length(p_draft->>'image_path')>300
        OR p_draft->>'image_path' !~* '^[0-9a-f-]{36}/[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$')) THEN RETURN false; END IF;
  FOR actor IN SELECT value FROM jsonb_array_elements_text(p_draft->'allowed_admin_ids') LOOP
    IF actor IS NULL OR actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_draft->'allowed_admin_ids'))
    <>jsonb_array_length(p_draft->'allowed_admin_ids') THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_draft->'slots') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR length(coalesce(item->>'slot_id','')) NOT BETWEEN 1 AND 100
      OR item->>'stage' NOT IN ('cuadrangulares','final') OR item->>'stage' IS NULL
      OR coalesce(item->>'order','') !~ '^[0-9]+$'
      OR length(coalesce(item->>'stage_label','')) NOT BETWEEN 1 AND 100
      OR NOT (item ?& ARRAY['group','matchday','game_in_group_matchday','leg'])
      OR (item->'group'<>'null'::jsonb AND item->>'group' NOT IN ('A','B'))
      OR (item->'matchday'<>'null'::jsonb AND coalesce(item->>'matchday','') !~ '^[1-6]$')
      OR (item->'game_in_group_matchday'<>'null'::jsonb AND coalesce(item->>'game_in_group_matchday','') !~ '^[12]$')
      OR length(coalesce(item->>'label','')) NOT BETWEEN 1 AND 200
      OR length(coalesce(item->>'home_label','')) NOT BETWEEN 1 AND 100
      OR length(coalesce(item->>'away_label','')) NOT BETWEEN 1 AND 100
      OR item->'match_id' IS DISTINCT FROM 'null'::jsonb
      OR item->'scheduled_at' IS DISTINCT FROM 'null'::jsonb
      OR item->'home_team' IS DISTINCT FROM 'null'::jsonb
      OR item->'away_team' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'slot_id') FROM jsonb_array_elements(p_draft->'slots'))
    <>jsonb_array_length(p_draft->'slots') THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_draft->'sources') LOOP
    IF length(coalesce(item->>'title','')) NOT BETWEEN 1 AND 200
      OR coalesce(item->>'url','') !~ '^https://' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE public.casa_pollas ADD CONSTRAINT casa_private_draft_config_valid
  CHECK (public.casa_private_draft_valid(campaign_draft));
ALTER TABLE public.casa_pollas ADD CONSTRAINT casa_private_draft_unpublished
  CHECK (campaign_draft IS NULL OR (status='borrador' AND publication_mode='oculta'
    AND kind='partidos' AND scoring_mode='1x2' AND prize_kind='objeto'));

-- Direct Data API reads remain denied even if another permissive policy is added.
-- Authorized admins use an authenticated server route with an explicit allowlist.
CREATE POLICY casa_private_drafts_read ON public.casa_pollas AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (campaign_draft IS NULL);
CREATE POLICY casa_private_drafts_matches_read ON public.casa_polla_matches AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.casa_pollas p WHERE p.id=polla_id AND p.campaign_draft IS NULL));
CREATE POLICY casa_private_drafts_questions_read ON public.casa_questions AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.casa_pollas p WHERE p.id=polla_id AND p.campaign_draft IS NULL));
CREATE POLICY casa_private_drafts_options_read ON public.casa_options AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.casa_questions q JOIN public.casa_pollas p ON p.id=q.polla_id WHERE q.id=question_id AND p.campaign_draft IS NULL));

CREATE FUNCTION public.casa_private_draft_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; draft jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.campaign_draft IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.campaign_draft IS NOT NULL THEN
    IF NEW.campaign_draft IS NULL OR NEW.status<>'borrador' OR NEW.publication_mode<>'oculta'
      OR NEW.campaign_draft->'allowed_admin_ids' IS DISTINCT FROM OLD.campaign_draft->'allowed_admin_ids'
      OR (to_jsonb(NEW)-ARRAY['campaign_draft','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['campaign_draft','updated_at']) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED';
    END IF;
    draft:=OLD.campaign_draft;
  ELSIF NEW.campaign_draft IS NOT NULL THEN
    IF TG_OP='UPDATE' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED'; END IF;
    draft:=NEW.campaign_draft;
  ELSE RETURN NEW;
  END IF;
  actor:=nullif(current_setting('app.casa_private_draft_actor',true),'')::uuid;
  IF current_setting('app.casa_private_draft_id',true) IS DISTINCT FROM NEW.id::text
    OR actor IS NULL OR NOT coalesce(draft->'allowed_admin_ids' ? actor::text,false)
    OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND is_admin) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PRIVATE_DRAFT_FORBIDDEN';
  END IF;
  IF NEW.campaign_draft->'image_path'<>'null'::jsonb
    AND split_part(NEW.campaign_draft->>'image_path','/',1) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PRIVATE_DRAFT_IMAGE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER casa_01_private_draft BEFORE INSERT OR UPDATE OR DELETE ON public.casa_pollas
  FOR EACH ROW EXECUTE FUNCTION public.casa_private_draft_write_guard();

-- A private draft is never an operational pool: no children may be attached.
CREATE FUNCTION public.casa_private_draft_child_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=NEW.polla_id AND campaign_draft IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER casa_01_private_draft BEFORE INSERT OR UPDATE ON public.casa_polla_matches
  FOR EACH ROW EXECUTE FUNCTION public.casa_private_draft_child_guard();
CREATE TRIGGER casa_01_private_draft BEFORE INSERT OR UPDATE ON public.casa_questions
  FOR EACH ROW EXECUTE FUNCTION public.casa_private_draft_child_guard();
CREATE TRIGGER casa_01_private_draft BEFORE INSERT OR UPDATE ON public.casa_entries
  FOR EACH ROW EXECUTE FUNCTION public.casa_private_draft_child_guard();
CREATE TRIGGER casa_01_private_draft BEFORE INSERT OR UPDATE ON public.casa_picks
  FOR EACH ROW EXECUTE FUNCTION public.casa_private_draft_child_guard();
CREATE TRIGGER casa_01_private_draft BEFORE INSERT OR UPDATE ON public.casa_payouts
  FOR EACH ROW EXECUTE FUNCTION public.casa_private_draft_child_guard();

CREATE FUNCTION public.casa_create_private_draft_v1(p_config jsonb,p_slug text,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE draft jsonb:=p_config->'campaignDraft'; v_id uuid:=coalesce((p_config->>'id')::uuid,gen_random_uuid());
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF draft IS NULL OR NOT public.casa_private_draft_valid(draft)
    OR NOT coalesce(draft->'allowed_admin_ids' ? p_actor_id::text,false) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PRIVATE_DRAFT';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(draft->'allowed_admin_ids') a
    WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=a.value::uuid AND u.is_admin)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_DRAFT_ADMIN';
  END IF;
  IF length(btrim(coalesce(p_config->>'name',''))) NOT BETWEEN 3 AND 80
    OR p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{2,79}$'
    OR length(coalesce(p_config->>'description',''))>2000
    OR length(btrim(coalesce(p_config->>'prizeObject',''))) NOT BETWEEN 3 AND 160
    OR coalesce((p_config->>'entryPriceCop')::integer,-1) NOT BETWEEN 0 AND 10000000
    OR p_config->>'closesAt' IS NULL OR (p_config->>'closesAt')::timestamptz<=clock_timestamp()
    OR nullif(p_config->>'tournament','') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  PERFORM set_config('app.casa_private_draft_actor',p_actor_id::text,true);
  PERFORM set_config('app.casa_private_draft_id',v_id::text,true);
  INSERT INTO public.casa_pollas(id,slug,name,description,kind,tournament,scoring_mode,entry_price_cop,
    house_cut_pct,prize_kind,prize_object,points_result,points_exact,points_one_team,status,
    opens_at,closes_at,close_mode,created_by,publication_mode,campaign_draft)
  VALUES(v_id,p_slug,btrim(p_config->>'name'),p_config->>'description','partidos',p_config->>'tournament','1x2',
    (p_config->>'entryPriceCop')::integer,100,'objeto',btrim(p_config->>'prizeObject'),3,3,1,'borrador',
    clock_timestamp(),(p_config->>'closesAt')::timestamptz,'manual',p_actor_id,'oculta',draft);
  PERFORM set_config('app.casa_private_draft_actor','',true);
  PERFORM set_config('app.casa_private_draft_id','',true);
  RETURN jsonb_build_object('ok',true,'id',v_id,'slug',p_slug,'private',true);
END $$;

CREATE FUNCTION public.casa_update_private_draft_v1(p_polla_id uuid,p_campaign_draft jsonb,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND OR p.campaign_draft IS NULL OR NOT coalesce(p.campaign_draft->'allowed_admin_ids' ? p_actor_id::text,false) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='POLLA_NOT_FOUND';
  END IF;
  IF p_campaign_draft IS NULL OR NOT public.casa_private_draft_valid(p_campaign_draft)
    OR p_campaign_draft->'allowed_admin_ids' IS DISTINCT FROM p.campaign_draft->'allowed_admin_ids' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PRIVATE_DRAFT';
  END IF;
  PERFORM set_config('app.casa_private_draft_actor',p_actor_id::text,true);
  PERFORM set_config('app.casa_private_draft_id',p.id::text,true);
  UPDATE public.casa_pollas SET campaign_draft=p_campaign_draft WHERE id=p.id;
  PERFORM set_config('app.casa_private_draft_actor','',true);
  PERFORM set_config('app.casa_private_draft_id','',true);
  RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'private',true);
END $$;

REVOKE ALL ON FUNCTION public.casa_private_draft_valid(jsonb),public.casa_private_draft_write_guard(),
  public.casa_private_draft_child_guard(),public.casa_create_private_draft_v1(jsonb,text,uuid,integer),
  public.casa_update_private_draft_v1(uuid,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_private_draft_valid(jsonb),public.casa_private_draft_write_guard(),
  public.casa_private_draft_child_guard(),public.casa_create_private_draft_v1(jsonb,text,uuid,integer),
  public.casa_update_private_draft_v1(uuid,jsonb,uuid,integer) TO service_role;
