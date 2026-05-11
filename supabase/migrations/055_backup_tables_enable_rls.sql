-- ─────────────────────────────────────────────────────────────────────
-- Migration 055: enable RLS on 5 backup tables left over from cleanups
-- ─────────────────────────────────────────────────────────────────────
--
-- Las tablas:
--   - public.matches_backup_dedup_20260505
--   - public.matches_backup_dedup_v2_20260505
--   - public._backup_dedup_matches_20260506
--   - public._backup_dedup_predictions_20260506
--   - public._backup_dedup_pollas_match_ids_20260506
--
-- Se crearon durante los cleanups de duplicados de matches (2026-05-05 y
-- 2026-05-06) siguiendo el workflow "Backup primero" documentado en CLAUDE.md.
-- Cumplieron su rol. Quedaron sin RLS habilitada → Supabase advisory CRITICAL:
-- anon key podía leer todas las filas vía PostgREST.
--
-- Verificación previa (grep en lib/ + app/): NINGÚN código de la app las
-- referencia. Solo aparecen en CLAUDE.md como docs del workflow.
--
-- Habilitar RLS sin policies = default-deny para anon/authenticated.
-- service_role mantiene full access (para cualquier rollback futuro manual).
-- Invisible para el runtime de la app.
--
-- Aplicado en prod 2026-05-11 via MCP Supabase.

ALTER TABLE public.matches_backup_dedup_20260505 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches_backup_dedup_v2_20260505 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_dedup_matches_20260506 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_dedup_predictions_20260506 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_dedup_pollas_match_ids_20260506 ENABLE ROW LEVEL SECURITY;
