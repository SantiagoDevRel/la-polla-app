-- 181_rifa_privada_conserva_compradores.sql — una rifa Pública puede volver a Privada
-- sin dejar por fuera a quien ya tiene números.
--
-- Pedido del dueño (2026-11-08): ocultar la rifa de La Iguaná mientras se
-- arregla la camiseta y volverla a publicar él mismo desde Gestionar. El botón
-- «Volver a privada» ya existía, pero:
--   1. rifa_can_view no dejaba ver una Privada a nadie fuera del equipo y los
--      administradores, ni siquiera a quien ya había reservado o pagado;
--   2. por eso rifa_set_visibility_v1 bloqueaba el paso de Pública a Privada
--      con números tomados (VISIBILITY_LOCKED).
--
-- Qué cambia:
--   1. rifa_can_view: una Privada (u oculta) la sigue viendo quien tiene
--      números vivos en ella, igual que ya pasaba con una oculta. Nadie más.
--   2. rifa_set_visibility_v1: se quita VISIBILITY_LOCKED. El resto del cuerpo
--      es el vigente en producción el 2026-11-08 (157 + parche de la 158).
--
-- CREATE OR REPLACE conserva SECURITY DEFINER, search_path y los GRANT
-- (EXECUTE solo service_role desde la 157).

CREATE OR REPLACE FUNCTION public.rifa_can_view(p_rifa public.rifas, p_viewer uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_viewer IS NOT NULL AND (public.rifa_is_manager(p_rifa.id, p_viewer) OR public.rifa_is_admin(p_viewer)) THEN
    RETURN true;
  END IF;
  IF p_rifa.visibility = 'publica' AND p_rifa.hidden_at IS NULL THEN RETURN true; END IF;
  -- (181) Privada u oculta: solo la sigue viendo quien ya tiene números en ella.
  RETURN p_viewer IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = p_rifa.id AND t.buyer_id = p_viewer AND t.state <> 'liberado');
END $$;

CREATE OR REPLACE FUNCTION public.rifa_set_visibility_v1(p_actor uuid, p_rifa uuid, p_visibility text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  r := public.rifa_lock(p_rifa);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF p_visibility NOT IN ('privada', 'publica') THEN PERFORM public.rifa_fail('INVALID_VISIBILITY', NULL, '22023'); END IF;
  IF r.status <> 'abierta' THEN PERFORM public.rifa_fail('RIFA_FINISHED'); END IF;
  PERFORM public.rifa_sweep_expired(p_rifa);
  -- (181) De Pública a Privada también con números: quien los tiene la sigue viendo (rifa_can_view).
  IF p_visibility = 'publica' AND r.visibility = 'privada' AND NOT public.rifa_is_creator(r.creator_id) THEN
    PERFORM public.rifa_fail('CREATOR_REQUIRED', NULL, '42501');
  END IF;
  IF p_visibility <> r.visibility THEN
    UPDATE public.rifas SET visibility = p_visibility WHERE id = p_rifa;
    INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
    VALUES (p_rifa, p_actor, 'visibilidad', jsonb_build_object('visibility', p_visibility));
  END IF;
  RETURN jsonb_build_object('ok', true, 'visibility', p_visibility);
END $$;
