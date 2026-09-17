-- 137_casa_referrals_since.sql — las invitaciones cuentan desde que se prenden.
--
-- Hallazgo de la revisión (muse, 2026-09-18) sobre la 136: prender el programa en
-- una polla que ya tiene inscripciones no era del todo no-retroactivo. Un invitado
-- con cuenta nueva ya vinculado que pagó ANTES de prenderlo no contaba... hasta que
-- el administrador desmarcara ese pago y lo volviera a aprobar: ahí el disparador
-- veía «pagada» sin ancla y con programa activo, y lo contaba. Un desmarque de
-- rutina terminaba dando 1 de 5 hacia un cupo de regalo por un pago viejo.
--
-- Arreglo: `casa_pollas.referral_since` guarda cuándo se prendió el programa, y un
-- invitado solo ancla en esa polla si su cupo se creó desde entonces. Para las
-- pollas que nacieron con el programa, es su propia fecha de creación (todo cuenta).
--
-- También, de la misma revisión:
--   · Con inscripciones solo se puede PRENDER (de NULL a un número). Cambiar el
--     divisor (5→1) con gente adentro creaba varios regalos de golpe en la
--     siguiente aprobación; ahora se rechaza.
--   · Prender exige además que la polla no esté repartida (casa_referral_lock_unsettled).
--
-- Regresión: scripts/casa-referrals-check.sql (bloques 13 y 19).

SET client_encoding = 'UTF8';

ALTER TABLE public.casa_pollas ADD COLUMN referral_since timestamptz;
COMMENT ON COLUMN public.casa_pollas.referral_since IS
  'Desde cuándo cuentan las invitaciones en esta polla (NULL = desde que se creó).';

-- Las que ya tenían el programa nacieron con él: cuenta todo lo suyo.
DO $$ DECLARE m text;
BEGIN
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton;
  IF m='paused' THEN RAISE EXCEPTION 'Casa en pausa: reintentar la 137 fuera de la pausa'; END IF;
  IF m='v2' THEN PERFORM set_config('app.casa_contract','2',true); END IF;
  UPDATE public.casa_pollas SET referral_since=created_at
    WHERE referral_every IS NOT NULL AND referral_since IS NULL;
  PERFORM set_config('app.casa_contract','',true);
END $$;

-- ── Interruptor: prender marca desde cuándo; con inscripciones no se cambia nada más.
CREATE OR REPLACE FUNCTION public.casa_set_referral_every_v1(p_polla_id uuid, p_every integer, p_actor_id uuid, p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_every IS NOT NULL AND p_every NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERRAL_EVERY';
  END IF;
  p:=public.casa_referral_lock_unsettled(p_polla_id);
  IF p.referral_every IS NOT DISTINCT FROM p_every THEN
    RETURN jsonb_build_object('ok',true,'changed',false,'referral_every',p_every);
  END IF;
  IF p_every IS NOT NULL AND p.kind='rifa' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_POLLA_KIND'; END IF;
  -- Con inscripciones, lo único que se puede es PRENDER (de apagado a un número):
  -- apagarlo dejaría regalos sin regla, y cambiar el divisor crearía varios de golpe.
  IF (p_every IS NULL OR p.referral_every IS NOT NULL)
    AND EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_HAS_ENTRIES';
  END IF;
  UPDATE public.casa_pollas SET referral_every=p_every,
    referral_since=CASE WHEN p_every IS NULL THEN NULL ELSE coalesce(p.referral_since,clock_timestamp()) END
    WHERE id=p.id;
  RETURN jsonb_build_object('ok',true,'changed',true,'referral_every',p_every);
END $$;

-- ── Anclaje: un invitado solo cuenta en una polla si su cupo nació con el programa.
CREATE OR REPLACE FUNCTION public.casa_referral_after_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.casa_referrals; p public.casa_pollas; v_other uuid; v_other_polla uuid;
BEGIN
  IF NEW.origin<>'compra' THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.amount_cop IS NOT DISTINCT FROM OLD.amount_cop THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=NEW.user_id FOR UPDATE;
  IF r.referred_user_id IS NOT NULL AND NEW.status='pagada' AND NEW.amount_cop>0 THEN
    IF r.locked_at IS NULL THEN
      UPDATE public.casa_referrals SET locked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE referred_user_id=NEW.user_id;
      PERFORM public.casa_referral_log('bloqueo',NEW.polla_id,r.referrer_user_id,NEW.user_id,NEW.id,NULL,'{}'::jsonb);
      r.locked_at:=clock_timestamp();
    END IF;
    IF r.counted_polla_id IS NULL AND NEW.ticket_number IS NULL THEN
      SELECT * INTO p FROM public.casa_pollas WHERE id=NEW.polla_id;
      -- Cupos anteriores a que se prendiera el programa no cuentan, ni siquiera si
      -- el pago se desmarca y se vuelve a aprobar después (migración 137).
      IF public.casa_referral_every(p) IS NOT NULL
        AND NEW.created_at>=coalesce(p.referral_since,p.created_at) THEN
        UPDATE public.casa_referrals SET counted_polla_id=NEW.polla_id,counted_entry_id=NEW.id,
          counted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE referred_user_id=NEW.user_id;
        PERFORM public.casa_referral_log('conteo',NEW.polla_id,r.referrer_user_id,NEW.user_id,NEW.id,NULL,'{}'::jsonb);
        r.counted_polla_id:=NEW.polla_id;
      END IF;
    END IF;
  ELSIF r.referred_user_id IS NOT NULL AND r.counted_entry_id=NEW.id AND NEW.status IN ('rechazada','anulada') THEN
    -- Se rechazó el pago que anclaba el conteo. Desmarcar no llega aquí: vuelve a
    -- revisión y lo normal es aprobarlo otra vez, así que el ancla se queda (sin
    -- pago aprobado no cuenta). Con el rechazo, sigue contando con otro cupo pagado
    -- de esa polla; si no tiene, con su primer cupo pagado en otra polla con
    -- invitaciones y nacido con el programa (y se recuenta allá ya mismo); si
    -- tampoco, cuenta en la próxima polla donde se le apruebe un pago. El recuento
    -- de abajo usa la polla anterior (r). Recontar otra polla la bloquea también:
    -- dos rechazos cruzados al mismo tiempo pueden chocar (Postgres aborta uno y el
    -- administrador reintenta).
    SELECT e.id, e.polla_id INTO v_other, v_other_polla FROM public.casa_entries e
      JOIN public.casa_pollas q ON q.id=e.polla_id
      WHERE e.user_id=NEW.user_id AND e.id<>NEW.id AND e.origin='compra'
        AND e.status='pagada' AND e.amount_cop>0 AND e.ticket_number IS NULL
        AND (e.polla_id=NEW.polla_id OR (public.casa_referral_every(q) IS NOT NULL
          AND e.created_at>=coalesce(q.referral_since,q.created_at)))
      ORDER BY (e.polla_id<>NEW.polla_id), e.reviewed_at NULLS LAST, e.created_at, e.id
      LIMIT 1;
    UPDATE public.casa_referrals SET counted_entry_id=v_other, counted_polla_id=v_other_polla,
      counted_at=CASE WHEN v_other IS NULL THEN NULL WHEN v_other_polla=NEW.polla_id THEN counted_at
        ELSE clock_timestamp() END,
      updated_at=clock_timestamp() WHERE referred_user_id=NEW.user_id;
    IF v_other_polla IS DISTINCT FROM NEW.polla_id THEN
      PERFORM public.casa_referral_log('conteo',coalesce(v_other_polla,NEW.polla_id),r.referrer_user_id,NEW.user_id,
        coalesce(v_other,NEW.id),NULL,jsonb_build_object('desde',NEW.polla_id,'liberado',v_other IS NULL));
    END IF;
    IF v_other_polla IS NOT NULL AND v_other_polla<>NEW.polla_id THEN
      PERFORM public.casa_referral_sync(v_other_polla,r.referrer_user_id);
    END IF;
  END IF;
  -- Quien invitó a esta persona, solo en la polla donde ella cuenta.
  IF r.referred_user_id IS NOT NULL AND r.counted_polla_id=NEW.polla_id THEN
    PERFORM public.casa_referral_sync(NEW.polla_id,r.referrer_user_id);
  END IF;
  -- Esta persona como invitadora: su propio pago y su tope también cuentan.
  IF NEW.ticket_number IS NULL AND (
    EXISTS(SELECT 1 FROM public.casa_referrals x WHERE x.referrer_user_id=NEW.user_id AND x.counted_polla_id=NEW.polla_id)
    OR EXISTS(SELECT 1 FROM public.casa_entries g WHERE g.polla_id=NEW.polla_id AND g.user_id=NEW.user_id
      AND g.origin='invitacion')) THEN
    PERFORM public.casa_referral_sync(NEW.polla_id,NEW.user_id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.casa_set_referral_every_v1(uuid,integer,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_set_referral_every_v1(uuid,integer,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.casa_referral_after_entry() FROM PUBLIC, anon, authenticated, service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT slug, status, referral_every, referral_since FROM public.casa_pollas WHERE referral_every IS NOT NULL;
--   SELECT proname, proacl FROM pg_proc WHERE proname IN ('casa_set_referral_every_v1','casa_referral_after_entry');
