-- 086_casa_score_on_verify.sql
-- ============================================================================
-- Que los puntos aparezcan SOLOS cuando se verifica un partido.
--
-- El hueco: `casa_score_polla` solo se llamaba desde el bot de Telegram, al
-- resolver una pregunta manual o al repartir con /resolver. O sea que un
-- sábado la gente veía el 2-1 en la pantalla, sabía que le había pegado... y
-- la tabla seguía en cero hasta que Tama se acordara de correr un comando.
-- Desde afuera eso se lee como "la app no me contó el punto".
--
-- El modelo viejo ya resolvía esto con un trigger sobre `matches`; la casa
-- se construyó sin él. Se replica el patrón: cuando `final_verified_at` pasa
-- de NULL a tener valor (que es el único momento en que el marcador de los
-- 90 minutos queda en firme — REGLA #4), se repuntúan todas las pollas de la
-- casa que contengan ese partido.
--
-- Va como TRIGGER y no como llamada desde la app a propósito: los partidos se
-- verifican por varios caminos (el cron de verify-final, /admin/discrepancias,
-- y SQL a mano cuando los proveedores no se ponen de acuerdo). Un trigger los
-- cubre todos; una llamada en el código cubre solo el que uno recuerde.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.casa_score_on_match_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_polla_id uuid;
BEGIN
  -- Solo en la transición NULL -> verificado. Un UPDATE posterior sobre un
  -- partido ya verificado (una corrección de marcador, por ejemplo) también
  -- entra, porque ahí también hay que repuntuar.
  IF NEW.final_verified_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.final_verified_at IS NOT NULL
     AND OLD.home_score IS NOT DISTINCT FROM NEW.home_score
     AND OLD.away_score IS NOT DISTINCT FROM NEW.away_score THEN
    -- Ya estaba verificado y el marcador no cambió: no hay nada que recalcular.
    RETURN NEW;
  END IF;

  FOR v_polla_id IN
    SELECT DISTINCT pm.polla_id
    FROM public.casa_polla_matches pm
    JOIN public.casa_pollas p ON p.id = pm.polla_id
    WHERE pm.match_id = NEW.id
      -- Una polla ya resuelta no se toca: su reparto está hecho y repuntuar
      -- ahí cambiaría una tabla que la gente ya vio (y cobró).
      AND p.status <> 'resuelta'
      AND p.status <> 'anulada'
  LOOP
    PERFORM public.casa_score_polla(v_polla_id);
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.casa_score_on_match_verified() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS casa_score_on_verify ON public.matches;
CREATE TRIGGER casa_score_on_verify
  AFTER UPDATE OF final_verified_at, home_score, away_score ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.casa_score_on_match_verified();
