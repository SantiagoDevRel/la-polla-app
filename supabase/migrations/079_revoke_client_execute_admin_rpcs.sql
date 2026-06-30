-- 079_revoke_client_execute_admin_rpcs.sql
--
-- 🔴 HARDENING DE SEGURIDAD (hallado durante el trabajo del modo 120', no es
-- de ese feature). Revoca EXECUTE de PUBLIC/anon/authenticated en las RPCs
-- SECURITY DEFINER que SOLO debe llamar el service_role (admin client / cron).
--
-- El auto-grant de Supabase a anon+authenticated quedó VIVO porque las
-- migraciones previas (063, 071) hicieron `REVOKE ... FROM PUBLIC` pero NO de
-- anon/authenticated explícito — el gotcha conocido (ver memoria
-- supabase-new-function-grant-gotcha). Verificado en prod via pg_proc.proacl:
--   finalize_match_result → anon=X, authenticated=X  ← EXPLOTABLE
--   score_match           → PUBLIC=X, anon=X, authenticated=X
--   update_match_live_espn → (mismo riesgo)
--
-- RIESGO que cierra: un usuario AUTENTICADO podía llamar finalize_match_result
-- por RPC y finalizar cualquier partido con el marcador que quisiera →
-- disparar el scoring → manipular los puntos de TODAS las pollas. Idem
-- update_match_live_espn (escribir scores en vivo).
--
-- Seguro: grep confirma que la app SOLO llama estas funciones via admin client
-- (service_role) — verify-final.ts (finalize), espn/sync.ts (live), admin
-- routes (rescore). score_match lo invoca únicamente el trigger
-- on_match_finished (corre como owner postgres / service_role), nunca la app.
-- Por eso revocar el EXECUTE de cliente NO rompe nada.

REVOKE EXECUTE ON FUNCTION public.finalize_match_result(uuid, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.score_match(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_match_live_espn(uuid, text, text, integer, integer, integer, text)
  FROM PUBLIC, anon, authenticated;

-- service_role conserva EXECUTE (re-aseguramos por claridad; el trigger corre
-- como owner postgres así que score_match sigue funcionando en ambos paths).
GRANT EXECUTE ON FUNCTION public.finalize_match_result(uuid, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.score_match(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_match_live_espn(uuid, text, text, integer, integer, integer, text) TO service_role;
