-- Migration 061: snapshot del estado REAL de producción (2026-06-10).
--
-- CONTEXTO (auditoría 2026-06-10): varios objetos críticos de la DB fueron
-- hot-patcheados en prod vía SQL editor / MCP sin archivo de migración, así
-- que el repo no podía reconstruir prod ni auditar el lock de predicciones
-- desde git. Este archivo es un dump VERBATIM (pg_get_functiondef /
-- pg_get_triggerdef del 2026-06-10) — aplicarlo en prod es un no-op.
--
-- Regla nueva (CLAUDE.md): toda corrección por SQL editor/MCP genera su
-- archivo de migración en el mismo commit. Cero hot-patches sin versionar.

-- ─────────────────────────────────────────────────────────────────────
-- 1. normalize_team_name — versión prod (usa \m/\M y aliases USA/Czechia/
--    Bosnia/Ivory Coast/Cape Verde/Korea/Curaçao/Türkiye/DR Congo).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v := lower(unaccent(p_name));
  v := regexp_replace(v, '\m(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\M', ' ', 'g');
  v := replace(v, 'munchen', 'munich');
  v := replace(v, 'paris saint germain', 'psg');
  v := replace(v, 'paris saintgermain', 'psg');
  v := replace(v, 'paris saint-germain', 'psg');
  v := regexp_replace(v, '\munited states of america\M', 'united states', 'g');
  v := regexp_replace(v, '\musa\M', 'united states', 'g');
  v := regexp_replace(v, '\mczechia\M', 'czech republic', 'g');
  v := regexp_replace(v, '\mbosnia and herzegovina\M', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\mbosnia & herzegovina\M', 'bosnia herzegovina', 'g');
  v := regexp_replace(v, '\mbosnia-herzegovina\M', 'bosnia herzegovina', 'g');
  v := replace(v, 'bosnia & herzegovina', 'bosnia herzegovina');
  v := replace(v, 'bosnia-herzegovina', 'bosnia herzegovina');
  v := regexp_replace(v, '\mcote d''ivoire\M', 'ivory coast', 'g');
  v := regexp_replace(v, '\mcote divoire\M', 'ivory coast', 'g');
  v := regexp_replace(v, '\mcabo verde\M', 'cape verde', 'g');
  v := regexp_replace(v, '\msouth korea\M', 'korea republic', 'g');
  v := regexp_replace(v, '\mrepublic of korea\M', 'korea republic', 'g');
  v := regexp_replace(v, '\mnorth korea\M', 'korea dpr', 'g');
  v := replace(v, 'curazao', 'curacao');
  v := replace(v, 'turkiye', 'turkey');
  -- NUEVO 054: DR Congo / Congo DR / Congo-Kinshasa → congo dr
  v := regexp_replace(v, '\mcongo dr\M', 'dr congo', 'g');
  v := regexp_replace(v, '\mcongo-kinshasa\M', 'dr congo', 'g');
  v := regexp_replace(v, '\mdemocratic republic of congo\M', 'dr congo', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);
  RETURN v;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. check_prediction_lock — EL trigger del lock de 5 minutos.
--    Versión prod: permite no-op UPDATEs (mismos predicted_home/away)
--    para que los passes de scoring no revienten; bloquea creación y
--    cambio de marcador a <5 min del kickoff.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_prediction_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  match_time timestamptz;
  minutes_to_kickoff interval;
begin
  select scheduled_at into match_time from public.matches where id = new.match_id;
  minutes_to_kickoff := match_time - now();

  -- Allow no-op UPDATEs (same home/away score as before) so background
  -- scoring passes that touch other columns do not trip the lock.
  if (tg_op = 'UPDATE') and
     (new.predicted_home is not distinct from old.predicted_home) and
     (new.predicted_away is not distinct from old.predicted_away) then
    return new;
  end if;

  if minutes_to_kickoff < interval '5 minutes' then
    raise exception 'No se pueden crear ni modificar pronósticos a menos de 5 minutos del partido';
  end if;

  return new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. matches_prevent_status_regress — anti-regresión de status.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.matches_prevent_status_regress()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status = 'finished' and new.status in ('live', 'scheduled') then
    new.status := 'finished';
  end if;
  if old.status = 'cancelled' and new.status = 'scheduled' then
    new.status := 'cancelled';
  end if;
  return new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. check_and_reserve_match_sync — single-flight del lazy sync.
--    Reserva atómica via conditional upsert sobre sync_log.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_and_reserve_match_sync()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  window_min int;
  reserved boolean;
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM matches
      WHERE status = 'scheduled'
        AND scheduled_at BETWEEN now() - interval '2 hours 30 minutes'
                             AND now() + interval '15 minutes'
    ) THEN 3
    WHEN EXISTS (SELECT 1 FROM matches WHERE status = 'live') THEN 5
    WHEN EXISTS (
      SELECT 1 FROM matches
      WHERE status = 'scheduled'
        AND scheduled_at BETWEEN now() AND now() + interval '3 hours'
    ) THEN 15
    ELSE 120
  END
  INTO window_min;

  WITH upsert AS (
    INSERT INTO sync_log (key, last_run, updated_at)
    VALUES ('matches_recent', now(), now())
    ON CONFLICT (key) DO UPDATE
      SET last_run = EXCLUDED.last_run, updated_at = EXCLUDED.updated_at
      WHERE sync_log.last_run < now() - (window_min::text || ' minutes')::interval
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upsert) INTO reserved;

  RETURN COALESCE(reserved, false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. flip_stale_live_matches — heal de lives colgados (>4h).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.flip_stale_live_matches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_count int;
begin
  update public.matches
    set status = 'finished'
    where status = 'live'
      and scheduled_at < now() - interval '4 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. update_match_live_espn — ambos overloads prod (el de 7 args se
--    supersede en migración 063 con el snapshot de alargue).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_match_live_espn(p_match_id uuid, p_espn_id text, p_status text, p_home_score integer, p_away_score integer, p_elapsed integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_home_score integer;
  v_old_away_score integer;
BEGIN
  SELECT home_score, away_score
    INTO v_old_home_score, v_old_away_score
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_home_score IS NOT NULL AND p_home_score < COALESCE(v_old_home_score, 0) THEN
    p_home_score := v_old_home_score;
  END IF;
  IF p_away_score IS NOT NULL AND p_away_score < COALESCE(v_old_away_score, 0) THEN
    p_away_score := v_old_away_score;
  END IF;

  UPDATE public.matches SET
    espn_id          = COALESCE(public.matches.espn_id, p_espn_id),
    status           = p_status,
    home_score       = COALESCE(p_home_score, home_score),
    away_score       = COALESCE(p_away_score, away_score),
    elapsed          = COALESCE(p_elapsed, elapsed),
    live_updated_at  = NOW(),
    live_source      = 'espn'
  WHERE id = p_match_id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_match_live_espn(p_match_id uuid, p_espn_id text, p_status text, p_home_score integer, p_away_score integer, p_elapsed integer, p_status_detail text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_home_score integer;
  v_old_away_score integer;
BEGIN
  SELECT home_score, away_score
    INTO v_old_home_score, v_old_away_score
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_home_score IS NOT NULL AND p_home_score < COALESCE(v_old_home_score, 0) THEN
    p_home_score := v_old_home_score;
  END IF;
  IF p_away_score IS NOT NULL AND p_away_score < COALESCE(v_old_away_score, 0) THEN
    p_away_score := v_old_away_score;
  END IF;

  UPDATE public.matches SET
    espn_id            = COALESCE(public.matches.espn_id, p_espn_id),
    status             = p_status,
    home_score         = COALESCE(p_home_score, home_score),
    away_score         = COALESCE(p_away_score, away_score),
    elapsed            = COALESCE(p_elapsed, elapsed),
    live_status_detail = p_status_detail,
    live_updated_at    = NOW(),
    live_source       = 'espn'
  WHERE id = p_match_id;

  RETURN true;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. score_match + calculate_prediction_points — scoring engine.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.score_match(p_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_home_score integer;
  v_away_score integer;
BEGIN
  SELECT home_score, away_score INTO v_home_score, v_away_score
    FROM matches WHERE id = p_match_id;
  IF v_home_score IS NULL OR v_away_score IS NULL THEN
    RAISE NOTICE 'score_match(%): scores NULL, skip', p_match_id;
    RETURN;
  END IF;

  UPDATE predictions p
  SET points_earned = calculate_prediction_points(
    p.predicted_home,
    p.predicted_away,
    v_home_score,
    v_away_score,
    pol.points_exact,
    COALESCE(pol.points_goal_diff, 3),
    COALESCE(pol.points_correct_result, 2),
    pol.points_one_team
  )
  FROM pollas pol
  WHERE p.match_id = p_match_id
    AND p.polla_id = pol.id;

  UPDATE polla_participants pp
  SET total_points = (
    SELECT COALESCE(SUM(pred.points_earned), 0)
    FROM predictions pred
    WHERE pred.polla_id = pp.polla_id
      AND pred.user_id = pp.user_id
  )
  WHERE pp.polla_id IN (
    SELECT DISTINCT polla_id FROM predictions WHERE match_id = p_match_id
  );

  WITH ranked AS (
    SELECT id,
           RANK() OVER (PARTITION BY polla_id ORDER BY total_points DESC) as new_rank
    FROM polla_participants
    WHERE polla_id IN (
      SELECT DISTINCT polla_id FROM predictions WHERE match_id = p_match_id
    )
  )
  UPDATE polla_participants pp
  SET rank = r.new_rank
  FROM ranked r
  WHERE pp.id = r.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_prediction_points(p_predicted_home integer, p_predicted_away integer, p_actual_home integer, p_actual_away integer, p_points_exact integer, p_points_goal_diff integer, p_points_correct_result integer, p_points_one_team integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    pred_diff int;
    actual_diff int;
    pred_outcome int;
    actual_outcome int;
  BEGIN
    -- Tier 1: Exact score match
    IF p_predicted_home = p_actual_home AND p_predicted_away = p_actual_away THEN
      RETURN p_points_exact;
    END IF;

    -- Calculate winner outcome: 1=home, -1=away, 0=draw
    pred_outcome := SIGN(p_predicted_home - p_predicted_away);
    actual_outcome := SIGN(p_actual_home - p_actual_away);

    -- Check if winner is correct
    IF pred_outcome = actual_outcome THEN
      -- Tier 2: Correct winner + same goal difference
      pred_diff := p_predicted_home - p_predicted_away;
      actual_diff := p_actual_home - p_actual_away;
      IF pred_diff = actual_diff THEN
        RETURN p_points_goal_diff;
      END IF;

      -- Tier 3: Correct winner only
      RETURN p_points_correct_result;
    END IF;

    -- Tier 4: One team score exact (wrong winner)
    IF p_predicted_home = p_actual_home OR p_predicted_away = p_actual_away THEN
      RETURN p_points_one_team;
    END IF;

    -- Tier 5: Nothing
    RETURN 0;
  END;
  $function$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. on_match_finished + check_polla_completion — cierre y scoring.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.on_match_finished()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'finished'
     AND NEW.final_verified_at IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'finished' OR OLD.final_verified_at IS NULL) THEN
    PERFORM public.score_match(NEW.id);
  END IF;

  IF NEW.status = 'live' AND OLD.status != 'live' THEN
    UPDATE predictions SET visible = true, locked = true WHERE match_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_polla_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_polla record;
BEGIN
  FOR v_polla IN
    SELECT id, match_ids FROM pollas
    WHERE match_ids @> ARRAY[NEW.id]
      AND status = 'active'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM matches
      WHERE id = ANY(v_polla.match_ids)
        AND status NOT IN ('finished', 'cancelled', 'postponed')
    ) THEN
      UPDATE pollas SET status = 'ended' WHERE id = v_polla.id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 9. trigger_sync_live — pg_cron cada 1 min → /api/matches/sync-live.
--    (trigger_discover_tournaments se supersede en migración 062.)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_sync_live()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_url      text;
  v_secret   text;
  v_request_id bigint;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'app_base_url';
  IF v_url IS NULL THEN
    RAISE NOTICE 'trigger_sync_live: app_base_url no configurado, abort';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'app.cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE NOTICE 'trigger_sync_live: app.cron_secret no en vault, abort';
    RETURN;
  END IF;

  v_request_id := net.http_post(
    url := v_url || '/api/matches/sync-live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  PERFORM v_request_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 10. Triggers — recreación idempotente con las definiciones de prod.
-- ─────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_matches_no_regress ON public.matches;
CREATE TRIGGER trg_matches_no_regress BEFORE UPDATE ON public.matches
  FOR EACH ROW WHEN (((old.status)::text IS DISTINCT FROM (new.status)::text))
  EXECUTE FUNCTION matches_prevent_status_regress();

DROP TRIGGER IF EXISTS trigger_check_polla_completion ON public.matches;
CREATE TRIGGER trigger_check_polla_completion AFTER UPDATE ON public.matches
  FOR EACH ROW WHEN ((((new.status)::text = ANY ((ARRAY['finished'::character varying, 'cancelled'::character varying, 'postponed'::character varying])::text[])) AND ((old.status)::text IS DISTINCT FROM (new.status)::text)))
  EXECUTE FUNCTION check_polla_completion();

DROP TRIGGER IF EXISTS trigger_match_status_change ON public.matches;
CREATE TRIGGER trigger_match_status_change AFTER UPDATE OF status, final_verified_at ON public.matches
  FOR EACH ROW EXECUTE FUNCTION on_match_finished();

DROP TRIGGER IF EXISTS trigger_lock_predictions ON public.predictions;
CREATE TRIGGER trigger_lock_predictions BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION check_prediction_lock();
