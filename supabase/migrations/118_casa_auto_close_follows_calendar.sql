-- 118: el cierre automático de Casa sigue al calendario.
--
-- Pedido del dueño (2026-09-13): poder armar pollas con cierre automático
-- aunque algún partido tenga hora por confirmar (aplazado o TBD de
-- API-Football), y que el cierre se actualice solo cuando el calendario tenga
-- la información, sin pasos manuales.
--
-- Cierre automático (close_mode='auto'): closes_at = primer scheduled_at de
-- sus partidos no anulados − 5 min, el mismo instante en que se bloquea el
-- primer pronóstico (casa_guard_pick_lifecycle). Un partido con hora por
-- confirmar cuenta con su hora provisional. Se recalcula cuando cambia la hora
-- de un partido vinculado (el calendario confirma o reprograma) y cuando se
-- vincula un partido. Solo toca pollas de partidos en borrador/abierta, sin
-- archivar y cuyo cierre no ha pasado: una polla que ya cerró nunca se reabre.
-- Una falla de Casa nunca bloquea la escritura del calendario.
--
-- Instalar esta migración no escribe filas.

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

DROP TRIGGER IF EXISTS casa_auto_close_on_schedule ON public.matches;
CREATE TRIGGER casa_auto_close_on_schedule
  AFTER UPDATE OF scheduled_at ON public.matches
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
