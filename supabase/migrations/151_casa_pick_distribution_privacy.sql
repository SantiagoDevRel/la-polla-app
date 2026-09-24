-- Other participants' choices stay private while the target accepts changes.
-- Based on the live definition read on 2026-09-24 (082 + 106).
-- Matches still require real kickoff (stricter
-- than their five-minute write lock). Manual questions require their own lock.
-- Only reads existing rows; never changes predictions, picks or points.
CREATE OR REPLACE FUNCTION public.casa_pick_distribution(p_polla_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH scoped AS (
    SELECT pk.match_id,pk.question_id,pk.pick_1x2,pk.home_score,pk.away_score,pk.option_id,pk.free_text
    FROM public.casa_picks pk
    JOIN public.casa_entries e ON e.id=pk.entry_id AND e.status='pagada'
    WHERE pk.polla_id=p_polla_id
      AND (pk.match_id IS NULL OR EXISTS(
        SELECT 1 FROM public.matches visible
        LEFT JOIN public.casa_polla_matches scope ON scope.match_id=visible.id AND scope.polla_id=p_polla_id
        WHERE visible.id=pk.match_id AND (scope.voided_at IS NOT NULL OR
          (visible.scheduled_at<=clock_timestamp()
            AND (visible.status IN ('live','finished') OR (visible.status='cancelled' AND visible.elapsed>0))
            AND (visible.elapsed>0 OR upper(coalesce(visible.live_status_detail,'')) NOT IN
              ('STATUS_SUSPENDED','SUSPENDED','SUSP','STATUS_INTERRUPTED','INTERRUPTED','INT'))))))
      AND (pk.question_id IS NULL OR EXISTS(
        SELECT 1 FROM public.casa_questions question
        JOIN public.casa_pollas pool ON pool.id=question.polla_id
        WHERE question.id=pk.question_id AND question.polla_id=p_polla_id
          AND pool.status IN ('abierta','cerrada','resuelta')
          AND (pool.status<>'abierta' OR pool.closes_at<=clock_timestamp() OR question.resolved_at IS NOT NULL)))
  ),
  por_1x2 AS (
    SELECT match_id,jsonb_object_agg(pick_1x2,n) AS conteo,SUM(n)::integer AS total
    FROM (
      SELECT match_id,pick_1x2,COUNT(*)::integer AS n FROM scoped
      WHERE match_id IS NOT NULL AND pick_1x2 IS NOT NULL GROUP BY match_id,pick_1x2
    ) t GROUP BY match_id
  ),
  por_marcador AS (
    SELECT match_id,jsonb_object_agg(marcador,n) AS conteo,SUM(n)::integer AS total
    FROM (
      SELECT match_id,home_score||'-'||away_score AS marcador,COUNT(*)::integer AS n FROM scoped
      WHERE match_id IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL
      GROUP BY match_id,home_score,away_score
    ) t GROUP BY match_id
  ),
  por_pregunta AS (
    SELECT question_id,jsonb_object_agg(clave,n) AS conteo,SUM(n)::integer AS total
    FROM (
      SELECT question_id,COALESCE(option_id::text,lower(btrim(free_text))) AS clave,COUNT(*)::integer AS n
      FROM scoped WHERE question_id IS NOT NULL AND (option_id IS NOT NULL OR btrim(COALESCE(free_text,''))<>'')
      GROUP BY question_id,clave
    ) t GROUP BY question_id
  )
  SELECT jsonb_build_object(
    'resultado',COALESCE((SELECT jsonb_object_agg(match_id::text,jsonb_build_object('conteo',conteo,'total',total)) FROM por_1x2),'{}'::jsonb),
    'marcador',COALESCE((SELECT jsonb_object_agg(match_id::text,jsonb_build_object('conteo',conteo,'total',total)) FROM por_marcador),'{}'::jsonb),
    'preguntas',COALESCE((SELECT jsonb_object_agg(question_id::text,jsonb_build_object('conteo',conteo,'total',total)) FROM por_pregunta),'{}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.casa_pick_distribution(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_pick_distribution(uuid) TO service_role;
