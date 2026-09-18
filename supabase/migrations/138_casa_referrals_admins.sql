-- 138_casa_referrals_admins.sql — los administradores también invitan.
--
-- Decisión del dueño (2026-09-18): «que le salga a los admins también, para que
-- nosotros veamos cómo funciona». La 135 los había dejado fuera (decisión mía, para
-- que la casa no se quedara con cupos pagados por los jugadores y sus enlaces no le
-- quitaran el invitado a quien lo trajo); el dueño prefiere ver la función completa
-- desde su propia cuenta.
--
-- Qué cambia: `casa_referral_can_refer` solo comprueba que la cuenta exista. Con eso
-- vuelven, para administradores, el código propio (`casa_referral_code_v1`), el
-- vínculo por enlace o código (`casa_set_referrer_v1`), la pista del enlace
-- (`casa_referral_invitee_v1`), el aviso al entrar y los cupos de regalo
-- (`casa_referral_sync`). Todo lo demás sigue igual: siguen necesitando su propio
-- cupo pagado en esa polla y solo cuentan invitados nuevos.
--
-- Para volver a excluirlos, basta con devolver el `u.is_admin IS NOT TRUE` aquí.
--
-- Regresión: scripts/casa-referrals-check.sql (bloque 17).

SET client_encoding = 'UTF8';

CREATE OR REPLACE FUNCTION public.casa_referral_can_refer(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user_id);
$$;

REVOKE ALL ON FUNCTION public.casa_referral_can_refer(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT public.casa_referral_can_refer(id) FROM public.users WHERE is_admin;   -- t
--   SELECT proname, proacl FROM pg_proc WHERE proname='casa_referral_can_refer';  -- solo el dueño
