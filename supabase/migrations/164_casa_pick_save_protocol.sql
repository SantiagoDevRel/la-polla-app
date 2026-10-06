-- Bounded confirmations for Casa picks. No existing pick, entry, or score is changed.
CREATE TABLE public.casa_pick_save_state (
  entry_id uuid PRIMARY KEY REFERENCES public.casa_entries(id) ON DELETE CASCADE,
  polla_id uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_request_id uuid,
  last_input jsonb,
  last_result jsonb
);
ALTER TABLE public.casa_pick_save_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY casa_pick_save_state_private ON public.casa_pick_save_state
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.casa_pick_save_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.casa_pick_save_state TO service_role;

-- Preserve lifecycle checks; players share the pool lock. NOWAIT still prevents
-- child-first direct writers deadlocking with parent-first settlement/scoring.
CREATE OR REPLACE FUNCTION public.casa_guard_pick_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; m public.matches; q public.casa_questions;
BEGIN
  IF TG_OP='UPDATE' AND
    (to_jsonb(NEW)-'points_earned'-'updated_at') IS NOT DISTINCT FROM
    (to_jsonb(OLD)-'points_earned'-'updated_at') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.polla_id,NEW.entry_id,NEW.user_id,NEW.match_id,NEW.question_id)
    IS DISTINCT FROM (OLD.polla_id,OLD.entry_id,OLD.user_id,OLD.match_id,OLD.question_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='No se puede mover un pronóstico a otra inscripción o partido.';
  END IF;
  IF (SELECT mode FROM public.casa_operation_control WHERE singleton FOR SHARE)='paused' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPERATIONS_PAUSED';
  END IF;
  BEGIN
    SELECT * INTO p FROM public.casa_pollas WHERE id=NEW.polla_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='La polla se está actualizando. Intenta guardar de nuevo.';
  END;
  IF NOT FOUND OR p.archived_at IS NOT NULL OR p.publication_mode='oculta' OR p.opens_at>clock_timestamp()
    OR p.status NOT IN ('abierta','cerrada') OR
    EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esta polla ya no recibe pronósticos. Los anteriores se conservaron.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.id=NEW.entry_id AND e.polla_id=p.id
    AND e.user_id=NEW.user_id AND (e.status='pagada' OR (e.status='pendiente' AND e.proof_path IS NOT NULL))) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Primero tienes que inscribirte a la polla.';
  END IF;
  IF NEW.match_id IS NOT NULL THEN
    SELECT m1.* INTO m FROM public.matches m1 JOIN public.casa_polla_matches pm ON pm.match_id=m1.id
      WHERE pm.polla_id=p.id AND m1.id=NEW.match_id FOR SHARE OF m1 NOWAIT;
    IF NOT FOUND OR p.kind<>'partidos' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Ese partido no pertenece a la polla.',HINT='CASA_PICK_TARGET';
    END IF;
    IF NOT (m.status='scheduled' OR (m.status='cancelled' AND coalesce(m.elapsed,0)=0))
      OR coalesce(m.elapsed,0)>0 OR m.final_verified_at IS NOT NULL
      OR (m.scheduled_at_confirmed AND m.scheduled_at-interval '5 minutes'<=clock_timestamp())
      OR EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p.id AND match_id=m.id AND voided_at IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Este partido ya cerró sus pronósticos (5 minutos antes del inicio) o fue anulado.',HINT='CASA_PICK_TARGET';
    END IF;
  ELSE
    SELECT * INTO q FROM public.casa_questions WHERE id=NEW.question_id AND polla_id=p.id FOR SHARE NOWAIT;
    IF NOT FOUND OR p.kind<>'manual' OR q.resolved_at IS NOT NULL OR p.status<>'abierta' OR p.closes_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esta pregunta ya no recibe respuestas.',HINT='CASA_PICK_TARGET';
    END IF;
    IF NEW.option_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.casa_options WHERE id=NEW.option_id AND question_id=q.id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='La opción no pertenece a esta pregunta.',HINT='CASA_PICK_TARGET';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Direct/legacy value edits invalidate the version. Scoring does not.
CREATE FUNCTION public.casa_pick_revision_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.match_id,NEW.question_id,NEW.pick_1x2,NEW.home_score,NEW.away_score,NEW.option_id,NEW.free_text)
    IS NOT DISTINCT FROM (OLD.match_id,OLD.question_id,OLD.pick_1x2,OLD.home_score,OLD.away_score,OLD.option_id,OLD.free_text) THEN RETURN NEW; END IF;
  IF nullif(current_setting('app.casa_pick_request',true),'') IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.casa_pick_save_state(entry_id,polla_id,user_id,revision)
    VALUES(NEW.entry_id,NEW.polla_id,NEW.user_id,1)
    ON CONFLICT(entry_id) DO UPDATE SET revision=casa_pick_save_state.revision+1,
      last_request_id=NULL,last_input=NULL,last_result=NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER casa_pick_revision AFTER INSERT OR UPDATE ON public.casa_picks
  FOR EACH ROW EXECUTE FUNCTION public.casa_pick_revision_changed();

CREATE FUNCTION public.casa_pick_save_state_v1(p_polla_id uuid,p_user_id uuid,p_entry_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('revision',coalesce(s.revision,0),'lastResult',s.last_result,
    'picks',coalesce((SELECT jsonb_object_agg(coalesce(k.match_id,k.question_id)::text,
      jsonb_build_object('pick1x2',k.pick_1x2,'homeScore',k.home_score,'awayScore',k.away_score,
        'optionId',k.option_id,'freeText',k.free_text,'pointsEarned',k.points_earned))
      FROM public.casa_picks k WHERE k.entry_id=e.id AND k.polla_id=p_polla_id AND k.user_id=p_user_id),'{}'::jsonb))
    FROM public.casa_entries e JOIN public.casa_pollas p ON p.id=e.polla_id
    LEFT JOIN public.casa_pick_save_state s ON s.entry_id=e.id AND s.user_id=e.user_id AND s.polla_id=e.polla_id
    WHERE e.id=p_entry_id AND e.polla_id=p_polla_id AND e.user_id=p_user_id
      AND p.status<>'borrador' AND p.campaign_draft IS NULL;
$$;

CREATE FUNCTION public.casa_save_picks_v1(p_polla_id uuid,p_user_id uuid,p_entry_id uuid,
  p_request_id uuid,p_expected_revision bigint,p_picks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='2s' SET statement_timeout='10s' AS $$
DECLARE p public.casa_pollas; e public.casa_entries; s public.casa_pick_save_state;
  item jsonb; input jsonb; results jsonb:='[]'; warnings jsonb:='[]'; answer jsonb;
  target uuid; mid uuid; qid uuid; oid uuid; x char(1); hs smallint; aws smallint; txt text;
  q public.casa_questions; row public.casa_picks; saved integer:=0; hint text; msg text; prior_marker text;
BEGIN
  IF p_user_id IS NULL OR p_entry_id IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_picks) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_picks) NOT BETWEEN 1 AND 60 OR p_expected_revision<0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PICK_REQUEST';
  END IF;
  IF (SELECT count(DISTINCT coalesce(value->>'matchId',value->>'questionId')) FROM jsonb_array_elements(p_picks))<>jsonb_array_length(p_picks) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DUPLICATE_PICK_TARGET';
  END IF;
  input:=jsonb_build_object('expectedRevision',p_expected_revision,'picks',p_picks);
  -- Read-only replay remains available after closure. Never return another user's ACK.
  SELECT * INTO s FROM public.casa_pick_save_state WHERE entry_id=p_entry_id AND user_id=p_user_id AND polla_id=p_polla_id;
  IF FOUND AND s.last_request_id=p_request_id THEN
    IF s.last_input IS DISTINCT FROM input THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PICK_REQUEST_REUSED'; END IF;
    RETURN s.last_result;
  END IF;
  IF (SELECT mode FROM public.casa_operation_control WHERE singleton FOR SHARE)='paused' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPERATIONS_PAUSED';
  END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR SHARE NOWAIT;
  IF NOT FOUND OR p.archived_at IS NOT NULL OR p.campaign_draft IS NOT NULL OR p.publication_mode='oculta'
    OR p.opens_at>clock_timestamp() OR p.status NOT IN ('abierta','cerrada')
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esta polla ya no recibe pronósticos. Los anteriores se conservaron.';
  END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=p_entry_id AND polla_id=p_polla_id AND user_id=p_user_id FOR SHARE;
  IF NOT FOUND OR NOT(e.status='pagada' OR (e.status='pendiente' AND e.proof_path IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Primero tienes que inscribirte a la polla.';
  END IF;
  INSERT INTO public.casa_pick_save_state(entry_id,polla_id,user_id) VALUES(e.id,p.id,p_user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.casa_pick_save_state WHERE entry_id=e.id FOR UPDATE;
  IF s.last_request_id=p_request_id THEN
    IF s.last_input IS DISTINCT FROM input THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PICK_REQUEST_REUSED'; END IF;
    RETURN s.last_result;
  END IF;
  IF p_expected_revision IS NOT NULL AND s.revision<>p_expected_revision THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'revision',s.revision,
      'error','Hay pronósticos más recientes. Revisa tus cambios antes de volver a guardar.');
  END IF;
  prior_marker:=current_setting('app.casa_pick_request',true);
  PERFORM set_config('app.casa_pick_request',p_request_id::text,true);
  FOR item IN SELECT value FROM jsonb_array_elements(p_picks) LOOP
    mid:=(item->>'matchId')::uuid; qid:=(item->>'questionId')::uuid; target:=coalesce(mid,qid);
    IF num_nonnulls(mid,qid)<>1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PICK_TARGET'; END IF;
    x:=NULL; hs:=NULL; aws:=NULL; oid:=NULL; txt:=NULL;
    BEGIN
      IF mid IS NOT NULL THEN
        IF p.kind<>'partidos' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Ese partido no pertenece a la polla.',HINT='CASA_PICK_TARGET'; END IF;
        IF p.scoring_mode='1x2' THEN x:=item->>'pick1x2'; ELSE hs:=(item->>'homeScore')::smallint; aws:=(item->>'awayScore')::smallint; END IF;
        IF (p.scoring_mode='1x2' AND (x IS NULL OR x NOT IN ('L','E','V')))
          OR (p.scoring_mode='marcador' AND (hs IS NULL OR aws IS NULL)) THEN
          RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Completa este pronóstico antes de guardar.',HINT='CASA_PICK_TARGET';
        END IF;
      ELSE
        SELECT * INTO q FROM public.casa_questions WHERE id=qid AND polla_id=p.id;
        IF NOT FOUND OR p.kind<>'manual' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Esa pregunta no pertenece a la polla.',HINT='CASA_PICK_TARGET'; END IF;
        oid:=(item->>'optionId')::uuid; txt:=nullif(btrim(item->>'freeText'),'');
        IF (q.input_kind='opciones' AND oid IS NULL) OR (q.input_kind='texto' AND txt IS NULL) THEN
          RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Completa esta respuesta antes de guardar.',HINT='CASA_PICK_TARGET';
        END IF;
        IF q.input_kind='opciones' THEN txt:=NULL; ELSE oid:=NULL; END IF;
        IF length(txt)>120 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PICK_TEXT'; END IF;
      END IF;
      IF mid IS NOT NULL THEN
        INSERT INTO public.casa_picks(entry_id,polla_id,user_id,match_id,pick_1x2,home_score,away_score)
          VALUES(e.id,p.id,p_user_id,mid,x,hs,aws)
          ON CONFLICT(entry_id,match_id) DO UPDATE SET pick_1x2=EXCLUDED.pick_1x2,home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score
          RETURNING * INTO row;
      ELSE
        INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id,free_text)
          VALUES(e.id,p.id,p_user_id,qid,oid,txt)
          ON CONFLICT(entry_id,question_id) DO UPDATE SET option_id=EXCLUDED.option_id,free_text=EXCLUDED.free_text
          RETURNING * INTO row;
      END IF;
      results:=results||jsonb_build_array(jsonb_build_object('targetId',target,'status','saved','values',
        jsonb_build_object('pick1x2',row.pick_1x2,'homeScore',row.home_score,'awayScore',row.away_score,'optionId',row.option_id,'freeText',row.free_text,'pointsEarned',row.points_earned)));
      saved:=saved+1;
    EXCEPTION WHEN SQLSTATE '55000' THEN
      GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT,msg=MESSAGE_TEXT;
      IF hint IS DISTINCT FROM 'CASA_PICK_TARGET' THEN RAISE; END IF;
      results:=results||jsonb_build_array(jsonb_build_object('targetId',target,'status','rejected','error',msg));
      warnings:=warnings||jsonb_build_array(msg);
    END;
  END LOOP;
  answer:=jsonb_build_object('ok',true,'requestId',p_request_id,'revision',s.revision+1,'guardados',saved,'avisos',warnings,'results',results);
  UPDATE public.casa_pick_save_state SET revision=s.revision+1,last_request_id=p_request_id,last_input=input,last_result=answer WHERE entry_id=e.id;
  PERFORM set_config('app.casa_pick_request',coalesce(prior_marker,''),true);
  RETURN answer;
END $$;

REVOKE ALL ON FUNCTION public.casa_pick_revision_changed(),public.casa_pick_save_state_v1(uuid,uuid,uuid),
  public.casa_save_picks_v1(uuid,uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_pick_revision_changed(),public.casa_pick_save_state_v1(uuid,uuid,uuid),
  public.casa_save_picks_v1(uuid,uuid,uuid,uuid,bigint,jsonb) TO service_role;
