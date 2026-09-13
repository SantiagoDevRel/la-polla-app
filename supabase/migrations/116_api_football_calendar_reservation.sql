-- 116: reserva atómica de cuota para el calendario de API-Football.
--
-- Hasta acá `lib/api-football/calendar.ts` solo LEÍA `requests_used` antes de
-- pedir /fixtures?league=&season= o /leagues?current=true y nunca lo
-- incrementaba: dos corridas simultáneas (cron + «Actualizar calendario») veían
-- el mismo contador, y el conteo quedaba corto hasta la conciliación con
-- /status. Esta función reserva UNA solicitud dentro del mismo candado de fila
-- que usan las reservas de vivo, detalle y equipos (092/094/095):
--
-- - Plan pagado con el mismo predicado de 094: plan distinto de Free, vigente
--   y verificado contra /status en la última hora.
-- - Tope global diario 7.000 (UTC), el mismo de `reserve_api_football_request`:
--   detalle y equipos paran en 6.000 justamente para dejar esa franja a
--   calendario, vivo y resultados (comentario de 094).
-- - Sub-tope de calendario: 300 solicitudes por día UTC. La operación normal
--   son ~10 ligas cada seis horas más algunos refrescos del administrador.
-- - Intervalo mínimo por liga: 10 minutos para /fixtures (la reserva de
--   `reserve_tournament_schedule_sync` ya espacia 15 por torneo) y 1 hora para
--   /leagues, que es UNA llamada para todas las ligas (league_id = 0).
-- - La reserva cuenta aunque la solicitud HTTP falle, igual que en 092. Sin
--   reintentos por fuera del contador.
--
-- Solo agrega columnas y una tabla de servicio. No cambia partidos,
-- pronósticos, usuarios ni datos de Casa.

ALTER TABLE public.api_football_budget
  ADD COLUMN IF NOT EXISTS calendar_requests_used integer NOT NULL DEFAULT 0
    CHECK (calendar_requests_used >= 0),
  ADD COLUMN IF NOT EXISTS calendar_day date;

CREATE TABLE IF NOT EXISTS public.api_football_calendar_reservations (
  league_id integer NOT NULL,
  kind text NOT NULL,
  reserved_at timestamptz NOT NULL,
  PRIMARY KEY (league_id, kind),
  -- /fixtures es por liga; /leagues?current=true cubre todas y usa la liga 0.
  CONSTRAINT api_football_calendar_reservations_kind CHECK (
    (kind = 'fixtures' AND league_id > 0) OR (kind = 'leagues' AND league_id = 0)
  )
);

-- Tabla de servicio: RLS con deny-all explícito; solo service_role (que salta RLS).
ALTER TABLE public.api_football_calendar_reservations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'api_football_calendar_reservations'
       AND policyname = 'service_only'
  ) THEN
    CREATE POLICY service_only ON public.api_football_calendar_reservations
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;
REVOKE ALL ON TABLE public.api_football_calendar_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.api_football_calendar_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_api_football_calendar(p_league_id integer, p_kind text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz;
  d date;
  b public.api_football_budget%ROWTYPE;
  league integer;
  gap interval;
  used integer;
  calendar_used integer;
BEGIN
  IF p_kind = 'fixtures' AND p_league_id > 0 THEN
    league := p_league_id;
    gap := interval '10 minutes';
  ELSIF p_kind = 'leagues' AND COALESCE(p_league_id, 0) = 0 THEN
    league := 0;
    gap := interval '1 hour';
  ELSE
    RAISE EXCEPTION 'Invalid calendar reservation';
  END IF;

  -- Mismo candado que las demás reservas: serializa contador, sub-tope e intervalo.
  SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- El reloj se toma DESPUÉS del candado: una espera no deja una marca vieja.
  t := clock_timestamp();
  d := (t AT TIME ZONE 'UTC')::date;

  IF b.plan = 'Free' OR b.plan_expires_at IS NULL OR b.plan_expires_at <= t
     OR b.plan_checked_at IS NULL OR b.plan_checked_at < t - interval '1 hour' THEN
    RETURN false;
  END IF;

  used := CASE WHEN b.request_day = d THEN b.requests_used ELSE 0 END;
  calendar_used := CASE WHEN b.calendar_day = d THEN b.calendar_requests_used ELSE 0 END;
  IF used >= 7000 OR calendar_used >= 300 THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.api_football_calendar_reservations
     WHERE league_id = league AND kind = p_kind AND reserved_at > t - gap
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.api_football_calendar_reservations(league_id, kind, reserved_at)
  VALUES (league, p_kind, t)
  ON CONFLICT (league_id, kind) DO UPDATE SET reserved_at = EXCLUDED.reserved_at;

  UPDATE public.api_football_budget
     SET request_day = d, requests_used = used + 1,
         calendar_day = d, calendar_requests_used = calendar_used + 1,
         last_attempt_at = t
   WHERE singleton;
  RETURN true;
END;
$$;

-- Supabase otorga EXECUTE a anon/authenticated por defecto: se revoca explícito.
REVOKE ALL ON FUNCTION public.reserve_api_football_calendar(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_football_calendar(integer, text) TO service_role;

-- (2026-09-13) La ficha de equipo hace 4 solicitudes (095) pero la reserva
-- sumaba 2: el contador local subestimaba el gasto real y el tope de 6.000
-- dejaba menos margen del que parecía para vivo y resultados. Mismo cuerpo que
-- 095 en producción, solo cambia el incremento a +4.
CREATE OR REPLACE FUNCTION public.reserve_api_football_team(p_team_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t timestamptz:=clock_timestamp(); d date:=(t AT TIME ZONE 'UTC')::date; b public.api_football_budget%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
 IF NOT FOUND OR b.plan='Free' OR b.plan_expires_at IS NULL OR b.plan_expires_at<=t
  OR b.plan_checked_at IS NULL OR b.plan_checked_at<t-interval '1 hour' THEN RETURN false; END IF;
 IF b.request_day<>d THEN b.requests_used:=0; END IF;
 IF b.requests_used+4>6000 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM (
  SELECT fixtures FROM public.api_football_cache WHERE fixture_date BETWEEN d-7 AND d+7
  UNION ALL SELECT matches FROM public.api_football_teams WHERE fetched_at>t-interval '2 days'
 ) c CROSS JOIN LATERAL jsonb_array_elements(c.fixtures) f
 WHERE f->'teams'->'home'->>'id'=p_team_id::text OR f->'teams'->'away'->>'id'=p_team_id::text) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.api_football_teams WHERE team_id=p_team_id AND last_attempt_at>t-interval '1 hour') THEN RETURN false; END IF;
 INSERT INTO public.api_football_teams(team_id,last_attempt_at) VALUES(p_team_id,t)
 ON CONFLICT(team_id) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at;
 UPDATE public.api_football_budget SET request_day=d,requests_used=b.requests_used+4,last_attempt_at=t WHERE singleton;
 RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_api_football_team(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_football_team(bigint) TO service_role;
