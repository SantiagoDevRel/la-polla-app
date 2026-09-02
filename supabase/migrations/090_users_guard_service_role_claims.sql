-- 090_users_guard_service_role_claims.sql
-- (2026-09-02) El guard de la 059 puede estar bloqueando al service_role.
--
-- CONTEXTO
-- La 059 creó `users_block_privileged_update()` para que una sesión de cliente
-- no pueda subirse sola a admin. Correcto y necesario. Pero su escotilla para
-- el service_role se escribió así:
--
--   IF current_setting('request.jwt.claim.role', true) = 'service_role'
--      OR session_user IN ('postgres','supabase_admin','supabase_auth_admin')
--
-- Los dos lados son fragiles hoy:
--   · `request.jwt.claim.role` (SINGULAR "claim") es el GUC VIEJO de PostgREST.
--     Desde PostgREST 9 los claims viajan en `request.jwt.claims` — plural, y
--     como un JSON entero, no un GUC por clave. En una instalación moderna el
--     de arriba devuelve vacío.
--   · Bajo PostgREST el `session_user` es `authenticator` (se hace SET ROLE a
--     service_role despues), y `authenticator` NO está en esa lista.
--
-- Si las dos fallan, un UPDATE de is_admin hecho con la service-role key desde
-- la app revienta con 42501 — o sea que el boton de "hacer admin" del panel no
-- funcionaria, y la unica via para nombrar un administrador seguiria siendo
-- correr SQL contra produccion a mano.
--
-- CONFIRMADO CONTRA PRODUCCION (2026-09-02), no supuesto. Llamando con la
-- service-role key a traves de PostgREST, la sesion se ve asi:
--     request.jwt.claims      -> {"role":"service_role", ...}
--     request.jwt.claim.role  -> NULL          <- el GUC viejo esta muerto
--     session_user            -> authenticator <- no esta en la lista blanca
--     current_user            -> postgres      <- por ser SECURITY DEFINER
-- O sea que las DOS ramas del guard viejo fallaban: el boton de "hacer admin"
-- del panel habria devuelto 42501 siempre.
--
-- QUE HACE ESTA MIGRACION
-- Reconoce al service_role por el GUC NUEVO, sin aflojar nada mas:
--   1. `request.jwt.claims`::json ->> 'role'   <- el que de verdad llega
--   2. el GUC viejo `request.jwt.claim.role`   (compatibilidad hacia atras)
--   3. `current_user` = 'service_role'
-- Ojo con la (3): dentro de una funcion SECURITY DEFINER `current_user` es el
-- DUEÑO (postgres), no el rol de quien llama, asi que en la practica nunca se
-- cumple. Se deja como red de seguridad por si algun dia la funcion deja de ser
-- SECURITY DEFINER — pero quien hace el trabajo es la (1).
--
-- Lo que NO cambia: una sesion `authenticated` o `anon` sigue sin poder tocar
-- is_admin, whatsapp_number, whatsapp_verified ni id — para ellas el claim dice
-- "authenticated"/"anon" y caen al RAISE. El resto del cuerpo de la funcion se
-- conserva palabra por palabra.

CREATE OR REPLACE FUNCTION public.users_block_privileged_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rol text;
BEGIN
  -- Formato nuevo de PostgREST primero; si no está, el viejo.
  BEGIN
    rol := current_setting('request.jwt.claims', true)::json ->> 'role';
  EXCEPTION WHEN others THEN
    -- El GUC puede traer algo que no parsea como JSON. No es motivo para
    -- tumbar el UPDATE: se sigue con las otras dos comprobaciones.
    rol := NULL;
  END;
  IF rol IS NULL OR rol = '' THEN
    rol := current_setting('request.jwt.claim.role', true);
  END IF;

  -- Carta blanca: los syncs y los endpoints de admin corren con service_role y
  -- tienen que poder tocar todo. `current_user` cubre el SET ROLE que hace
  -- PostgREST cuando la llave es la de servicio.
  IF rol = 'service_role'
     OR current_user = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'cannot update users.is_admin from client session'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.whatsapp_number IS DISTINCT FROM OLD.whatsapp_number THEN
    RAISE EXCEPTION 'cannot update users.whatsapp_number from client session'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.whatsapp_verified IS DISTINCT FROM OLD.whatsapp_verified THEN
    RAISE EXCEPTION 'cannot update users.whatsapp_verified from client session'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'cannot update users.id'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ── Diagnostico ──────────────────────────────────────────────────────────
-- Devuelve como se ve la sesion DESDE ADENTRO de PostgREST. Existe porque la
-- pregunta "¿el service_role pasa el guard?" no se puede contestar desde la
-- Management API: esa entra por otra conexion, con otro session_user, y su
-- respuesta no dice nada sobre lo que hace la app.
-- Es de solo lectura y no toca ninguna tabla.
CREATE OR REPLACE FUNCTION public.debug_request_role()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'claims_nuevo', current_setting('request.jwt.claims', true),
    'claim_role_viejo', current_setting('request.jwt.claim.role', true),
    'current_user', current_user,
    'session_user', session_user
  );
$$;

-- Regla del repo: Supabase auto-otorga EXECUTE a anon y authenticated, asi que
-- revocar de PUBLIC no alcanza — hay que nombrarlos.
REVOKE EXECUTE ON FUNCTION public.debug_request_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_request_role() TO service_role;
