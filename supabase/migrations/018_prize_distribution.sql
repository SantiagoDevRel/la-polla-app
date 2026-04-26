-- 017_prize_distribution.sql
-- Premios configurables por el organizador. JSON con shape:
--   { mode: 'percentage' | 'cop',
--     prizes: [ { position: int, value: numeric }, ... ] }
-- mode: 'percentage' (suma a 100) o 'cop' (montos fijos).
-- prizes: orden por posición (1ro, 2do, …). El organizador puede agregar
-- tantas posiciones como quiera (top 10, top 20, etc.).

ALTER TABLE pollas
  ADD COLUMN IF NOT EXISTS prize_distribution jsonb;

COMMENT ON COLUMN pollas.prize_distribution IS
  'Distribución de premios definida por el organizador. Shape: { mode: ''percentage''|''cop'', prizes: [{ position:int, value:numeric }] }. NULL = winner-takes-all (default histórico).';
