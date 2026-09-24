-- 150 — Resultado de un premio en objeto apenas termina su último partido.
-- Solo lectura: no reparte, no puntúa, no modifica inscripciones ni pronósticos.
-- Las verificaciones ya puntúan por trigger, en la misma transacción (086/100).
-- Mismos bloqueos del reparto y desempate por registro de la migración 142.
CREATE OR REPLACE FUNCTION public.casa_object_result_v1(p_polla_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; v_total integer; v_pending integer; v_winner record; v_tied integer;
BEGIN
  SELECT * INTO p FROM public.casa_pollas
   WHERE id=p_polla_id AND archived_at IS NULL AND prize_kind='objeto'
     AND kind IN ('partidos','manual') AND status IN ('abierta','cerrada','resuelta')
     AND publication_mode<>'oculta' AND opens_at<=now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p.status='resuelta' THEN RETURN jsonb_build_object('state','settled'); END IF;

  IF p.kind='partidos' THEN
    SELECT count(*),count(*) FILTER (WHERE m.final_verified_at IS NULL AND pm.voided_at IS NULL)
      INTO v_total,v_pending FROM public.casa_polla_matches pm JOIN public.matches m ON m.id=pm.match_id
     WHERE pm.polla_id=p.id;
  ELSE
    SELECT count(*),count(*) FILTER (WHERE resolved_at IS NULL) INTO v_total,v_pending
      FROM public.casa_questions WHERE polla_id=p.id;
  END IF;
  IF v_total=0 OR v_pending>0 OR (p.status<>'cerrada' AND p.closes_at>now())
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id)
    OR EXISTS(SELECT 1 FROM public.casa_match_issues mi JOIN public.casa_polla_matches pm ON pm.match_id=mi.match_id
       WHERE pm.polla_id=p.id AND pm.voided_at IS NULL AND mi.decision IS NULL)
    OR EXISTS(SELECT 1 FROM public.casa_entries e LEFT JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id
       WHERE e.polla_id=p.id AND e.status='pendiente'
         AND (e.proof_path IS NOT NULL OR (a.state='uploading' AND a.expires_at>now())))
    OR NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id AND status='pagada')
    OR nullif(btrim(p.prize_object),'') IS NULL THEN
    RETURN jsonb_build_object('state','waiting');
  END IF;

  -- El UUID estable solo desempata registros con el mismo microsegundo,
  -- exactamente como casa_settle_polla_v2 (142); nunca orden alfabético.
  SELECT lb.*,e.created_at AS registered_at INTO v_winner
    FROM public.casa_leaderboard(p.id) lb JOIN public.casa_entries e ON e.id=lb.entry_id
   ORDER BY lb.points DESC,e.created_at,e.entry_number NULLS LAST,e.id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','waiting'); END IF;
  IF v_winner.points=0 THEN RETURN jsonb_build_object('state','no_winner'); END IF;
  IF v_winner.points<0 THEN RETURN jsonb_build_object('state','waiting'); END IF;
  SELECT count(DISTINCT user_id) INTO v_tied FROM public.casa_leaderboard(p.id) WHERE points=v_winner.points;
  RETURN jsonb_build_object('state','ready','tied',v_tied>1,'winner',jsonb_build_object(
    'user_id',v_winner.user_id,'entry_id',v_winner.entry_id,'display_name',v_winner.display_name,
    'avatar_url',v_winner.avatar_url,'points',v_winner.points,'registered_at',v_winner.registered_at));
END $$;

-- La ruta exige sesión antes de este RPC; nunca accesible desde el navegador.
REVOKE ALL ON FUNCTION public.casa_object_result_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_object_result_v1(uuid) TO service_role;
