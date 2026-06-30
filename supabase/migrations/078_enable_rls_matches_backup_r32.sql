-- 078_enable_rls_matches_backup_r32.sql
--
-- 🔴 FIX DE SEGURIDAD (Supabase Security Advisor, email 2026-06-28):
-- rls_disabled_in_public CRITICAL en public.matches_backup_r32_20260628.
--
-- Esa tabla es un BACKUP one-off de `matches` creado por SQL editor durante
-- la promoción de octavos/R32 del Mundial (2026-06-28, ver PR road-to-worldcup
-- #32). Se creó con CREATE TABLE ... AS SELECT y se olvidó habilitar RLS, así
-- que quedó legible/editable/borrable por cualquiera con la URL del proyecto
-- (anon). Las DEMÁS tablas de backup (_backup_dedup_*, matches_backup_*,
-- _backup_zero_scores_*) ya tienen RLS habilitado — a esta se le pasó.
--
-- NO la borramos (es un backup ajeno; puede ser red de seguridad). Solo
-- habilitamos RLS + un deny-all explícito → queda accesible SOLO por
-- service_role (que bypassa RLS). La app nunca la referencia (grep: 0 hits),
-- así que esto no rompe ninguna funcionalidad.
--
-- REGLA #5: el backup nació como hot-patch sin migración; este archivo
-- documenta el fix en git.

-- Replay-safe: la tabla es un backup one-off que SOLO existe en prod (se creó
-- por SQL editor, no por migración). En una DB fresca/local/preview/CI no
-- existe, así que ALTER/DROP POLICY/CREATE POLICY fallarían. Envolvemos en un
-- DO block que chequea to_regclass primero y usa EXECUTE (dynamic SQL evita el
-- error de parse-time por la tabla ausente). Mismo patrón que migración 056.
DO $$
BEGIN
  IF to_regclass('public.matches_backup_r32_20260628') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.matches_backup_r32_20260628 ENABLE ROW LEVEL SECURITY';
    -- Deny-all explícito para roles cliente (anon + authenticated). service_role
    -- bypassa RLS, así que sigue leyendo el backup para restaurar si hiciera
    -- falta. Sin policy RLS ya niega todo; el deny explícito documenta la
    -- intención y silencia el advisor secundario.
    EXECUTE 'DROP POLICY IF EXISTS matches_backup_r32_no_client_access ON public.matches_backup_r32_20260628';
    EXECUTE 'CREATE POLICY matches_backup_r32_no_client_access ON public.matches_backup_r32_20260628 FOR ALL TO public USING (false) WITH CHECK (false)';
  ELSE
    RAISE NOTICE 'matches_backup_r32_20260628 no existe (DB fresca/local) — skip RLS fix';
  END IF;
END $$;

-- Cleanup opcional (NO automático — decisión del owner): si la promoción de
-- octavos/R32 ya está verificada y estable, este backup se puede tirar:
--   DROP TABLE public.matches_backup_r32_20260628;
