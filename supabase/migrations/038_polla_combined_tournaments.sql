-- 038_polla_combined_tournaments — Soporte para pollas combinadas que
-- mezclan partidos de varios torneos.
--
-- Diseño:
--   - pollas.tournament queda como PRIMARY (mostrar badge en headers).
--     Es el primer torneo seleccionado al crear y se usa para display.
--   - pollas.tournaments text[] — lista completa cuando es combinada.
--     NULL para pollas single-tournament (legacy + caso simple).
--   - match_ids ya resuelve cross-tournament (es text[] de match.id);
--     no necesita cambios.

ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS tournaments text[];

COMMENT ON COLUMN public.pollas.tournaments IS
  'Lista completa de torneos cuando la polla es combinada. NULL para single-tournament. tournament (singular) sigue siendo el primary para display y queries simples.';
