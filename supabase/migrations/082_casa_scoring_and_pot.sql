-- 082_casa_scoring_and_pot.sql
-- ============================================================================
-- Motor de puntaje, pozo y reparto de la polla centralizada.
--
-- Reglas (pedidas por el owner, 2026-08-24):
--   * 1X2      -> acertar local/empate/visitante = points_result (3 por defecto)
--   * marcador -> marcador exacto = points_exact (3);
--                 si no, acertar los goles de UN equipo = points_one_team (1)
--   * manual   -> acertar la opcion (o el texto) = casa_questions.points
--   * pozo     -> 70% para los ganadores, 30% para la casa (house_cut_pct)
--   * empate en puntos -> el pozo se reparte entre TODOS los que empataron
--
-- Regla #4 del repo: se puntua con el marcador de los 90 minutos. Un partido
-- solo cuenta cuando `matches.final_verified_at IS NOT NULL`; el alargue y los
-- penales no mueven un solo punto.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- casa_polla_pot — cuanto entro, cuanto va al pozo, cuanto se queda la casa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.casa_polla_pot(p_polla_id uuid)
RETURNS TABLE (
  paid_entries integer,
  gross_cop    bigint,
  prize_cop    bigint,
  house_cop    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*)::integer                                              AS paid_entries,
    COALESCE(SUM(e.amount_cop), 0)::bigint                         AS gross_cop,
    FLOOR(COALESCE(SUM(e.amount_cop), 0)
          * (100 - p.house_cut_pct) / 100.0)::bigint               AS prize_cop,
    (COALESCE(SUM(e.amount_cop), 0)
     - FLOOR(COALESCE(SUM(e.amount_cop), 0)
             * (100 - p.house_cut_pct) / 100.0))::bigint           AS house_cop
  FROM public.casa_pollas p
  LEFT JOIN public.casa_entries e
    ON e.polla_id = p.id AND e.status = 'pagada'
  WHERE p.id = p_polla_id
  GROUP BY p.house_cut_pct;
$$;

REVOKE EXECUTE ON FUNCTION public.casa_polla_pot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casa_polla_pot(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- casa_score_polla — recalcula points_earned de TODOS los picks de la polla.
-- Idempotente: se puede correr las veces que haga falta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.casa_score_polla(p_polla_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_polla   public.casa_pollas%ROWTYPE;
  v_touched integer := 0;
  v_rows    integer := 0;
BEGIN
  SELECT * INTO v_polla FROM public.casa_pollas WHERE id = p_polla_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'casa_score_polla: no existe la polla %', p_polla_id;
  END IF;

  -- ---- picks de partidos -------------------------------------------------
  UPDATE public.casa_picks pk
  SET points_earned = sub.pts
  FROM (
    SELECT
      pk2.id,
      CASE
        -- Sin verificar el 90' todavia: no se puntua nada.
        WHEN m.final_verified_at IS NULL
          OR m.home_score IS NULL
          OR m.away_score IS NULL THEN 0

        WHEN v_polla.scoring_mode = '1x2' THEN
          CASE WHEN pk2.pick_1x2 IS NOT NULL AND pk2.pick_1x2 = (
                 CASE WHEN m.home_score > m.away_score THEN 'L'
                      WHEN m.home_score < m.away_score THEN 'V'
                      ELSE 'E' END)
               THEN v_polla.points_result
               ELSE 0 END

        WHEN v_polla.scoring_mode = 'marcador' THEN
          CASE
            WHEN pk2.home_score IS NULL OR pk2.away_score IS NULL THEN 0
            WHEN pk2.home_score = m.home_score
             AND pk2.away_score = m.away_score THEN v_polla.points_exact
            WHEN pk2.home_score = m.home_score
              OR pk2.away_score = m.away_score THEN v_polla.points_one_team
            ELSE 0
          END

        ELSE 0
      END AS pts
    FROM public.casa_picks pk2
    JOIN public.matches m ON m.id = pk2.match_id
    WHERE pk2.polla_id = p_polla_id AND pk2.match_id IS NOT NULL
  ) sub
  WHERE pk.id = sub.id AND pk.points_earned IS DISTINCT FROM sub.pts;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_touched := v_touched + v_rows;

  -- ---- picks de preguntas manuales ---------------------------------------
  UPDATE public.casa_picks pk
  SET points_earned = sub.pts
  FROM (
    SELECT
      pk2.id,
      CASE
        WHEN q.resolved_at IS NULL THEN 0
        WHEN q.input_kind = 'opciones'
             AND q.resolved_option_id IS NOT NULL
             AND pk2.option_id = q.resolved_option_id THEN q.points
        WHEN q.input_kind = 'texto'
             AND q.resolved_text IS NOT NULL
             AND pk2.free_text IS NOT NULL
             AND lower(btrim(pk2.free_text)) = lower(btrim(q.resolved_text)) THEN q.points
        ELSE 0
      END AS pts
    FROM public.casa_picks pk2
    JOIN public.casa_questions q ON q.id = pk2.question_id
    WHERE pk2.polla_id = p_polla_id AND pk2.question_id IS NOT NULL
  ) sub
  WHERE pk.id = sub.id AND pk.points_earned IS DISTINCT FROM sub.pts;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_touched := v_touched + v_rows;

  RETURN v_touched;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.casa_score_polla(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casa_score_polla(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- casa_leaderboard — la tabla de la polla. Empates comparten puesto (RANK()).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.casa_leaderboard(p_polla_id uuid)
RETURNS TABLE (
  entry_id     uuid,
  user_id      uuid,
  display_name text,
  avatar_url   text,
  points       integer,
  aciertos     integer,
  puesto       integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id,
    e.user_id,
    u.display_name,
    u.avatar_url,
    COALESCE(SUM(pk.points_earned), 0)::integer                       AS points,
    COALESCE(SUM((pk.points_earned > 0)::integer), 0)::integer        AS aciertos,
    RANK() OVER (ORDER BY COALESCE(SUM(pk.points_earned), 0) DESC)::integer AS puesto
  FROM public.casa_entries e
  JOIN public.users u ON u.id = e.user_id
  LEFT JOIN public.casa_picks pk ON pk.entry_id = e.id
  WHERE e.polla_id = p_polla_id AND e.status = 'pagada'
  GROUP BY e.id, e.user_id, u.display_name, u.avatar_url
  ORDER BY points DESC, u.display_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.casa_leaderboard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casa_leaderboard(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- casa_pick_distribution — "cuantos pusieron 2-1" / "cuantos pusieron a Morelos"
-- Devuelve un json por partido y por pregunta con el conteo de cada opcion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.casa_pick_distribution(p_polla_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT pk.*
    FROM public.casa_picks pk
    JOIN public.casa_entries e ON e.id = pk.entry_id AND e.status = 'pagada'
    WHERE pk.polla_id = p_polla_id
  ),
  por_1x2 AS (
    SELECT match_id,
           jsonb_object_agg(pick_1x2, n) AS conteo,
           SUM(n)::integer               AS total
    FROM (
      SELECT match_id, pick_1x2, COUNT(*)::integer AS n
      FROM scoped WHERE match_id IS NOT NULL AND pick_1x2 IS NOT NULL
      GROUP BY match_id, pick_1x2
    ) t GROUP BY match_id
  ),
  por_marcador AS (
    SELECT match_id,
           jsonb_object_agg(marcador, n) AS conteo,
           SUM(n)::integer               AS total
    FROM (
      SELECT match_id,
             home_score || '-' || away_score AS marcador,
             COUNT(*)::integer AS n
      FROM scoped
      WHERE match_id IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL
      GROUP BY match_id, home_score, away_score
    ) t GROUP BY match_id
  ),
  por_pregunta AS (
    SELECT question_id,
           jsonb_object_agg(clave, n) AS conteo,
           SUM(n)::integer            AS total
    FROM (
      SELECT question_id,
             COALESCE(option_id::text, lower(btrim(free_text))) AS clave,
             COUNT(*)::integer AS n
      FROM scoped
      WHERE question_id IS NOT NULL
        AND (option_id IS NOT NULL OR btrim(COALESCE(free_text, '')) <> '')
      GROUP BY question_id, clave
    ) t GROUP BY question_id
  )
  SELECT jsonb_build_object(
    'resultado', COALESCE((SELECT jsonb_object_agg(match_id::text,
                    jsonb_build_object('conteo', conteo, 'total', total)) FROM por_1x2), '{}'::jsonb),
    'marcador',  COALESCE((SELECT jsonb_object_agg(match_id::text,
                    jsonb_build_object('conteo', conteo, 'total', total)) FROM por_marcador), '{}'::jsonb),
    'preguntas', COALESCE((SELECT jsonb_object_agg(question_id::text,
                    jsonb_build_object('conteo', conteo, 'total', total)) FROM por_pregunta), '{}'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.casa_pick_distribution(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casa_pick_distribution(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- casa_settle_polla — cierra la polla y reparte.
--   * partidos/manual: ganan los del puntaje mas alto; si empatan, el pozo se
--     divide en partes iguales entre TODOS los que empataron.
--   * rifa: gana la boleta cuyo numero salio (drawn_number).
-- Idempotente: reescribe casa_payouts desde cero cada vez que corre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.casa_settle_polla(p_polla_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_polla     public.casa_pollas%ROWTYPE;
  v_prize     bigint;
  v_winners   integer := 0;
  v_each      bigint  := 0;
  v_top       integer;
  v_remainder bigint  := 0;
BEGIN
  SELECT * INTO v_polla FROM public.casa_pollas WHERE id = p_polla_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'casa_settle_polla: no existe la polla %', p_polla_id;
  END IF;

  SELECT prize_cop INTO v_prize FROM public.casa_polla_pot(p_polla_id);
  v_prize := COALESCE(v_prize, 0);

  -- Reparto anterior fuera (solo filas de ESTA polla, generadas por esta misma
  -- funcion — nunca datos que haya escrito una persona).
  DELETE FROM public.casa_payouts WHERE polla_id = p_polla_id;

  IF v_polla.kind = 'rifa' THEN
    IF v_polla.drawn_number IS NULL THEN
      RAISE EXCEPTION 'casa_settle_polla: la rifa % todavia no tiene numero ganador', p_polla_id;
    END IF;

    INSERT INTO public.casa_payouts (polla_id, user_id, place, points, amount_cop, note)
    SELECT p_polla_id, e.user_id, 1, NULL, v_prize,
           'Boleta ' || e.ticket_number || ' — ' || v_polla.draw_method
    FROM public.casa_entries e
    WHERE e.polla_id = p_polla_id
      AND e.status = 'pagada'
      AND e.ticket_number = v_polla.drawn_number;

    GET DIAGNOSTICS v_winners = ROW_COUNT;
    v_each := CASE WHEN v_winners > 0 THEN v_prize ELSE 0 END;

  ELSE
    PERFORM public.casa_score_polla(p_polla_id);

    SELECT MAX(points) INTO v_top FROM public.casa_leaderboard(p_polla_id);

    IF v_top IS NULL THEN
      v_top := 0;
    END IF;

    SELECT COUNT(*) INTO v_winners
    FROM public.casa_leaderboard(p_polla_id) WHERE points = v_top;

    IF v_winners > 0 THEN
      v_each      := FLOOR(v_prize / v_winners);
      v_remainder := v_prize - (v_each * v_winners);

      INSERT INTO public.casa_payouts (polla_id, user_id, place, points, amount_cop, note)
      SELECT p_polla_id, lb.user_id, 1, lb.points, v_each,
             CASE WHEN v_winners > 1
                  THEN 'Empate en ' || v_top || ' pts — pozo dividido entre ' || v_winners
                  ELSE NULL END
      FROM public.casa_leaderboard(p_polla_id) lb
      WHERE lb.points = v_top;
    END IF;
  END IF;

  UPDATE public.casa_pollas
  SET status      = 'resuelta',
      settled_at  = now(),
      settle_notes = COALESCE(settle_notes, '')
        || CASE WHEN v_remainder > 0
                THEN ' [sobrante por redondeo: $' || v_remainder || ' queda en la casa]'
                ELSE '' END
  WHERE id = p_polla_id;

  RETURN jsonb_build_object(
    'polla_id',  p_polla_id,
    'kind',      v_polla.kind,
    'prize_cop', v_prize,
    'winners',   v_winners,
    'each_cop',  v_each,
    'remainder', v_remainder,
    'top_points', v_top
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.casa_settle_polla(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casa_settle_polla(uuid) TO service_role;
