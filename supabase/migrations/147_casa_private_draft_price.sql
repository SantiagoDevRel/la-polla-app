-- A selected administrator may change only the price of an unused private draft.
-- Publication, identity, audience and operational children stay locked by 146.
CREATE OR REPLACE FUNCTION public.casa_private_draft_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; draft jsonb;
  editable_columns text[]:=ARRAY['campaign_draft','updated_at'];
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.campaign_draft IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.campaign_draft IS NOT NULL THEN
    IF NEW.entry_price_cop IS DISTINCT FROM OLD.entry_price_cop THEN
      -- Only the price RPC sets this exact old/new pair, together with the
      -- existing actor and pool context checked below. No metadata edit may
      -- be combined with a price change, including by an older RPC.
      IF current_setting('app.casa_private_draft_price_from',true) IS DISTINCT FROM OLD.entry_price_cop::text
        OR current_setting('app.casa_private_draft_price_to',true) IS DISTINCT FROM NEW.entry_price_cop::text THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED';
      END IF;
      editable_columns:=ARRAY['entry_price_cop','updated_at'];
    END IF;
    IF NEW.campaign_draft IS NULL OR NEW.status<>'borrador' OR NEW.publication_mode<>'oculta'
      OR NEW.campaign_draft->'allowed_admin_ids' IS DISTINCT FROM OLD.campaign_draft->'allowed_admin_ids'
      OR (to_jsonb(NEW)-editable_columns) IS DISTINCT FROM (to_jsonb(OLD)-editable_columns) THEN
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

CREATE FUNCTION public.casa_set_private_draft_price_v1(
  p_polla_id uuid,p_entry_price_cop integer,p_expected_price_cop integer,p_actor_id uuid,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND OR p.campaign_draft IS NULL
    OR NOT coalesce(p.campaign_draft->'allowed_admin_ids' ? p_actor_id::text,false) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='POLLA_NOT_FOUND';
  END IF;
  IF p.status<>'borrador' OR p.publication_mode<>'oculta' OR p.archived_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id)
    OR EXISTS(SELECT 1 FROM public.casa_picks WHERE polla_id=p.id)
    OR EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id)
    OR EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p.id)
    OR EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PRIVATE_DRAFT_LOCKED';
  END IF;
  IF p_entry_price_cop IS NULL OR p_entry_price_cop NOT BETWEEN 0 AND 10000000
    OR p_expected_price_cop IS NULL OR p_expected_price_cop NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  IF p.entry_price_cop IS DISTINCT FROM p_expected_price_cop THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PRIVATE_DRAFT_PRICE_CHANGED';
  END IF;
  IF p.entry_price_cop=p_entry_price_cop THEN
    RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'private',true,
      'entryPriceCop',p.entry_price_cop,'previousEntryPriceCop',p.entry_price_cop,'changed',false);
  END IF;
  PERFORM set_config('app.casa_private_draft_actor',p_actor_id::text,true);
  PERFORM set_config('app.casa_private_draft_id',p.id::text,true);
  PERFORM set_config('app.casa_private_draft_price_from',p.entry_price_cop::text,true);
  PERFORM set_config('app.casa_private_draft_price_to',p_entry_price_cop::text,true);
  UPDATE public.casa_pollas SET entry_price_cop=p_entry_price_cop WHERE id=p.id;
  PERFORM set_config('app.casa_private_draft_price_from','',true);
  PERFORM set_config('app.casa_private_draft_price_to','',true);
  PERFORM set_config('app.casa_private_draft_actor','',true);
  PERFORM set_config('app.casa_private_draft_id','',true);
  RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'private',true,
    'entryPriceCop',p_entry_price_cop,'previousEntryPriceCop',p.entry_price_cop,'changed',true);
END $$;

REVOKE ALL ON FUNCTION public.casa_set_private_draft_price_v1(uuid,integer,integer,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_set_private_draft_price_v1(uuid,integer,integer,uuid,integer)
  TO service_role;
