-- 051_close_polla_with_cancelled_matches.sql
--
-- Bug: el trigger check_polla_completion (migration 008) sólo consideraba
-- "completado" status='finished'. Si un match terminaba como 'cancelled' o
-- 'postponed', la polla quedaba en 'active' para siempre → polla_payouts
-- nunca se materializaba → el modal de "pago al final" jamás aparecía a
-- los participantes (caso reportado: polla "primos-polla-2" 2026-05-09).
--
-- Fix: considerar terminales también 'cancelled' y 'postponed'. Cualquier
-- match cuyo status NO sea 'finished'/'cancelled'/'postponed' bloquea el
-- cierre.
--
-- También corregimos un bug latente en el trigger original: el subquery
-- interno hacía `WHERE id = ANY(SELECT unnest(match_ids) FROM pollas
-- WHERE id = v_polla_id)` que es funcionalmente correcto pero ineficiente.
-- Se simplifica con un `JOIN`-friendly check.

CREATE OR REPLACE FUNCTION public.check_polla_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- El trigger original sólo se disparaba al UPDATE → status='finished'.
-- Lo ampliamos para que también dispare en cancelled/postponed.
DROP TRIGGER IF EXISTS trigger_check_polla_completion ON matches;
CREATE TRIGGER trigger_check_polla_completion
  AFTER UPDATE ON matches
  FOR EACH ROW
  WHEN (
    NEW.status IN ('finished', 'cancelled', 'postponed')
    AND OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION check_polla_completion();

-- Backfill: cerrar pollas activas cuyos matches ya están todos en estado
-- terminal. Esto repara las pollas que quedaron colgadas por el bug viejo.
UPDATE pollas p
SET status = 'ended'
WHERE p.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM matches m
    WHERE m.id = ANY(p.match_ids)
      AND m.status NOT IN ('finished', 'cancelled', 'postponed')
  )
  AND array_length(p.match_ids, 1) > 0;
