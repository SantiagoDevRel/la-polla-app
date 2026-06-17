-- Migration 071: permitir corrección a la BAJA del score en vivo (ESPN).
--
-- CONTEXTO (Argentina-Algeria, Mundial 2026, 2026-06-17): a Argelia le
-- anularon un gol por VAR (1→0). El live sync de ESPN mandaba away_score=0,
-- pero el guard monotónico de update_match_live_espn (v3, migración 063,
-- líneas 110-115) clampaba cualquier bajada → la app seguía mostrando 1-1
-- en vivo hasta el pitazo final. (Bug doble con el de STATUS_IN_PROGRESS
-- no mapeado en lib/espn/client.ts, arreglado en el mismo commit.)
--
-- DECISIÓN (Santiago, 2026-06-16): el guard anti-flicker es demasiado
-- agresivo — un gol anulado por VAR es una bajada LEGÍTIMA y común. ESPN
-- es la fuente autoritativa del live y rara vez flapea. Quitamos el clamp
-- de bajada: el score en vivo ahora sigue 1:1 lo que reporta ESPN.
--
-- Tradeoff aceptado: un glitch momentáneo de ESPN podría bajar un score un
-- tick y subirlo al siguiente (flicker). Se prefiere eso a mostrar goles
-- anulados como válidos durante todo el partido.
--
-- LO QUE NO CAMBIA (sigue idéntico a 063):
--   * Inmutabilidad post-verificación (v_verified IS NOT NULL → RETURN false):
--     finalize_match_result ya fijó el canónico de 90', el live no lo pisa.
--   * Snapshot reglamentario al entrar a alargue (regulation_home/away_score).
--   * COALESCE sobre score NULL: si ESPN manda "" (sin dato), se conserva el
--     valor previo. Solo se permiten bajadas con un valor NO-NULL explícito.
--
-- REGLA #5 (CLAUDE.md): toda corrección a una función de prod vive en una
-- migración. Esta reemplaza el cuerpo de update_match_live_espn v3.

CREATE OR REPLACE FUNCTION public.update_match_live_espn(p_match_id uuid, p_espn_id text, p_status text, p_home_score integer, p_away_score integer, p_elapsed integer, p_status_detail text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_verified timestamptz;
BEGIN
  SELECT final_verified_at
    INTO v_verified
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Un match VERIFICADO es inmutable para el live sync (063):
  -- finalize_match_result ya fijó el score canónico de 90'. Sin este
  -- guard, el tick siguiente del cron re-escribía el score con goles de
  -- alargue (ESPN sigue listando el evento en el scoreboard) y la UI
  -- mostraba un marcador distinto al que pagó puntos.
  IF v_verified IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Snapshot reglamentario (063): la PRIMERA vez que el feed indica que el
  -- partido entró a alargue/penales, congelamos el score de los 90.
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

  -- (071) SIN guard monotónico: el score en vivo sigue a ESPN tal cual,
  -- incluidas bajadas por goles anulados (VAR). COALESCE solo protege el
  -- caso NULL (ESPN sin dato → conservar el valor previo).
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

-- Grants idénticos al estado previo (063 / 057): solo service_role ejecuta
-- el live sync. REVOKE de PUBLIC para silenciar el Security Advisor.
REVOKE EXECUTE ON FUNCTION public.update_match_live_espn(uuid, text, text, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_match_live_espn(uuid, text, text, integer, integer, integer, text) TO service_role;
