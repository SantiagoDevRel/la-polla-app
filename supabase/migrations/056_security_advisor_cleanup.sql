-- ─────────────────────────────────────────────────────────────────────
-- Migration 056: cerrar findings del Supabase Security Advisor
-- ─────────────────────────────────────────────────────────────────────
--
-- Cierra los hallazgos del advisor sin tocar comportamiento runtime
-- de la app. Validado pre-aplicación:
--   - app code grep de cada función/tabla flaggeada.
--   - RPCs llamadas por app (upsert_match_safe, update_match_live_espn,
--     flip_stale_live_matches) usan createAdminClient → service_role →
--     REVOKE de anon/authenticated es invisible para el runtime.
--   - Tablas service-role-only ya están accedidas exclusivamente via
--     createAdminClient (app_config, *_notifications, wa_*, etc.).
--   - Triggers (check_*, notify_*, handle_new_auth_user, sync_*, fill_*)
--     se invocan desde Postgres (no via RPC) → REVOKE EXECUTE seguro.
--   - Cron jobs (trigger_sync_live, trigger_discover_tournaments,
--     flip_stale_live_matches) corren como rol postgres en pg_cron →
--     REVOKE de anon/authenticated no afecta.
--   - is_approved_participant(uuid) PRESERVA grant a authenticated:
--     migración 022 lo usa en la policy de polla_participants. Mover a
--     SECURITY INVOKER rompería la policy (recursion). Queda como está.
--
-- Después de aplicar correr `mcp get_advisors` para verificar que el
-- ERROR-level y los INFO-level desaparecen.

-- ─── 1) RLS en backup nuevo del 12-may ──────────────────────────────
-- Cierra el ERROR-level "rls_disabled_in_public" del advisor.
-- Pattern idéntico al de migration 055 para los otros backups.
ALTER TABLE IF EXISTS public.matches_backup_2026_05_12
  ENABLE ROW LEVEL SECURITY;

-- ─── 2) Policy explícita "deny_non_service_role" ─────────────────────
-- Silencia el INFO-level "rls_enabled_no_policy".
-- service_role bypassea RLS por diseño de Supabase, así que este policy
-- efectivamente solo bloquea a anon y authenticated (que ya estaban
-- bloqueados con RLS enabled + zero policies). El policy es:
--   1. Documentación explícita de la intención (service-role-only).
--   2. Silencia el advisor.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'app_config',
      'match_result_notifications',
      'payment_approved_notifications',
      'payment_submitted_notifications',
      'wa_magic_tokens',
      'wa_template_sends',
      'whatsapp_conversation_state',
      'matches_backup_dedup_20260505',
      'matches_backup_dedup_v2_20260505',
      '_backup_dedup_matches_20260506',
      '_backup_dedup_predictions_20260506',
      '_backup_dedup_pollas_match_ids_20260506',
      'matches_backup_2026_05_12'
    ])
  LOOP
    -- Skip si la tabla no existe (defensa contra migration aplicada
    -- en environments distintos).
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS deny_non_service_role ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY deny_non_service_role ON public.%I '
        'FOR ALL TO public USING (false) WITH CHECK (false)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ─── 3) Fix search_path mutable en funciones ─────────────────────────
-- Defense-in-depth contra search_path hijacking. ALTER FUNCTION ... SET
-- congela el search_path al ejecutar, sin recrear la función.
ALTER FUNCTION public.matches_prevent_status_regress()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_match_live_espn(uuid,text,text,integer,integer,integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_match_live_espn(uuid,text,text,integer,integer,integer,text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_sync_live()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_my_uid()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_discover_tournaments()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.upsert_match_safe(
  text,text,integer,text,text,text,text,text,
  timestamp with time zone,text,integer,integer,text,integer,text,text
) SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_team_name(text)
  SET search_path = public, pg_temp;

-- ─── 4) REVOKE EXECUTE de SECURITY DEFINER funcs no destinadas a RPC ─
-- Estas funciones se invocan SOLO como triggers, desde pg_cron, o desde
-- el app via createAdminClient (service_role bypassea grants). Exponerlas
-- a /rest/v1/rpc/<name> via anon/authenticated era un foot-gun.

-- Triggers (Postgres internal):
REVOKE EXECUTE ON FUNCTION public.check_polla_completion() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_prediction_lock() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fill_participant_payout_from_user_default() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_perfect_pick() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_rank_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_default_payout_to_participants() FROM anon, authenticated;

-- Helpers internos (llamados desde triggers o admin):
REVOKE EXECUTE ON FUNCTION public.notify_last_place(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_polla_finished(uuid) FROM anon, authenticated;

-- Cron internal (corren como rol postgres):
REVOKE EXECUTE ON FUNCTION public.flip_stale_live_matches() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_discover_tournaments() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_sync_live() FROM anon, authenticated;

-- App via service_role only (createAdminClient):
REVOKE EXECUTE ON FUNCTION public.upsert_match_safe(
  text,text,integer,text,text,text,text,text,
  timestamp with time zone,text,integer,integer,text,integer,text,text
) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_match_live_espn(
  uuid,text,text,integer,integer,integer
) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_match_live_espn(
  uuid,text,text,integer,integer,integer,text
) FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- INTACTOS (no se tocan en esta migration):
--   - is_approved_participant(uuid): authenticated NECESITA EXECUTE
--     para que la policy de polla_participants funcione (migración 022).
--   - get_my_uid(): SECURITY INVOKER, no flaggeada por advisor.
--   - normalize_team_name(text): no SECURITY DEFINER, sin riesgo.
--
-- PENDIENTES (fuera del alcance, requieren cambios más invasivos):
--   - Mover extension `unaccent` fuera de public schema. Requiere DROP +
--     re-CREATE en otro schema + update de cualquier código que la use.
--   - Auth: leaked password protection. N/A — no usamos passwords (phone OTP).
-- ─────────────────────────────────────────────────────────────────────
