-- 118: hora fijada por el admin + cierre automático de Casa que sigue al calendario.
--
-- Contexto (2026-09-13). API-Football tarda en reflejar reprogramaciones de la
-- Liga BetPlay: Inter de Bogotá vs Nacional se jugó adelantado al 16-sep
-- (Dimayor) y el proveedor lo seguía mostrando el 16-oct con hora confirmada.
-- Corregir `scheduled_at` a mano no alcanzaba: el siguiente refresco lo pisaba
-- con la hora confirmada del proveedor (upsert_match_safe, migración 103).
-- Además el dueño pidió poder armar pollas con cierre automático aunque algún
-- partido tenga hora por confirmar, y que el cierre se ajuste solo después.
--
-- 1) matches.schedule_override_at: hora oficial fijada por el admin. Un
--    trigger BEFORE UPDATE impide que cualquier escritor la mueva. Cuando el
--    proveedor publica una hora confirmada a ±15 min de la fijada, la fijación
--    se libera sola y vuelve a mandar el proveedor.
-- 2) Cierre automático de Casa (close_mode='auto'): closes_at = primer
--    scheduled_at de sus partidos no anulados − 5 min, el mismo instante en que
--    se bloquea el primer pronóstico. Se recalcula cuando cambia la hora de un
--    partido vinculado o se vincula un partido. Solo toca pollas de partidos en
--    borrador/abierta, sin archivar y cuyo cierre no ha pasado: una polla que ya
--    cerró nunca se reabre. Un partido con hora por confirmar cuenta con su hora
--    provisional, igual que el candado de pronósticos (casa_guard_pick_lifecycle).
--    Una falla de Casa nunca bloquea la escritura del calendario.
--
-- Instalar esta migración no escribe filas.

-- ── 1) Hora fijada por el admin ──────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS schedule_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_override_note text,
  ADD COLUMN IF NOT EXISTS schedule_override_set_at timestamptz;

COMMENT ON COLUMN public.matches.schedule_override_at IS
  'Hora oficial fijada por el admin cuando el proveedor va atrasado. Mientras no sea NULL, ningún escritor mueve scheduled_at; se libera sola cuando el proveedor confirma una hora a ±15 min. Se fija con UPDATE matches SET schedule_override_at=..., schedule_override_note=... (migración 118).';

CREATE OR REPLACE FUNCTION public.matches_keep_schedule_override() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  -- Fijar o quitar la hora en esta misma sentencia: se acepta tal cual.
  IF NEW.schedule_override_at IS DISTINCT FROM OLD.schedule_override_at THEN
    IF NEW.schedule_override_at IS NOT NULL THEN
      NEW.scheduled_at := NEW.schedule_override_at;
      NEW.scheduled_at_confirmed := true;
      NEW.schedule_override_set_at := clock_timestamp();
    ELSE
      NEW.schedule_override_note := NULL;
      NEW.schedule_override_set_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.schedule_override_at IS NULL THEN RETURN NEW; END IF;

  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    -- upsert_match_safe solo cambia una hora confirmada por otra confirmada.
    IF NEW.scheduled_at_confirmed
       AND abs(extract(epoch FROM (NEW.scheduled_at - OLD.schedule_override_at))) <= 900 THEN
      -- El proveedor se puso al día: manda su hora y se libera la fijación.
      NEW.schedule_override_at := NULL;
      NEW.schedule_override_note := NULL;
      NEW.schedule_override_set_at := NULL;
    ELSE
      NEW.scheduled_at := OLD.scheduled_at;
      NEW.scheduled_at_confirmed := OLD.scheduled_at_confirmed;
    END IF;
  ELSIF NEW.scheduled_at_confirmed IS DISTINCT FROM OLD.scheduled_at_confirmed THEN
    NEW.scheduled_at_confirmed := OLD.scheduled_at_confirmed;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.matches_keep_schedule_override() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matches_keep_schedule_override() TO service_role;

-- Nombre con prefijo 00: corre antes que los demás BEFORE UPDATE de matches.
DROP TRIGGER IF EXISTS matches_00_schedule_override ON public.matches;
CREATE TRIGGER matches_00_schedule_override
  BEFORE UPDATE OF scheduled_at, scheduled_at_confirmed, schedule_override_at ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.matches_keep_schedule_override();

-- ── 2) Cierre automático de Casa ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.casa_recompute_auto_close(p_polla_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record; v_close timestamptz; v_contract text;
BEGIN
  -- SKIP LOCKED: si otra operación tiene la polla (pronóstico, pago, reparto),
  -- no se espera; el siguiente cambio de horario la vuelve a revisar.
  SELECT id, kind, close_mode, status, archived_at, closes_at, opens_at, publication_mode
    INTO p FROM public.casa_pollas WHERE id = p_polla_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR p.kind <> 'partidos' OR p.close_mode <> 'auto' OR p.archived_at IS NOT NULL
     OR p.status NOT IN ('borrador', 'abierta') OR p.closes_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  SELECT min(m.scheduled_at) - interval '5 minutes' INTO v_close
    FROM public.casa_polla_matches l JOIN public.matches m ON m.id = l.match_id
   WHERE l.polla_id = p.id AND l.voided_at IS NULL;
  IF v_close IS NULL OR v_close = p.closes_at THEN RETURN false; END IF;
  -- Una publicación programada tiene que abrir antes de cerrar.
  IF p.publication_mode = 'programada' AND p.opens_at >= v_close THEN RETURN false; END IF;

  v_contract := current_setting('app.casa_contract', true);
  PERFORM set_config('app.casa_contract', '2', true);
  UPDATE public.casa_pollas SET closes_at = v_close WHERE id = p.id;
  PERFORM set_config('app.casa_contract', coalesce(v_contract, ''), true);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.casa_recompute_auto_close(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_recompute_auto_close(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.casa_auto_close_after_schedule_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_polla uuid;
BEGIN
  BEGIN
    FOR v_polla IN SELECT DISTINCT l.polla_id FROM public.casa_polla_matches l WHERE l.match_id = NEW.id LOOP
      PERFORM public.casa_recompute_auto_close(v_polla);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear el calendario por Casa; el siguiente cambio lo reintenta.
    RETURN NEW;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_auto_close_after_schedule_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_auto_close_after_schedule_change() TO service_role;

-- `schedule_override_at` también va en la lista: un trigger por columnas solo
-- corre si la columna está en el SET, y al fijar la hora es el BEFORE de arriba
-- el que cambia scheduled_at.
DROP TRIGGER IF EXISTS casa_auto_close_on_schedule ON public.matches;
CREATE TRIGGER casa_auto_close_on_schedule
  AFTER UPDATE OF scheduled_at, schedule_override_at ON public.matches
  FOR EACH ROW WHEN (OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at)
  EXECUTE FUNCTION public.casa_auto_close_after_schedule_change();

CREATE OR REPLACE FUNCTION public.casa_auto_close_after_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.casa_recompute_auto_close(NEW.polla_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_auto_close_after_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_auto_close_after_link() TO service_role;

DROP TRIGGER IF EXISTS casa_auto_close_on_link ON public.casa_polla_matches;
CREATE TRIGGER casa_auto_close_on_link
  AFTER INSERT ON public.casa_polla_matches
  FOR EACH ROW EXECUTE FUNCTION public.casa_auto_close_after_link();
