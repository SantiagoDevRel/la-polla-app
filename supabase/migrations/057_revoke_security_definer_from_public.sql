-- ─────────────────────────────────────────────────────────────────────
-- Migration 057: REVOKE EXECUTE FROM PUBLIC en SECURITY DEFINER funcs
-- ─────────────────────────────────────────────────────────────────────
--
-- Fix de migration 056: el REVOKE de anon/authenticated no tuvo efecto
-- porque ambos roles HEREDAN de `PUBLIC`, y `PUBLIC` mantenía EXECUTE
-- por default Postgres. El advisor seguía flaggeando porque la función
-- sí era ejecutable.
--
-- Solución correcta: REVOKE EXECUTE FROM PUBLIC. service_role tiene
-- su propio GRANT explícito (Supabase lo hace), así que no se ve
-- afectado. postgres tampoco (owner).
--
-- Después de aplicar, `routine_privileges` debería mostrar solo
-- `postgres` y `service_role` con EXECUTE — sin PUBLIC.
--
-- is_approved_participant(uuid) se preserva: en migración 022 ya hace
-- REVOKE ALL FROM PUBLIC y luego GRANT EXECUTE TO authenticated.
-- Esa secuencia explícita es lo que el advisor "quiere" (revocar PUBLIC
-- y solo conceder lo necesario). Lo dejamos como está.

-- Triggers (no se llaman via RPC):
REVOKE EXECUTE ON FUNCTION public.check_polla_completion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_prediction_lock() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fill_participant_payout_from_user_default() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_perfect_pick() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_rank_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_user_default_payout_to_participants() FROM PUBLIC;

-- Helpers internos (llamados desde triggers o admin):
REVOKE EXECUTE ON FUNCTION public.notify_last_place(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_polla_finished(uuid) FROM PUBLIC;

-- Cron internal (corren como rol postgres):
REVOKE EXECUTE ON FUNCTION public.flip_stale_live_matches() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_discover_tournaments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_sync_live() FROM PUBLIC;

-- App via service_role only (createAdminClient):
REVOKE EXECUTE ON FUNCTION public.upsert_match_safe(
  text,text,integer,text,text,text,text,text,
  timestamp with time zone,text,integer,integer,text,integer,text,text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_match_live_espn(
  uuid,text,text,integer,integer,integer
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_match_live_espn(
  uuid,text,text,integer,integer,integer,text
) FROM PUBLIC;
