-- 136_casa_referrals_open_polla.sql — prender las invitaciones en una polla abierta.
--
-- Pedido del dueño (2026-09-17, después de la 135): el aviso y los cupos de regalo
-- tienen que valer para la polla que está abierta este domingo (POLLAGOL), que ya
-- tiene inscritos. La 135 solo dejaba prender el programa sin inscripciones.
--
-- Qué cambia: PRENDER se permite mientras la polla no haya terminado (borrador,
-- abierta o cerrada). APAGAR sigue exigiendo cero inscripciones — y ahora también
-- cero regalos y cero invitados anclados, porque apagarlo después dejaría cupos de
-- regalo vivos sin regla que los explique.
--
-- Nada retroactivo: quien ya pagó no es "persona nueva" (casa_referral_is_new_user),
-- así que nadie gana regalos por inscripciones anteriores. Solo cuentan las personas
-- que se registren desde ahora con el enlace o el código y paguen esa polla.
--
-- Regresión: scripts/casa-referrals-check.sql (bloque 13).

SET client_encoding = 'UTF8';

CREATE OR REPLACE FUNCTION public.casa_set_referral_every_v1(p_polla_id uuid, p_every integer, p_actor_id uuid, p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_every IS NOT NULL AND p_every NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERRAL_EVERY';
  END IF;
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p.referral_every IS NOT DISTINCT FROM p_every THEN
    RETURN jsonb_build_object('ok',true,'changed',false,'referral_every',p_every);
  END IF;
  IF p_every IS NOT NULL AND p.kind='rifa' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_POLLA_KIND'; END IF;
  -- Apagar: solo si nadie se inscribió (y por lo tanto no hay regalos ni conteos).
  IF p_every IS NULL AND EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_HAS_ENTRIES';
  END IF;
  UPDATE public.casa_pollas SET referral_every=p_every WHERE id=p.id;
  RETURN jsonb_build_object('ok',true,'changed',true,'referral_every',p_every);
END $$;

REVOKE ALL ON FUNCTION public.casa_set_referral_every_v1(uuid,integer,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_set_referral_every_v1(uuid,integer,uuid,integer) TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT proname, proacl FROM pg_proc WHERE proname='casa_set_referral_every_v1';  -- sin anon/authenticated
--   SELECT slug, status, referral_every FROM public.casa_pollas WHERE referral_every IS NOT NULL;
