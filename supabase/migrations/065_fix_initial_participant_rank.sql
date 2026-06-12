-- 065_fix_initial_participant_rank.sql
--
-- Fix del bug "fresh joiner aparece #1 ganando" (reporte Santiago 2026-06-12,
-- screenshot La Polla de Carvalho: Nati G + Esteban, 0 pts, recién entraron,
-- salían en #1 "Va ganando $300.000" arriba de gente con puntos).
--
-- CAUSA RAÍZ: el trigger BEFORE INSERT `trigger_set_initial_rank` →
-- `set_initial_participant_rank()` estampaba `NEW.rank := 1` a TODO
-- participante nuevo. Esa función vivía SOLO en prod (hot-patch, nunca
-- migrada — el drift que advierte la regla #5 del CLAUDE.md). El rank solo
-- se corregía cuando el siguiente partido de la polla finalizaba y
-- `score_match` re-rankeaba. En una polla con partidos ya puntuados, un
-- 0-pt recién entrado se quedaba clavado en rank=1 mostrándose como líder.
--
-- FIX (defensa a nivel DB, a prueba de cualquier path de inserción —
-- incluido SQL manual / herramientas admin, no solo las 4 rutas de app):
--   1. Se elimina el stamp rank=1. La columna queda con su default NULL.
--   2. Trigger AFTER INSERT OR UPDATE OF paid,status que recomputa los
--      ranks de la polla afectada con la MISMA lógica que score_match
--      (RANK() OVER ORDER BY total_points DESC). Un 0-pt nuevo cae al
--      fondo (tied-last), nunca #1.
--   3. Backfill idempotente de todas las pollas (no-op donde ya está bien).
--
-- notify_on_rank_change() ya guardea `old.rank IS NULL` → la transición
-- NULL→N de un recién llegado NO dispara ping. El backfill se hace con ese
-- trigger deshabilitado para no spamear "bajaste a #N" al corregir data
-- vieja.

-- ── 1. Backfill (con notify deshabilitado) ───────────────────────────────
ALTER TABLE public.polla_participants DISABLE TRIGGER trg_notify_rank_change;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT polla_id FROM public.polla_participants LOOP
    WITH ranked AS (
      SELECT id, RANK() OVER (ORDER BY total_points DESC) AS new_rank
      FROM public.polla_participants
      WHERE polla_id = r.polla_id
    )
    UPDATE public.polla_participants pp
    SET rank = rr.new_rank
    FROM ranked rr
    WHERE pp.id = rr.id
      AND pp.rank IS DISTINCT FROM rr.new_rank;
  END LOOP;
END $$;

ALTER TABLE public.polla_participants ENABLE TRIGGER trg_notify_rank_change;

-- ── 2. Eliminar el stamp rank=1 (hot-patch no migrado) ───────────────────
DROP TRIGGER IF EXISTS trigger_set_initial_rank ON public.polla_participants;
DROP FUNCTION IF EXISTS public.set_initial_participant_rank();

-- ── 3. Recompute on participant change ───────────────────────────────────
-- Mirror exacto del bloque de rank de score_match: RANK() sobre TODOS los
-- participantes de la polla por total_points DESC. Solo escribe filas que
-- cambian (guard IS DISTINCT) → mínimo trabajo, mínimo disparo de
-- notify_on_rank_change. Setea rank únicamente: NO toca paid/status, así
-- que su propio UPDATE no re-dispara este trigger (cero recursión).
CREATE OR REPLACE FUNCTION public.recompute_ranks_on_participant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY total_points DESC) AS new_rank
    FROM public.polla_participants
    WHERE polla_id = NEW.polla_id
  )
  UPDATE public.polla_participants pp
  SET rank = r.new_rank
  FROM ranked r
  WHERE pp.id = r.id
    AND pp.rank IS DISTINCT FROM r.new_rank;
  RETURN NULL; -- AFTER trigger: valor de retorno ignorado
END;
$$;

-- Trigger function: nadie la llama directo (la dispara el trigger como
-- owner). REVOKE de PUBLIC + anon + authenticated (mismo patrón que la
-- migración 056) para no dejar WARN del Security Advisor sobre una
-- SECURITY DEFINER ejecutable por roles públicos.
REVOKE EXECUTE ON FUNCTION public.recompute_ranks_on_participant_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_ranks_on_participant_change() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_ranks_on_participant_change() TO service_role;

DROP TRIGGER IF EXISTS trg_recompute_ranks_on_change ON public.polla_participants;
CREATE TRIGGER trg_recompute_ranks_on_change
  AFTER INSERT OR UPDATE OF paid, status ON public.polla_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_ranks_on_participant_change();

COMMENT ON FUNCTION public.recompute_ranks_on_participant_change() IS
  'Recomputa rank (RANK() por total_points DESC) de la polla cuando entra/cambia un participante. Reemplaza el stamp rank=1 que vivía como hot-patch en prod (migración 065).';
