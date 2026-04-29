-- 034_live_status_detail — Agregar columna para el estado detallado
-- del proveedor (ESPN), para poder mostrar "Descanso", "Fin 90'",
-- "Penales" etc. en la UI sin tener que parsear el minuto.
--
-- `status` sigue siendo el enum de 4 valores ('scheduled', 'live',
-- 'finished', 'cancelled') que usa el trigger. live_status_detail
-- solo es display.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS live_status_detail text;

COMMENT ON COLUMN public.matches.live_status_detail IS
  'Status detallado del proveedor (ESPN). Ej: STATUS_HALFTIME, STATUS_FIRST_HALF, STATUS_END_OF_REGULATION. Usado solo para display en la UI ("Descanso", "Fin 90 minutos", etc.). Nuestro `status` sigue siendo el enum de 4 valores que usa el trigger.';

-- Extender update_match_live_espn para aceptar el detalle.
CREATE OR REPLACE FUNCTION public.update_match_live_espn(
  p_match_id uuid,
  p_espn_id text,
  p_status text,
  p_home_score integer,
  p_away_score integer,
  p_elapsed integer,
  p_status_detail text DEFAULT NULL
) RETURNS boolean AS $$
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
    live_source        = 'espn'
  WHERE id = p_match_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
