-- New upload generation for an existing draw request. Winner and metadata stay
-- fixed; the superseded evidence remains private and auditable forever.
CREATE FUNCTION public.casa_retry_draw_upload_v2(p_attempt_id uuid,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.casa_draw_confirmation_attempts; d public.casa_object_draws; n uuid:=gen_random_uuid();
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO a FROM public.casa_draw_confirmation_attempts WHERE id=p_attempt_id AND actor_id=p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE id=a.draw_id;
  PERFORM public.casa_v2_lock_polla(d.polla_id,true);
  IF NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING'; END IF;
  SELECT * INTO a FROM public.casa_draw_confirmation_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF a.state='confirmed' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_RESOLVED'; END IF;
  IF a.superseded_by IS NOT NULL THEN
    SELECT * INTO a FROM public.casa_draw_confirmation_attempts WHERE request_id=a.request_id AND superseded_by IS NULL;
  ELSE
    -- Deferred self-FK permits advancing the pointer before the new row exists.
    SET CONSTRAINTS casa_draw_confirmation_attempts_superseded_by_fkey DEFERRED;
    UPDATE public.casa_draw_confirmation_attempts SET superseded_by=n WHERE id=a.id;
    INSERT INTO public.casa_draw_confirmation_attempts(id,draw_id,request_id,winner_id,actor_id,evidence_path,content_type,content_bytes,content_sha256)
      VALUES(n,a.draw_id,a.request_id,a.winner_id,a.actor_id,'draws/'||a.draw_id||'/'||n||'.'||
        CASE a.content_type WHEN 'video/webm' THEN 'webm' WHEN 'video/quicktime' THEN 'mov' ELSE 'mp4' END,
        a.content_type,a.content_bytes,a.content_sha256) RETURNING * INTO a;
  END IF;
  RETURN jsonb_build_object('attempt_id',a.id,'evidence_path',a.evidence_path,'state',a.state);
END $$;
REVOKE ALL ON FUNCTION public.casa_retry_draw_upload_v2(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_retry_draw_upload_v2(uuid,uuid,integer) TO service_role;

-- Preserve the old signature and its legacy body. Acquire the barrier BEFORE
-- taking a parent lock or scoring. Paused/v2 callers fail before any effects.
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.casa_settle_polla(uuid)'::regprocedure) INTO definition;
  needle := 'BEGIN
  SELECT id, kind, status, archived_at, drawn_number, draw_method';
  replacement := 'BEGIN
  PERFORM 1 FROM public.casa_operation_control WHERE singleton FOR SHARE;
  IF (SELECT mode FROM public.casa_operation_control WHERE singleton)=''paused'' THEN
    RAISE EXCEPTION USING ERRCODE=''55000'',MESSAGE=''OPERATIONS_PAUSED'';
  ELSIF (SELECT mode FROM public.casa_operation_control WHERE singleton)<>''legacy'' THEN
    RAISE EXCEPTION USING ERRCODE=''55000'',MESSAGE=''UPDATE_REQUIRED'';
  END IF;
  SELECT id, kind, status, archived_at, drawn_number, draw_method';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Legacy settlement differs from migration 096; inspect before applying'; END IF;
  EXECUTE replace(definition,needle,replacement);
END $$;
-- Recovery is based on server state and DB time, including a reservation whose
-- pool closed after begin. It never opens a new registration window.
CREATE FUNCTION public.casa_active_proofs_v2(p_polla_id uuid,p_user_id uuid)
RETURNS TABLE(entry_id uuid,ticket_number integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT e.id,e.ticket_number FROM public.casa_entries e
    JOIN public.casa_pollas p ON p.id=e.polla_id
    JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id AND a.entry_id=e.id
  WHERE e.polla_id=p_polla_id AND e.user_id=p_user_id AND e.status='pendiente' AND e.proof_path IS NULL
    AND a.state='uploading' AND a.expires_at>clock_timestamp()
    AND p.status IN ('abierta','cerrada') AND p.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws d WHERE d.polla_id=p.id AND d.state='pending');
$$;
REVOKE ALL ON FUNCTION public.casa_active_proofs_v2(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_active_proofs_v2(uuid,uuid) TO service_role;
