-- 068_admin_engagement_rpc.sql — Métricas de engagement del admin agregadas
-- EN SQL (no trayendo filas al server).
--
-- Por qué RPC: el endpoint original (Nivel 1) traía filas con supabase-js y
-- agregaba en JS, pero PostgREST topa el result set (~1000 filas) → subconteo
-- grave en tablas grandes como `predictions` (cazado en el test localhost:
-- mostraba 88 predictores y 799 pronósticos/7d cuando el real era 163 y 3159).
-- Agregar en SQL: una sola round-trip, sin transferir filas, sin tope, y
-- escala (free-tier intacto).
--
-- Devuelve el MISMO shape que consume components/admin/EngagementCard.tsx.

CREATE OR REPLACE FUNCTION public.admin_engagement()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH
reg AS (SELECT count(*) AS n FROM public.users),
onb AS (
  SELECT count(*) AS n FROM public.users
  WHERE avatar_url IS NOT NULL
    AND display_name IS NOT NULL
    AND btrim(display_name) <> ''
    AND NOT (display_name ~ '^[+]?[0-9]{8,15}$')
),
jp AS (SELECT count(DISTINCT user_id) AS n FROM public.polla_participants),
firstpred AS (
  SELECT user_id, min(submitted_at) AS first_at
  FROM public.predictions
  GROUP BY user_id
),
pred_users AS (SELECT count(*) AS n FROM firstpred),
p7  AS (SELECT count(*) AS c, count(DISTINCT user_id) AS u FROM public.predictions WHERE submitted_at >= now() - interval '7 days'),
p30 AS (SELECT count(*) AS c, count(DISTINCT user_id) AS u FROM public.predictions WHERE submitted_at >= now() - interval '30 days'),
series AS (
  SELECT to_char(d, 'YYYY-MM-DD') AS day,
    (SELECT count(*) FROM public.predictions pr
      WHERE (pr.submitted_at AT TIME ZONE 'America/Bogota')::date = d) AS preds
  FROM generate_series(
    (now() AT TIME ZONE 'America/Bogota')::date - 13,
    (now() AT TIME ZONE 'America/Bogota')::date,
    interval '1 day'
  ) AS d
),
act AS (
  SELECT
    count(*) FILTER (WHERE now() - u.created_at >= interval '1 day')  AS d1_den,
    count(*) FILTER (WHERE now() - u.created_at >= interval '1 day'  AND fp.first_at IS NOT NULL AND fp.first_at - u.created_at <= interval '1 day')  AS d1_num,
    count(*) FILTER (WHERE now() - u.created_at >= interval '7 days') AS d7_den,
    count(*) FILTER (WHERE now() - u.created_at >= interval '7 days' AND fp.first_at IS NOT NULL AND fp.first_at - u.created_at <= interval '7 days') AS d7_num,
    count(*) FILTER (WHERE now() - u.created_at >= interval '30 days') AS d30_den,
    count(*) FILTER (WHERE now() - u.created_at >= interval '30 days' AND fp.first_at IS NOT NULL AND fp.first_at - u.created_at <= interval '30 days') AS d30_num
  FROM public.users u
  LEFT JOIN firstpred fp ON fp.user_id = u.id
),
brk AS (
  SELECT count(*) AS n FROM public.bracket_predictions
  WHERE coalesce(path->'assignments', '{}'::jsonb) <> '{}'::jsonb
     OR coalesce(path->'winners', '{}'::jsonb) <> '{}'::jsonb
),
ppu AS (SELECT user_id, count(*) AS c FROM public.polla_participants GROUP BY user_id),
upp AS (SELECT polla_id, count(*) AS c FROM public.polla_participants GROUP BY polla_id)
SELECT jsonb_build_object(
  'funnel', jsonb_build_object(
    'registered', (SELECT n FROM reg),
    'onboarded',  (SELECT n FROM onb),
    'joinedPolla',(SELECT n FROM jp),
    'predicted',  (SELECT n FROM pred_users)
  ),
  'players', jsonb_build_object(
    'active7d',  (SELECT u FROM p7),
    'active30d', (SELECT u FROM p30),
    'preds7d',   (SELECT c FROM p7),
    'preds30d',  (SELECT c FROM p30),
    'predsPerActive30d', CASE WHEN (SELECT u FROM p30) > 0
      THEN round((SELECT c FROM p30)::numeric / (SELECT u FROM p30), 1) ELSE 0 END
  ),
  'predsSeries', coalesce((SELECT jsonb_agg(jsonb_build_object('day', day, 'preds', preds) ORDER BY day) FROM series), '[]'::jsonb),
  'activation', jsonb_build_object(
    'd1',  jsonb_build_object('num',(SELECT d1_num FROM act),'den',(SELECT d1_den FROM act),
           'pct', CASE WHEN (SELECT d1_den FROM act) > 0 THEN round((SELECT d1_num FROM act)::numeric * 100 / (SELECT d1_den FROM act), 1) ELSE 0 END),
    'd7',  jsonb_build_object('num',(SELECT d7_num FROM act),'den',(SELECT d7_den FROM act),
           'pct', CASE WHEN (SELECT d7_den FROM act) > 0 THEN round((SELECT d7_num FROM act)::numeric * 100 / (SELECT d7_den FROM act), 1) ELSE 0 END),
    'd30', jsonb_build_object('num',(SELECT d30_num FROM act),'den',(SELECT d30_den FROM act),
           'pct', CASE WHEN (SELECT d30_den FROM act) > 0 THEN round((SELECT d30_num FROM act)::numeric * 100 / (SELECT d30_den FROM act), 1) ELSE 0 END)
  ),
  'bracket', jsonb_build_object(
    'filled', (SELECT n FROM brk),
    'pctOfRegistered', CASE WHEN (SELECT n FROM reg) > 0 THEN round((SELECT n FROM brk)::numeric * 100 / (SELECT n FROM reg), 1) ELSE 0 END
  ),
  'distribution', jsonb_build_object(
    'pollasPerUser', jsonb_build_object('avg', coalesce(round((SELECT avg(c) FROM ppu), 1), 0), 'max', coalesce((SELECT max(c) FROM ppu), 0)),
    'participantsPerPolla', jsonb_build_object('avg', coalesce(round((SELECT avg(c) FROM upp), 1), 0), 'max', coalesce((SELECT max(c) FROM upp), 0))
  )
);
$$;

-- Solo el server (admin client = service_role) la llama; el endpoint ya valida
-- isCurrentUserAdmin() antes. REVOKE de PUBLIC primero (anon/authenticated
-- heredan), GRANT solo a service_role.
REVOKE EXECUTE ON FUNCTION public.admin_engagement() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_engagement() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_engagement() TO service_role;
