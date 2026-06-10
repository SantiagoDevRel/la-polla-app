-- Migration 063: score reglamentario (90') para knockouts con alargue.
--
-- REGLA DE PRODUCTO (ya documentada en lib/football-data/sync.ts): las
-- pollas se puntúan con el marcador de los 90 minutos (incluida adición),
-- NUNCA con goles de alargue ni penales. football-data ya manda
-- score.regularTime para matches con ET. El BUG era la cadena ESPN:
--   1. ESPN (dueño del live) escribe el score CON goles de alargue en
--      home_score/away_score.
--   2. El guard monotónico (GREATEST) bloquea la corrección a la baja
--      de football-data al final.
--   3. verify-final comparaba ESPN contra el row que ESPN mismo escribió
--      → auto-verificaba → se scoreaba con el score de alargue.
--
-- FIX (2 piezas SQL + cambios TS en verify-final.ts / espn/client.ts):
--   1. regulation_home_score / regulation_away_score: snapshot del score
--      a los 90, congelado por update_match_live_espn v3 la primera vez
--      que el feed indica alargue. El live sigue mostrando el score real
--      (home_score) — el snapshot es solo para puntos/verificación.
--   2. finalize_match_result(): RPC autoritativo que fija el score final
--      canónico (90'), permite corrección A LA BAJA (bypass del GREATEST)
--      y setea final_verified_at en un segundo UPDATE para que el trigger
--      de scoring corra con los scores ya escritos.
--
-- Comportamiento resultante para un knockout 1-1 (90') → 2-1 (ET):
--   - Durante el partido: la app muestra 2-1 live (real).
--   - Al verificar: home_score vuelve a 1-1 (canónico de pollas, igual
--     que siempre fue la regla), las notas guardan "AET 2-1", y los
--     puntos se calculan contra 1-1.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas de snapshot reglamentario.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS regulation_home_score integer,
  ADD COLUMN IF NOT EXISTS regulation_away_score integer;

COMMENT ON COLUMN public.matches.regulation_home_score IS
  'Score local a los 90 min (snapshot al entrar a alargue). NULL si el match no fue a ET.';
COMMENT ON COLUMN public.matches.regulation_away_score IS
  'Score visitante a los 90 min (snapshot al entrar a alargue). NULL si el match no fue a ET.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. update_match_live_espn v3 (overload de 7 args): snapshot de ET.
--    OJO: la señal de ET son los STATUS names de ESPN, NO elapsed>90 —
--    el parser de minutos convierte "90'+5" (descuento) en 95.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_match_live_espn(p_match_id uuid, p_espn_id text, p_status text, p_home_score integer, p_away_score integer, p_elapsed integer, p_status_detail text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_home_score integer;
  v_old_away_score integer;
  v_verified timestamptz;
BEGIN
  SELECT home_score, away_score, final_verified_at
    INTO v_old_home_score, v_old_away_score, v_verified
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Un match VERIFICADO es inmutable para el live sync (NUEVO 063):
  -- finalize_match_result ya fijó el score canónico de 90'. Sin este
  -- guard, el tick siguiente del cron re-escribía el score con goles de
  -- alargue (ESPN sigue listando el evento en el scoreboard) y la UI
  -- mostraba un marcador distinto al que pagó puntos.
  IF v_verified IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Snapshot reglamentario (NUEVO 063): la PRIMERA vez que el feed indica
  -- que el partido entró a alargue/penales, congelamos el score de los 90.
  -- En STATUS_END_OF_REGULATION el payload de ESE MISMO tick es por
  -- definición el score al cierre de los 90+adición (cubre goles de
  -- descuento que llegan en el mismo tick que la señal); en los estados
  -- posteriores ya puede haber goles de ET, así que usamos el valor de DB
  -- del tick anterior. Idempotente: solo si el snapshot sigue NULL.
  IF p_status_detail = 'STATUS_END_OF_REGULATION' THEN
    UPDATE public.matches
       SET regulation_home_score = COALESCE(regulation_home_score, p_home_score, home_score),
           regulation_away_score = COALESCE(regulation_away_score, p_away_score, away_score)
     WHERE id = p_match_id
       AND regulation_home_score IS NULL
       AND COALESCE(p_home_score, home_score) IS NOT NULL
       AND COALESCE(p_away_score, away_score) IS NOT NULL;
  ELSIF p_status_detail IN (
       'STATUS_OVERTIME',
       'STATUS_FIRST_HALF_EXTRA_TIME',
       'STATUS_HALFTIME_ET',
       'STATUS_SECOND_HALF_EXTRA_TIME',
       'STATUS_END_OF_EXTRA_TIME',
       'STATUS_SHOOTOUT',
       'STATUS_FINAL_PEN',
       'STATUS_FINAL_AET'
     ) THEN
    UPDATE public.matches
       SET regulation_home_score = COALESCE(regulation_home_score, home_score),
           regulation_away_score = COALESCE(regulation_away_score, away_score)
     WHERE id = p_match_id
       AND regulation_home_score IS NULL
       AND home_score IS NOT NULL
       AND away_score IS NOT NULL;
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
    live_source        = 'espn'
  WHERE id = p_match_id;

  RETURN true;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. finalize_match_result — único path autoritativo de cierre.
--    Dos UPDATEs deliberados: el trigger trigger_match_status_change es
--    AFTER UPDATE OF status, final_verified_at — el primer UPDATE fija
--    scores (sin verificar → no scorea), el segundo setea
--    final_verified_at → score_match corre con los scores ya escritos.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_match_result(
  p_match_id uuid,
  p_home_score integer,
  p_away_score integer,
  p_notes text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_home_score IS NULL OR p_away_score IS NULL THEN
    RAISE EXCEPTION 'finalize_match_result: scores no pueden ser NULL';
  END IF;

  -- Paso 1: score canónico (permite corrección a la baja — autoritativo).
  UPDATE public.matches SET
    home_score = p_home_score,
    away_score = p_away_score,
    status     = 'finished'
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Paso 2: marcar verificado → dispara score_match con los scores del paso 1.
  UPDATE public.matches SET
    final_verified_at        = NOW(),
    final_verification_notes = COALESCE(p_notes, final_verification_notes)
  WHERE id = p_match_id
    AND final_verified_at IS NULL;

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalize_match_result(uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_match_result(uuid, integer, integer, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Drop del overload legacy de 6 args de update_match_live_espn.
--    Cero callers (espn/sync.ts siempre pasa los 7 params nombrados) y
--    su existencia hace ambigua cualquier llamada futura de 6 args
--    contra el overload de 7 con DEFAULT.
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_match_live_espn(uuid, text, text, integer, integer, integer);
