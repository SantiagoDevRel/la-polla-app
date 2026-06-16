-- 070_polla_standings_history.sql
-- RPC para el "bump chart" / carrera de posiciones (feature 2026-06-16,
-- idea de Pipe). Reconstruye la evolución de las posiciones de una polla
-- agrupada por DÍA calendario (zona America/Bogota) — una columna por día
-- con partidos verificados.
--
-- Decisiones:
--  - Eje por DÍA, no por partido ni por jornada (decisión Santiago).
--  - Solo días con `matches.final_verified_at IS NOT NULL` (puntos sellados;
--    points_earned=0 antes de verificar es ambiguo — ver CLAUDE.md).
--  - Agregación 100% en SQL (no en supabase-js) para no chocar con el cap
--    de ~1000 filas de PostgREST en pollas grandes (ver memoria
--    postgrest-row-cap-admin-aggregates). Devuelve UN json, no N filas.
--  - El scope (full/group_stage/knockouts/custom) se resuelve en el endpoint
--    (reusa resolvePollaMatchIds) y se pasa como p_match_ids — el RPC no
--    re-implementa esa lógica.
--  - SECURITY DEFINER + search_path fijo. GRANT solo a service_role: el
--    endpoint lo llama con admin client tras validar que el caller es
--    participante. authenticated NO puede llamarlo directo (evita leak de
--    standings de pollas ajenas).
--
-- Devuelve: { "days": [date...], "racers": [{ "user_id": uuid, "cum": [int...] }] }
-- Los arrays `cum` están alineados al orden ascendente de `days`. El cliente
-- computa el rank por día desde `cum` (mismo RANK() de competencia, empates
-- comparten puesto) — single source para la lógica de posiciones.

CREATE OR REPLACE FUNCTION public.get_polla_standings_history(
  p_polla_id uuid,
  p_match_ids uuid[]
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH verified AS (
    -- Partidos de la polla con puntos ya sellados, con su día local.
    SELECT
      m.id,
      (m.final_verified_at AT TIME ZONE 'America/Bogota')::date AS day
    FROM public.matches m
    WHERE m.id = ANY(p_match_ids)
      AND m.final_verified_at IS NOT NULL
  ),
  days AS (
    SELECT DISTINCT day FROM verified
  ),
  parts AS (
    -- Mismos participantes que el leaderboard vivo: aprobados y pagados
    -- (en pay_winner `paid` es true por default).
    SELECT pp.user_id
    FROM public.polla_participants pp
    WHERE pp.polla_id = p_polla_id
      AND pp.status = 'approved'
      AND pp.paid = true
  ),
  pts AS (
    -- Puntos por (usuario, día) dentro de la polla.
    SELECT pr.user_id, v.day, pr.points_earned
    FROM public.predictions pr
    JOIN verified v ON v.id = pr.match_id
    WHERE pr.polla_id = p_polla_id
  ),
  per_day AS (
    -- Cada participante × cada día → puntos ganados ESE día (0 si no jugó/
    -- no acertó). El CROSS JOIN garantiza una entrada por día para todos.
    SELECT
      p.user_id,
      d.day,
      COALESCE(SUM(x.points_earned), 0)::int AS day_points
    FROM parts p
    CROSS JOIN days d
    LEFT JOIN pts x ON x.user_id = p.user_id AND x.day = d.day
    GROUP BY p.user_id, d.day
  ),
  cum AS (
    -- Acumulado al cierre de cada día.
    SELECT
      user_id,
      day,
      SUM(day_points) OVER (
        PARTITION BY user_id
        ORDER BY day
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::int AS cum_points
    FROM per_day
  )
  SELECT json_build_object(
    'days', COALESCE((SELECT json_agg(day ORDER BY day) FROM days), '[]'::json),
    'racers', COALESCE((
      SELECT json_agg(json_build_object(
        'user_id', c.user_id,
        'cum', c.cum_arr
      ))
      FROM (
        SELECT user_id, json_agg(cum_points ORDER BY day) AS cum_arr
        FROM cum
        GROUP BY user_id
      ) c
    ), '[]'::json)
  );
$$;

-- Least privilege: solo service_role (el endpoint usa admin client tras
-- validar al caller). authenticated/anon NO lo necesitan.
-- OJO: Supabase auto-otorga EXECUTE a anon/authenticated por default
-- privileges en funciones nuevas de public, así que el REVOKE FROM PUBLIC
-- NO alcanza — hay que revocar explícito a anon y authenticated (si no,
-- el Security Advisor marca anon_security_definer_function_executable).
REVOKE EXECUTE ON FUNCTION public.get_polla_standings_history(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_polla_standings_history(uuid, uuid[]) TO service_role;
