-- 143 — Entrada gratis: te unes de un toque, sin comprobante (2026-09-18)
--
-- POLLA REGALO cuesta $0 y aun asi el flujo pedia transferir y subir el
-- pantallazo. Dos personas subieron el comprobante de una transferencia de cero
-- pesos y un administrador los aprobo a mano. Pedido del dueno: con entrada
-- gratis, tocar «Unirme» y quedar registrado.
--
-- `casa_join_free_v1` es el unico camino para eso y solo existe si la entrada
-- vale 0: si la polla cobra, la funcion falla y el flujo sigue siendo el de
-- siempre (transferencia + comprobante + aprobacion). Las validaciones son las
-- mismas que aplica la cortesia (migracion 138), que ya crea cupos gratis.
--
-- Un cupo por persona: con entrada gratis, varios cupos serian mas chances
-- regaladas. Volver a tocar «Unirme» devuelve el cupo que ya tienes, no crea
-- otro, asi que el boton es idempotente y un doble toque no duplica nada.
--
-- No se tocan las dos inscripciones que ya entraron por el flujo viejo: estan
-- pagadas y son validas.

CREATE FUNCTION public.casa_join_free_v1(p_polla_id uuid, p_user_id uuid, p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; e public.casa_entries;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AUTH_REQUIRED'; END IF;

  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;

  -- Solo entrada gratis. Una polla que cobra jamas entra por aca.
  IF p.entry_price_cop IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NOT_FREE',
      DETAIL='Esta polla tiene entrada. Debes transferir y subir el comprobante.';
  END IF;
  -- Las rifas se juegan por boleta, no por cupo.
  IF p.kind='rifa' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POLLA_KIND'; END IF;

  -- Misma ventana que la cortesia: publicada, abierta y antes del cierre.
  IF p.status<>'abierta' OR p.archived_at IS NOT NULL OR p.publication_mode='oculta'
    OR p.opens_at>clock_timestamp() OR p.closes_at<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_CLOSED',
      DETAIL='Las inscripciones de esta polla no estan abiertas.';
  END IF;

  -- Ya estas dentro: se devuelve tu cupo. Idempotente a proposito — un doble
  -- toque, un reintento o dos pestanas no pueden dejarte dos veces inscrito.
  SELECT * INTO e FROM public.casa_entries
    WHERE polla_id=p.id AND user_id=p_user_id AND status IN ('pagada','pendiente')
    ORDER BY entry_number NULLS LAST, created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'slug',p.slug,'entry_id',e.id,
      'entry_number',e.entry_number,'created',false);
  END IF;

  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number,entry_number)
    VALUES(p.id,p_user_id,'pagada',0,NULL,
      (SELECT coalesce(max(x.entry_number),0)+1 FROM public.casa_entries x
        WHERE x.polla_id=p.id AND x.user_id=p_user_id AND x.ticket_number IS NULL))
    RETURNING * INTO e;

  RETURN jsonb_build_object('ok',true,'slug',p.slug,'entry_id',e.id,
    'entry_number',e.entry_number,'created',true);
END $$;

REVOKE EXECUTE ON FUNCTION public.casa_join_free_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_join_free_v1(uuid,uuid,integer) TO service_role;
