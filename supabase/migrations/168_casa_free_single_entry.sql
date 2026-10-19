-- 168 — Entrada gratis = un cupo por persona, siempre (2026-10-19)
--
-- POLLA REGALO 2 quedó creada con «10 cupos por persona» aunque su entrada es
-- gratis. casa_join_free_v1 (migración 143) ya daba un solo cupo, pero la
-- columna decía 10 y el formulario lo mostraba. Pedido del dueño: con entrada
-- gratis el tope es 1 automáticamente, sin importar qué escriba el formulario.
--
-- Un trigger fija max_entries_per_user=1 en toda polla gratis que no sea rifa,
-- al crearla, al bajarle la entrada a 0 o al intentar subirle el tope. Corre
-- después de los guardas de Casa v2 (casa_00_*, casa_01_*) y nunca toca una
-- polla ya resuelta o anulada. Una rifa sigue por boletas, sin este tope.
-- Regresión: scripts/casa-free-entry-check.sql (segundo bloque).

SET client_encoding = 'UTF8';

CREATE FUNCTION public.casa_free_single_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.kind<>'rifa' AND NEW.entry_price_cop=0
    AND NEW.max_entries_per_user IS DISTINCT FROM 1
    AND (TG_OP='INSERT' OR OLD.status NOT IN ('resuelta','anulada')) THEN
    NEW.max_entries_per_user:=1;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.casa_free_single_entry() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER casa_02_free_single_entry BEFORE INSERT OR UPDATE ON public.casa_pollas
  FOR EACH ROW EXECUTE FUNCTION public.casa_free_single_entry();

-- Las pollas gratis vigentes con otro tope (POLLA REGALO 2) pasan a 1. Ninguna
-- inscripción cambia: casa_join_free_v1 nunca dio más de un cupo.
-- Mismo patrón de la 137 para escribir bajo el guarda de Casa v2.
DO $$ DECLARE m text;
BEGIN
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton;
  IF m='paused' THEN RAISE EXCEPTION 'Casa en pausa: reintentar la 168 fuera de la pausa'; END IF;
  IF m='v2' THEN PERFORM set_config('app.casa_contract','2',true); END IF;
  UPDATE public.casa_pollas SET max_entries_per_user=1
    WHERE kind<>'rifa' AND entry_price_cop=0 AND max_entries_per_user<>1
      AND status NOT IN ('resuelta','anulada');
  PERFORM set_config('app.casa_contract','',true);
END $$;
