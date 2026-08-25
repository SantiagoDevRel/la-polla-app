-- 083_casa_lock_down_grants.sql
-- ============================================================================
-- CIERRA los permisos que Supabase auto-otorga sobre lo que creó la 081/082.
--
-- El agujero: `REVOKE ... FROM PUBLIC` NO alcanza en Supabase. El proyecto
-- tiene grants por DEFAULT que le dan a `anon` y `authenticated` acceso a
-- cada tabla nueva de `public` y EXECUTE sobre cada función nueva. Revocar de
-- PUBLIC no toca esos grants directos, así que quedaron abiertos.
--
-- Lo más grave que destapó la auditoría (2026-08-25, antes del primer deploy):
--
--   `casa_settle_polla` y `casa_score_polla` eran ejecutables por cualquier
--   usuario autenticado. Son SECURITY DEFINER, o sea que corren con permisos
--   del dueño y saltan RLS. Un `POST /rest/v1/rpc/casa_settle_polla` con el
--   uuid de una polla — que se ve en la URL — repartía el pozo, escribía
--   `casa_payouts` y marcaba la polla como resuelta. Sin ser admin.
--
-- Las tablas estaban tapadas por RLS (las policies son solo de SELECT, así que
-- INSERT/UPDATE/DELETE ya caían), pero los GRANT igual sobraban: si algún día
-- alguien agrega una policy permisiva, el grant es lo que convierte un error de
-- policy en una fuga. Defense in depth = que hagan falta DOS errores, no uno.
--
-- Regla para todo lo que venga: después de crear una función o tabla en
-- `public`, revocar EXPLÍCITAMENTE de anon y authenticated. No alcanza PUBLIC.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Las funciones. Ninguna se llama desde el browser: todas se invocan desde
--    el server con la service_role key.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'casa\_%' OR p.proname = 'set_updated_at')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Las tablas. `anon` no tiene nada que hacer acá: todo pide sesión.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relname LIKE 'casa\_%' OR c.relname LIKE 'telegram\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t.relname);

    IF t.relname LIKE 'telegram\_%' THEN
      -- Las tablas del bot son service_role y nadie más. Ni leer.
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t.relname);
    ELSE
      -- El resto: `authenticated` LEE (y RLS decide qué filas). Escribir
      -- siempre pasa por el server, que valida sesión y filtra por user_id.
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated',
        t.relname);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t.relname);
    END IF;

    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t.relname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Que las tablas del bot queden con deny-all EXPLÍCITO. Tienen RLS
--    prendida y cero policies (que ya deniega), pero dejarlo escrito evita
--    que alguien "arregle" el silencio agregando una policy permisiva.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS telegram_admins_deny_all ON public.telegram_admins;
CREATE POLICY telegram_admins_deny_all ON public.telegram_admins
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS telegram_outbox_deny_all ON public.telegram_outbox;
CREATE POLICY telegram_outbox_deny_all ON public.telegram_outbox
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS telegram_auth_attempts_deny_all ON public.telegram_auth_attempts;
CREATE POLICY telegram_auth_attempts_deny_all ON public.telegram_auth_attempts
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 4. Los DEFAULT PRIVILEGES, para que la próxima tabla o función no repita
--    esto. Aplica a lo que cree el rol que corre esta migración.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
