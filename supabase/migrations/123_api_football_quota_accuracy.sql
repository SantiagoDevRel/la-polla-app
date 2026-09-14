-- 123: cuota de API-Football fiel al proveedor + freno a cierres atascados.
--
-- 1) Contador. `record_api_football_account` (094) guardaba
--    GREATEST(contador local, /status). Si /status llegaba viejo (account.ts
--    lo pedía con `next.revalidate`, que en Next 16 sirve la copia anterior
--    mientras revalida) justo después del cambio de día UTC, el día nuevo
--    arrancaba con el conteo final del anterior y GREATEST nunca lo bajaba.
--    Medido el 2026-09-13: interno 1.996 contra 863 del proveedor (+1.133), y
--    el 2026-09-14 a las 02:40 UTC ya iba en 1.192. Los topes propios (6.000 y
--    7.000) se activaban miles de consultas antes de tiempo.
--
--    Nueva sobrecarga con `p_read_at` (el instante en que se pidió /status,
--    sin caché): requests_used = valor del proveedor + reservas locales hechas
--    DESPUÉS de esa lectura. Sin GREATEST: el proveedor es quien aplica el
--    límite real, así que el día nuevo queda en su valor. Una lectura más
--    vieja que la última registrada, o de hace más de 50 s, no toca el
--    contador (solo el plan). La reserva atómica antes de cada llamada no
--    cambia: nada se gasta por fuera del contador.
--
--    Las reservas posteriores se cuentan con las marcas que solo escriben las
--    funciones reserve_* (092/094/095/116): cache (+1), detalle (+1), equipo
--    (+4, igual que 116) y calendario (+1). Cada clave tiene un intervalo
--    mínimo de 60 s o más, así que en una ventana de 50 s cada clave aparece a
--    lo sumo una vez. `calendar_requests_used` no se toca (116 ya lo lleva).
--    La firma vieja de 4 argumentos queda igual para el código ya desplegado.
--
-- 2) Cierres atascados. Un partido de polla que no se logra confirmar hacía
--    que verify-final pidiera el feed de su fecha cada minuto (~940/día).
--    `api_football_verify_attempts` cuenta los intentos por partido y
--    `note_api_football_verify_attempts` los suma y reclama el aviso al admin
--    una sola vez. La cadencia (espaciar a 15 min tras 5 intentos) vive en
--    lib/matches/verify-final.ts.
--
-- No cambia partidos, pronósticos, usuarios ni datos de Casa.

ALTER TABLE public.api_football_budget
  ADD COLUMN IF NOT EXISTS provider_requests_used integer CHECK (provider_requests_used >= 0),
  ADD COLUMN IF NOT EXISTS provider_read_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_api_football_account(
  p_plan text, p_expires timestamptz, p_used integer, p_limit integer, p_read_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t timestamptz;
  d date;
  b public.api_football_budget%ROWTYPE;
  later integer;
BEGIN
  IF p_used IS NULL OR p_limit IS NULL OR p_used < 0 OR p_limit < 0 THEN
    RAISE EXCEPTION 'Invalid account quota';
  END IF;
  IF p_read_at IS NULL OR p_read_at > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'Invalid account read time';
  END IF;

  INSERT INTO public.api_football_budget(singleton, request_day, last_attempt_at)
  VALUES (true, (clock_timestamp() AT TIME ZONE 'UTC')::date, '-infinity')
  ON CONFLICT DO NOTHING;
  -- Mismo candado que las reservas: ninguna se cuela entre el conteo y la escritura.
  SELECT * INTO b FROM public.api_football_budget WHERE singleton FOR UPDATE;
  t := clock_timestamp();
  d := (t AT TIME ZONE 'UTC')::date;

  UPDATE public.api_football_budget SET
    plan = CASE WHEN p_limit >= 7500 AND p_expires > t THEN p_plan ELSE 'Free' END,
    plan_expires_at = p_expires,
    plan_checked_at = t
  WHERE singleton;

  -- Lectura vieja o fuera de orden: no es evidencia del conteo actual.
  IF p_read_at < t - interval '50 seconds'
     OR (b.provider_read_at IS NOT NULL AND p_read_at <= b.provider_read_at) THEN
    RETURN;
  END IF;

  SELECT
      (SELECT count(*) FROM public.api_football_cache WHERE last_attempt_at > p_read_at)
    + (SELECT count(*) FROM public.api_football_details WHERE last_attempt_at > p_read_at)
    + 4 * (SELECT count(*) FROM public.api_football_teams WHERE last_attempt_at > p_read_at)
    + (SELECT count(*) FROM public.api_football_calendar_reservations WHERE reserved_at > p_read_at)
  INTO later;

  UPDATE public.api_football_budget SET
    request_day = d,
    requests_used = p_used + later,
    provider_requests_used = p_used,
    provider_read_at = p_read_at
  WHERE singleton;
END;
$$;

REVOKE ALL ON FUNCTION public.record_api_football_account(text, timestamptz, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_api_football_account(text, timestamptz, integer, integer, timestamptz)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.api_football_verify_attempts (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz NOT NULL,
  alerted_at timestamptz
);

-- Tabla de servicio: RLS con deny-all explícito; solo service_role (que salta RLS).
ALTER TABLE public.api_football_verify_attempts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'api_football_verify_attempts' AND policyname = 'service_only'
  ) THEN
    CREATE POLICY service_only ON public.api_football_verify_attempts
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;
REVOKE ALL ON TABLE public.api_football_verify_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.api_football_verify_attempts TO service_role;

-- Suma un intento a cada partido y devuelve, una sola vez por partido, si toca
-- avisar al admin (solo para los de p_alertable que llegaron a p_alert_after).
CREATE OR REPLACE FUNCTION public.note_api_football_verify_attempts(
  p_match_ids uuid[], p_alertable uuid[], p_alert_after integer
)
RETURNS TABLE(match_id uuid, attempts integer, alert boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t timestamptz := clock_timestamp();
  ids uuid[];
BEGIN
  IF p_alert_after IS NULL OR p_alert_after < 1 THEN RAISE EXCEPTION 'Invalid alert threshold'; END IF;
  SELECT COALESCE(array_agg(DISTINCT m.id), '{}'::uuid[]) INTO ids
    FROM public.matches m WHERE m.id = ANY(COALESCE(p_match_ids, '{}'::uuid[]));

  INSERT INTO public.api_football_verify_attempts AS a (match_id, attempts, last_attempt_at)
  SELECT u.id, 1, t FROM unnest(ids) AS u(id)
  ON CONFLICT (match_id) DO UPDATE SET attempts = a.attempts + 1, last_attempt_at = EXCLUDED.last_attempt_at;

  -- Reclamo atómico del aviso: alerted_at pasa de NULL a t una sola vez.
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.api_football_verify_attempts a SET alerted_at = t
     WHERE a.match_id = ANY(ids) AND a.alerted_at IS NULL AND a.attempts >= p_alert_after
       AND a.match_id = ANY(COALESCE(p_alertable, '{}'::uuid[]))
    RETURNING a.match_id
  )
  SELECT a.match_id, a.attempts, EXISTS (SELECT 1 FROM claimed c WHERE c.match_id = a.match_id)
    FROM public.api_football_verify_attempts a WHERE a.match_id = ANY(ids);
END;
$$;

REVOKE ALL ON FUNCTION public.note_api_football_verify_attempts(uuid[], uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.note_api_football_verify_attempts(uuid[], uuid[], integer) TO service_role;
