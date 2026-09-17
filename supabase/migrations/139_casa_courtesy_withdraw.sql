-- 139_casa_courtesy_withdraw.sql — Quitar un cupo de cortesía ya usado.
--
-- Lo que faltaba (auditoría del 2026-09-17): una cortesía redimida era
-- definitiva. Si alguien conseguía el enlace de otro, o una cuenta entraba a la
-- polla sin derecho, el administrador NO tenía por dónde sacarla: `retirar`
-- rechazaba con COURTESY_USED y las rutas de pagos exigen un comprobante que un
-- cupo gratis nunca tuvo. La única salida era SQL a mano. Las invitaciones
-- (migración 135) sí podían quitar su regalo; las cortesías no.
--
-- Ahora `retirar` también sirve después de usada: anula la inscripción gratis y
-- deja la cortesía en el estado nuevo `retirada`, que CONSERVA a quién se la
-- dio y cuál era su cupo. Eso importa: el índice de una-por-persona se apoya en
-- `redeemed_by`, así que esa cuenta tampoco puede ir a buscar otra cortesía.
-- No se borra nada.
--
-- De paso, dos asperezas de la misma auditoría:
--   · la vista previa del enlace decía "sirve" durante el desempate de un
--     premio objeto, y al activar salía "ya cerró";
--   · dos enlaces de dos pollas activados a la vez dejaban al perdedor con un
--     error genérico en vez de decirle que ya había usado la suya.

-- ── Estado nuevo ────────────────────────────────────────────────────────────
ALTER TABLE public.casa_courtesies DROP CONSTRAINT casa_courtesies_status_check;
ALTER TABLE public.casa_courtesies ADD CONSTRAINT casa_courtesies_status_check
  CHECK (status IN ('disponible','redimida','revocada','retirada'));

ALTER TABLE public.casa_courtesies DROP CONSTRAINT casa_courtesy_state_shape;
ALTER TABLE public.casa_courtesies ADD CONSTRAINT casa_courtesy_state_shape CHECK (
  (status='disponible' AND redeemed_by IS NULL AND redeemed_at IS NULL AND entry_id IS NULL
    AND revoked_by IS NULL AND revoked_at IS NULL)
  OR (status='redimida' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL AND entry_id IS NOT NULL
    AND revoked_by IS NULL AND revoked_at IS NULL)
  OR (status='revocada' AND redeemed_by IS NULL AND redeemed_at IS NULL AND entry_id IS NULL
    AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  -- Usada y después quitada: queda el rastro completo de quién la usó.
  OR (status='retirada' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL
    AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL));

-- ── El guardián deja anular un cupo de cortesía, y a nadie más ──────────────
-- `casa_v2_write_guard` blinda toda inscripción ya pagada: sin comprobante ni
-- corrección de pago, no se toca (ALREADY_PAID). Un cupo de cortesía no tiene
-- comprobante que corregir, así que necesita su propia puerta, igual que el
-- regalo por invitar tiene la suya (135). La puerta se abre SOLO cuando la
-- transacción trae el testigo que pone casa_revoke_courtesy_v1 y ese testigo es
-- la cortesía que apunta a esa misma inscripción.
--
-- Se parchea sobre la definición VIGENTE (como la 105 y la 133), no se redefine
-- la función: así no se pisa ningún cambio anterior. Si el fragmento esperado no
-- está, la migración se detiene.
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.casa_v2_write_guard()'::regprocedure) INTO definition;
  definition:=replace(definition,chr(13),'');
  needle := $needle$          RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REFERRAL_ENTRY_LOCKED';
        END IF;$needle$;
  replacement := $replacement$          RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REFERRAL_ENTRY_LOCKED';
        END IF;
        -- Migración 137: el cupo de cortesía ($0, sin comprobante) lo anula solo
        -- casa_revoke_courtesy_v1, con su testigo en esta misma transacción.
        IF OLD.amount_cop=0 AND OLD.proof_path IS NULL AND NEW.status='anulada'
          AND EXISTS(SELECT 1 FROM public.casa_courtesies c
            WHERE c.entry_id=OLD.id
              AND c.id::text=current_setting('app.casa_courtesy_withdraw',true))
        THEN RETURN NEW; END IF;$replacement$;
  IF position(needle IN definition)=0 THEN
    RAISE EXCEPTION 'El guard de casa_entries cambió: revisar antes de aplicar la 139';
  END IF;
  EXECUTE replace(definition,needle,replacement);
END $$;

-- ── Retirar, antes o después de usarse ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.casa_revoke_courtesy_v1(
  p_courtesy_id uuid, p_actor_id uuid, p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE c public.casa_courtesies; e public.casa_entries;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id, NULL);
  SELECT * INTO c FROM public.casa_courtesies WHERE id=p_courtesy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='COURTESY_NOT_FOUND';
  END IF;
  -- La polla se bloquea primero, como en toda escritura de Casa. Rechaza
  -- resuelta, anulada y archivada: una polla repartida ya no se toca.
  PERFORM public.casa_v2_lock_polla(c.polla_id);
  SELECT * INTO c FROM public.casa_courtesies WHERE id=p_courtesy_id FOR UPDATE;
  IF c.status IN ('revocada','retirada') THEN
    RETURN jsonb_build_object('ok',true,'changed',false,'status',c.status);
  END IF;
  IF c.status='redimida' THEN
    -- Nada de quitar un cupo cuando la plata ya se repartió.
    IF EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=c.polla_id) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='ALREADY_SETTLED';
    END IF;
    SELECT * INTO e FROM public.casa_entries WHERE id=c.entry_id FOR UPDATE;
    IF FOUND AND e.status<>'anulada' THEN
      -- El testigo dura lo que dura la transacción y solo abre la puerta de
      -- ESTA cortesía sobre ESTA inscripción.
      PERFORM set_config('app.casa_courtesy_withdraw', c.id::text, true);
      UPDATE public.casa_entries
        SET status='anulada', reviewed_at=NULL,
            reject_reason='Cupo de cortesía retirado por el administrador.'
        WHERE id=e.id;
      PERFORM set_config('app.casa_courtesy_withdraw', '', true);
    END IF;
    UPDATE public.casa_courtesies
      SET status='retirada', revoked_by=p_actor_id, revoked_at=clock_timestamp()
      WHERE id=c.id;
    RETURN jsonb_build_object('ok',true,'changed',true,'status','retirada','entry_id',c.entry_id);
  END IF;
  UPDATE public.casa_courtesies
    SET status='revocada', revoked_by=p_actor_id, revoked_at=clock_timestamp()
    WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'changed',true,'status','revocada');
END $fn$;

-- ── La vista previa cuenta lo mismo que el canje ────────────────────────────
CREATE OR REPLACE FUNCTION public.casa_courtesy_preview_v1(p_code text, p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE c public.casa_courtesies; p public.casa_pollas; v_code text; v_usable boolean;
BEGIN
  v_code := public.casa_courtesy_normalize_code(p_code);
  IF v_code IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.casa_courtesies WHERE code=v_code;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=c.polla_id;
  v_usable := c.status='disponible' AND p.status='abierta' AND p.archived_at IS NULL
    AND p.publication_mode<>'oculta'
    AND p.opens_at<=clock_timestamp() AND p.closes_at>clock_timestamp()
    -- Con un desempate de premio objeto en curso el canje ya decía "vencida":
    -- prometerlo acá mandaba a la persona a crear una cuenta para nada.
    AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id);
  RETURN jsonb_build_object(
    'status',c.status,
    'slug',p.slug,
    'name',p.name,
    'entry_price_cop',p.entry_price_cop,
    'holder',(SELECT display_name FROM public.users WHERE id=c.holder_user_id),
    'usable', v_usable,
    'mine', p_user_id IS NOT NULL AND c.holder_user_id=p_user_id,
    'redeemable', v_usable AND p_user_id IS NOT NULL AND c.holder_user_id<>p_user_id
      AND public.casa_courtesy_is_new_user(p_user_id, c.granted_at));
END $fn$;

-- ── Dos enlaces a la vez: el perdedor recibe el motivo, no un error suelto ──
CREATE OR REPLACE FUNCTION public.casa_redeem_courtesy_v1(
  p_code text, p_user_id uuid, p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE c public.casa_courtesies; p public.casa_pollas; v_code text; e public.casa_entries;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  v_code := public.casa_courtesy_normalize_code(p_code);
  IF v_code IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_NOT_FOUND');
  END IF;
  SELECT * INTO c FROM public.casa_courtesies WHERE code=v_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','COURTESY_NOT_FOUND'); END IF;
  -- Padre antes que hijo: la polla, después la cortesía. No se usa
  -- casa_v2_lock_polla porque una polla terminada no es un error acá: es una
  -- cortesía vencida, y la pantalla lo dice con el nombre de la polla.
  SELECT * INTO p FROM public.casa_pollas WHERE id=c.polla_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','COURTESY_NOT_FOUND'); END IF;
  SELECT * INTO c FROM public.casa_courtesies WHERE id=c.id FOR UPDATE;
  IF c.status='redimida' THEN
    RETURN jsonb_build_object('ok',false,'error',
      CASE WHEN c.redeemed_by=p_user_id THEN 'COURTESY_MINE' ELSE 'COURTESY_USED' END,'slug',p.slug);
  END IF;
  IF c.status IN ('revocada','retirada') THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_REVOKED','slug',p.slug);
  END IF;
  IF c.holder_user_id=p_user_id THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_SELF','slug',p.slug);
  END IF;
  -- Vence con la polla: publicada, abierta, sin archivar, sin desempate en curso
  -- y antes del cierre de inscripciones.
  IF p.status<>'abierta' OR p.archived_at IS NOT NULL OR p.publication_mode='oculta'
    OR p.opens_at>clock_timestamp() OR p.closes_at<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_EXPIRED','slug',p.slug);
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_courtesies WHERE redeemed_by=p_user_id) THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_ALREADY_REDEEMED','slug',p.slug);
  END IF;
  IF NOT public.casa_courtesy_is_new_user(p_user_id, c.granted_at) THEN
    RETURN jsonb_build_object('ok',false,'error','NOT_NEW_USER','slug',p.slug);
  END IF;
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number,entry_number)
    VALUES(p.id,p_user_id,'pagada',0,NULL,
      (SELECT coalesce(max(x.entry_number),0)+1 FROM public.casa_entries x
        WHERE x.polla_id=p.id AND x.user_id=p_user_id AND x.ticket_number IS NULL))
    RETURNING * INTO e;
  UPDATE public.casa_courtesies
    SET status='redimida', redeemed_by=p_user_id, redeemed_at=clock_timestamp(), entry_id=e.id
    WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'slug',p.slug,'polla',p.name,
    'entry_id',e.id,'entry_number',e.entry_number);
-- Dos códigos de DOS pollas activados en el mismo instante no comparten
-- bloqueo: los dos pasan el chequeo de arriba y el índice de una-por-persona
-- corta al segundo. Sin esto, esa persona veía un error sin explicación.
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'error','COURTESY_ALREADY_REDEEMED','slug',p.slug);
END $fn$;

-- Las cortesías que ve quien las reparte: una retirada ya no es suya.
CREATE OR REPLACE FUNCTION public.casa_my_courtesies_v1(p_user_id uuid)
RETURNS TABLE(id uuid, code text, status text, polla_id uuid, slug text, name text,
  closes_at timestamptz, polla_status text, redeemed_name text, redeemed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT c.id, c.code, c.status, p.id, p.slug::text, p.name::text, p.closes_at, p.status::text,
    u.display_name::text, c.redeemed_at
  FROM public.casa_courtesies c
  JOIN public.casa_pollas p ON p.id=c.polla_id
  LEFT JOIN public.users u ON u.id=c.redeemed_by
  WHERE c.holder_user_id=p_user_id AND c.status NOT IN ('revocada','retirada')
    AND p.archived_at IS NULL
  ORDER BY p.closes_at DESC, c.granted_at, c.code;
$fn$;

-- Los permisos no cambian: CREATE OR REPLACE conserva el ACL de cada función y
-- las firmas son las mismas. Solo service_role las ejecuta.
