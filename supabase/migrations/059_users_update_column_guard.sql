-- 059_users_update_column_guard.sql
--
-- Defense-in-depth contra privilege escalation latente.
--
-- La policy original `users_update_own` (migration 001:296) era
--   FOR UPDATE USING (auth.uid() = id);
-- sin `WITH CHECK` y sin restricción de columnas. Hoy "está protegida"
-- por accidente porque el bug de propagación de `auth.uid()` en el
-- contexto PostgREST hace que devuelva NULL → la policy matchea 0 rows
-- → updates fallan en silencio. El día que se arregle ese TODO
-- (docs/auth-uid-handoff.md), CUALQUIER user autenticado podría:
--
--   supabase.from('users')
--     .update({ is_admin: true })
--     .eq('id', userId)
--
-- y la policy lo aprueba. Migration 024 hace un demote idempotente
-- pero es un UPDATE puntual, no un CHECK enforced — el siguiente
-- UPDATE del attacker revierte el demote.
--
-- Esta migration:
--   1. Recrea `users_update_own` con `WITH CHECK` real y un trigger
--      `BEFORE UPDATE` que bloquea cualquier intento de tocar columnas
--      sensibles (`is_admin`, `whatsapp_number`, `whatsapp_verified`)
--      desde la sesión authenticated. Service_role bypassea — los
--      admin endpoints (que ya verifican is_admin server-side) usan
--      service_role y siguen funcionando.
--   2. Defensa profunda: si en el futuro alguien agrega una columna
--      privilege-bearing, queda en la lista y no se puede editar
--      desde el cliente.
--
-- Idempotente: DROP IF EXISTS + CREATE OR REPLACE.

-- ============================================================
-- 1. Trigger BEFORE UPDATE que bloquea cambios a columnas sensibles
--    cuando current_user es authenticated/anon.
-- ============================================================

CREATE OR REPLACE FUNCTION public.users_block_privileged_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- service_role y postgres tienen carta blanca — los syncs y los
  -- admin endpoints corren con service_role y deben poder tocar todo.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
  THEN
    RETURN NEW;
  END IF;

  -- Bloquear cambios a is_admin desde clientes authenticated/anon.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'cannot update users.is_admin from client session'
      USING ERRCODE = '42501';
  END IF;

  -- Bloquear cambios a whatsapp_number/verified — el phone es la
  -- llave de la cuenta; cambiarlo desde el cliente sería account
  -- takeover. El flujo legítimo de cambio de phone tiene que pasar
  -- por OTP verification server-side con service_role.
  IF NEW.whatsapp_number IS DISTINCT FROM OLD.whatsapp_number THEN
    RAISE EXCEPTION 'cannot update users.whatsapp_number from client session'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.whatsapp_verified IS DISTINCT FROM OLD.whatsapp_verified THEN
    RAISE EXCEPTION 'cannot update users.whatsapp_verified from client session'
      USING ERRCODE = '42501';
  END IF;

  -- id es inmutable obviamente — no debería cambiar nunca.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'cannot update users.id'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.users_block_privileged_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS users_block_privileged_update_trg ON public.users;
CREATE TRIGGER users_block_privileged_update_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_block_privileged_update();

-- ============================================================
-- 2. Recrear users_update_own con WITH CHECK defensivo.
--    El trigger ya hace el trabajo pesado, pero un WITH CHECK
--    explícito hace que el intento falle más temprano y deja
--    el intent visible para auditoría futura.
-- ============================================================

DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 3. Sanity: revoke direct privilege-bearing column grants si
--    Postgres los hubiera otorgado vía herencia. PUBLIC nunca
--    debería tener UPDATE sobre users, pero defense-in-depth.
-- ============================================================

REVOKE UPDATE ON public.users FROM PUBLIC;
REVOKE UPDATE ON public.users FROM anon;
-- authenticated necesita UPDATE para que la policy users_update_own
-- aplique. El trigger bloquea las columnas sensibles.
GRANT UPDATE ON public.users TO authenticated;
GRANT UPDATE ON public.users TO service_role;
