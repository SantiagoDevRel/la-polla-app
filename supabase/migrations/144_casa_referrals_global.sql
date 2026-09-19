-- 144_casa_referrals_global.sql — invitaciones: el conteo es de la persona, no de la polla.
--
-- Pedido del dueño (2026-09-19): «no tiene sentido tener mi código en Perfil si
-- esos 5 cupos dan un cupo en una polla específica… por cada 5 referidos EN TOTAL
-- (y que cada referido haya participado en una polla PAGA) te damos un cupo gratis
-- en cualquier polla».
--
-- Qué cambia frente a la 135:
--   · El conteo es GLOBAL por invitador: cada `casa_referral_settings.every` (5)
--     invitados que cuentan dan un cupo gratis. Antes era por polla y empezaba de
--     cero en cada una.
--   · El cupo ya no aparece solo en la polla donde se completó el conteo: queda
--     como SALDO y la persona lo usa en la polla que quiera
--     (`casa_referral_redeem_v1`). Decisión mía, delegada por el dueño: entrar
--     solo a «la próxima polla» obligaba a adivinar cuál y podía gastar el cupo
--     en una polla que la persona no iba a jugar.
--   · Ya no hace falta tener un cupo pagado propio para recibirlo.
--
-- Qué NO cambia (las dos reglas que el dueño pidió mantener):
--   1. Solo cuenta quien entró con el código o el enlace (`casa_set_referrer_v1`,
--      personas nuevas, un solo invitador).
--   2. Solo cuenta un pago APROBADO mayor a $0 en una polla con entrada: las
--      pollas gratis, las cortesías ($0) y las rifas no cuentan
--      (`casa_referral_every` + `amount_cop>0`, igual que antes). Cada invitado
--      cuenta una sola vez, en la primera polla donde se le aprueba un pago.
--
-- `casa_pollas.referral_every` queda como interruptor por polla (NULL = fuera del
-- programa): los pagos de esa polla no cuentan y el cupo gratis no se puede usar
-- ahí. El divisor ya no sale de la polla sino de `casa_referral_settings.every`.
--
-- Si un pago se desmarca y el conteo baja, los cupos gratis más recientes en
-- pollas sin repartir quedan en pausa (conservan sus pronósticos) y vuelven si se
-- aprueba otra vez — la misma regla de la 135, ahora entre pollas. Un cupo que el
-- administrador removió sigue descontando; uno usado en una polla anulada se
-- devuelve al saldo.
--
-- Estado de producción al escribirla: 11 vínculos, 4 invitados contando (todos en
-- POLLAGOL), 0 cupos de regalo. Nadie pierde nada: los 4 siguen contando igual.
--
-- `casa_referral_sync(uuid,uuid)` conserva la firma (el primer argumento ya solo
-- indica qué polla tiene bloqueada quien llama) para no tocar
-- `casa_referral_after_entry`, `casa_referral_remove_gift_v1` ni
-- `casa_referral_restore_gift_v1`, que la llaman.
--
-- Orden de despliegue: esta migración ANTES del código. Las lecturas conservan las
-- llaves que lee el código anterior, así que la ventana entre los dos es segura.
-- Regresión local: scripts/casa-referrals-check.sql.

SET client_encoding = 'UTF8';

-- ── 0. La base tiene que ser la que se leyó al escribir esto ────────────────
DO $$ DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('casa_referral_sync','d699200785ad1d5988f90fac905ada57'),
      ('casa_referral_after_cap','485546fb484320ee16ef9fef84226d8d'),
      ('casa_referral_after_entry','d20c842ea2c5d5342051ff8ffe9b5835'),
      ('casa_referral_profile_v1','05eefb71072d56cba27c191464bb1b7b'),
      ('casa_referral_polla_view_v1','5c20eacdf3c2409ac7dd0e0957d25258'),
      ('casa_referral_gifts_admin_v1','2772e7887bd76fb432fac044a1666d42')) AS t(name,hash) LOOP
    IF (SELECT md5(replace(p.prosrc,chr(13),'')) FROM pg_proc p
        WHERE p.pronamespace='public'::regnamespace AND p.proname=f.name)<>f.hash THEN
      RAISE EXCEPTION '% differs from the expected baseline; inspect before applying 144', f.name;
    END IF;
  END LOOP;
END $$;

-- ── 1. Divisor global y aviso de cupo ganado ────────────────────────────────
ALTER TABLE public.casa_referral_settings ADD COLUMN every smallint NOT NULL DEFAULT 5
  CONSTRAINT casa_referral_settings_every_check CHECK (every BETWEEN 1 AND 50);
COMMENT ON COLUMN public.casa_referral_settings.every IS
  'Cada cuántos invitados que cuentan hay un cupo gratis (global, migración 144).';

-- Un evento por cada cupo ganado por primera vez: de ahí sale el aviso.
ALTER TABLE public.casa_referral_events DROP CONSTRAINT casa_referral_events_kind_check;
ALTER TABLE public.casa_referral_events ADD CONSTRAINT casa_referral_events_kind_check
  CHECK (kind IN ('vinculo','cambio','codigo_invalido','bloqueo','conteo','cupo_ganado',
    'regalo_otorgado','regalo_pausado','regalo_reactivado','regalo_removido','regalo_restaurado'));
CREATE INDEX casa_referral_events_credit_idx ON public.casa_referral_events(referrer_user_id)
  WHERE kind='cupo_ganado';
CREATE INDEX casa_referral_events_credit_notice_idx ON public.casa_referral_events(created_at)
  WHERE kind='cupo_ganado' AND notified_at IS NULL;

-- ── 2. Reglas internas ──────────────────────────────────────────────────────
-- Polla donde un cupo gratis todavía puede cambiar: en juego y sin repartir.
CREATE FUNCTION public.casa_referral_polla_live(p_polla_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.casa_pollas p WHERE p.id=p_polla_id AND p.archived_at IS NULL
      AND p.status IN ('abierta','cerrada') AND p.settled_at IS NULL AND p.settlement_outcome IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p_polla_id)
    AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p_polla_id);
$$;

-- Los cupos gratis de una persona, en fila. Cada uno ocupa un PUESTO por orden
-- de canje y vale mientras su puesto <= cupos ganados: la regla de la 135, ahora
-- entre pollas. Ocupan puesto los activos (también en pollas ya repartidas), los
-- que removió el administrador (así descuentan justo ese cupo) y los que están en
-- pausa en una polla sin repartir (vuelven si el conteo sube). No ocupan puesto
-- los de una polla anulada ni los que quedaron en pausa cuando su polla terminó.
CREATE FUNCTION public.casa_referral_gift_slots(p_user_id uuid)
RETURNS TABLE(entry_id uuid, polla_id uuid, status public.casa_entry_status, removed boolean, live boolean, slot integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT z.id, z.polla_id, z.status, z.removed, z.live,
    (row_number() OVER (ORDER BY z.granted_at, z.id))::integer
  FROM (SELECT e.id, e.polla_id, e.status, x.entry_id IS NOT NULL AS removed,
      public.casa_referral_polla_live(e.polla_id) AS live,
      -- El evento usa el reloj real; created_at es el inicio de la transacción.
      coalesce((SELECT min(v.created_at) FROM public.casa_referral_events v
        WHERE v.entry_id=e.id AND v.kind='regalo_otorgado'),e.created_at) AS granted_at
    FROM public.casa_entries e
    JOIN public.casa_pollas p ON p.id=e.polla_id
    LEFT JOIN public.casa_referral_gift_removals x ON x.entry_id=e.id AND x.restored_at IS NULL
    WHERE e.user_id=p_user_id AND e.origin='invitacion' AND p.status<>'anulada') z
  WHERE z.removed OR z.status='pagada' OR z.live;
$$;

-- El saldo de una persona. Única cuenta: la leen el recuento, el canje y las pantallas.
--   counted   invitados con su pago aprobado (>$0) en la polla donde cuentan
--   earned    counted / every
--   used      puestos ocupados (casa_referral_gift_slots)
--   available lo que puede usar hoy
CREATE FUNCTION public.casa_referral_balance(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH s AS (SELECT every::integer AS every FROM public.casa_referral_settings WHERE singleton),
  c AS (SELECT count(*)::integer AS counted FROM public.casa_referrals r
    WHERE r.referrer_user_id=p_user_id AND r.counted_polla_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=r.counted_polla_id
        AND e.user_id=r.referred_user_id AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0)),
  g AS (SELECT count(*)::integer AS used FROM public.casa_referral_gift_slots(p_user_id))
  SELECT jsonb_build_object('every',s.every,'counted',c.counted,'earned',c.counted/s.every,
    'used',g.used,'available',greatest(c.counted/s.every-g.used,0))
  FROM s, c, g;
$$;

-- ── 3. Recuento global ──────────────────────────────────────────────────────
-- Idempotente. Ya no crea cupos (eso es el canje): avisa los ganados, pone en
-- pausa los que quedaron por encima de lo ganado si el conteo bajó (conservan sus
-- pronósticos) y reactiva los que vuelven a estar ganados.
--
-- p_polla_id es la polla que ya tiene bloqueada quien llama. Un cupo gratis puede
-- estar en OTRA polla: antes de tocarlo se bloquea esa polla (padre antes que
-- hijo, como exige casa_v2_write_guard). Dos recuentos cruzados al mismo tiempo
-- pueden chocar; Postgres aborta uno y la operación se reintenta.
CREATE OR REPLACE FUNCTION public.casa_referral_sync(p_polla_id uuid, p_referrer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b jsonb; v_earned integer; v_announced integer; v_event uuid; v_detail jsonb;
  v_status public.casa_entry_status; g record; q public.casa_pollas;
BEGIN
  IF p_referrer IS NULL THEN RETURN; END IF;
  -- Un solo recuento o canje por persona a la vez.
  PERFORM pg_advisory_xact_lock(hashtextextended('casa_referral_credit:'||p_referrer::text,0));
  b:=public.casa_referral_balance(p_referrer);
  v_earned:=(b->>'earned')::integer;
  v_detail:=jsonb_build_object('invitados',b->'counted','cada',b->'every','ganados',v_earned);

  -- Aviso: una vez por cada cupo, aunque el conteo baje y vuelva a subir.
  SELECT count(*) INTO v_announced FROM public.casa_referral_events
    WHERE kind='cupo_ganado' AND referrer_user_id=p_referrer;
  WHILE v_announced<v_earned LOOP
    v_announced:=v_announced+1;
    PERFORM public.casa_referral_log('cupo_ganado',NULL,p_referrer,NULL,NULL,NULL,
      v_detail||jsonb_build_object('numero',v_announced));
  END LOOP;

  FOR g IN SELECT * FROM public.casa_referral_gift_slots(p_referrer) z
      WHERE z.live AND NOT z.removed ORDER BY z.slot LOOP
    CONTINUE WHEN (g.status='pagada')=(g.slot<=v_earned);
    SELECT * INTO q FROM public.casa_pollas WHERE id=g.polla_id FOR UPDATE;
    SELECT status INTO v_status FROM public.casa_entries WHERE id=g.entry_id FOR UPDATE;
    CONTINUE WHEN v_status IS DISTINCT FROM g.status OR NOT public.casa_referral_polla_live(g.polla_id);
    IF g.status='pagada' THEN
      -- Ya no está ganado (se desmarcó un pago): en pausa, con sus pronósticos.
      v_event:=public.casa_referral_log('regalo_pausado',g.polla_id,p_referrer,NULL,g.entry_id,NULL,v_detail);
      PERFORM set_config('app.casa_referral_sync',v_event::text,true);
      UPDATE public.casa_entries SET status='anulada',reviewed_at=NULL,
        reject_reason='Cupo gratis en pausa: cambió el conteo de invitados.' WHERE id=g.entry_id;
      PERFORM set_config('app.casa_referral_sync','',true);
    -- Tope por persona: cuentan todos sus cupos vivos, también los gratis.
    ELSIF (SELECT count(*) FROM public.casa_entries e WHERE e.polla_id=q.id AND e.user_id=p_referrer
        AND e.ticket_number IS NULL AND e.status<>'anulada')<q.max_entries_per_user THEN
      v_event:=public.casa_referral_log('regalo_reactivado',g.polla_id,p_referrer,NULL,g.entry_id,NULL,v_detail);
      PERFORM set_config('app.casa_referral_sync',v_event::text,true);
      UPDATE public.casa_entries SET status='pagada',reviewed_at=clock_timestamp(),reject_reason=NULL WHERE id=g.entry_id;
      PERFORM set_config('app.casa_referral_sync','',true);
    END IF;
  END LOOP;
END $$;

-- Subir el tope libera espacio para un cupo gratis que estaba esperando en esa polla.
CREATE OR REPLACE FUNCTION public.casa_referral_after_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid;
BEGIN
  IF NEW.max_entries_per_user IS NOT DISTINCT FROM OLD.max_entries_per_user THEN RETURN NULL; END IF;
  FOR u IN SELECT DISTINCT e.user_id FROM public.casa_entries e
      WHERE e.polla_id=NEW.id AND e.origin='invitacion' ORDER BY 1 LOOP
    PERFORM public.casa_referral_sync(NEW.id,u);
  END LOOP;
  RETURN NULL;
END $$;

-- ── 4. Usar el cupo gratis ──────────────────────────────────────────────────
-- La persona elige la polla. Misma ventana que una entrada gratis (143): publicada,
-- abierta y antes del cierre. Solo en pollas del programa (con entrada, no rifas).
CREATE FUNCTION public.casa_referral_redeem_v1(p_polla_id uuid, p_user_id uuid, p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; e public.casa_entries; b jsonb; v_number integer; v_entry uuid; v_event uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='AUTH_REQUIRED';
  END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;
  IF public.casa_referral_every(p) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FREE_ENTRY_NOT_ALLOWED';
  END IF;
  IF p.status<>'abierta' OR p.archived_at IS NOT NULL OR p.publication_mode='oculta'
    OR p.opens_at>clock_timestamp() OR p.closes_at<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('casa_referral_credit:'||p_user_id::text,0));

  -- Doble toque o reintento: el canje de hace un instante se devuelve, no se repite.
  -- (El evento lleva el reloj real; created_at del cupo es el inicio de la transacción.)
  SELECT n.* INTO e FROM public.casa_referral_events v
    JOIN public.casa_entries n ON n.id=v.entry_id AND n.status='pagada'
    WHERE v.kind='regalo_otorgado' AND v.polla_id=p.id AND v.referrer_user_id=p_user_id
      AND v.created_at>clock_timestamp()-interval '15 seconds'
    ORDER BY v.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'slug',p.slug,'entry_id',e.id,'entry_number',e.entry_number,'created',false);
  END IF;

  b:=public.casa_referral_balance(p_user_id);
  IF (b->>'available')::integer<=0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_FREE_ENTRY'; END IF;
  SELECT coalesce(max(entry_number),0)+1 INTO v_number FROM public.casa_entries
    WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL;
  IF v_number>50 OR (SELECT count(*) FROM public.casa_entries x WHERE x.polla_id=p.id AND x.user_id=p_user_id
      AND x.ticket_number IS NULL AND x.status<>'anulada')>=p.max_entries_per_user THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MAX_ENTRIES',
      DETAIL='Llegaste al máximo de cupos para esta polla.';
  END IF;

  v_entry:=gen_random_uuid();
  v_event:=public.casa_referral_log('regalo_otorgado',p.id,p_user_id,NULL,v_entry,p_user_id,
    b||jsonb_build_object('canje',true));
  PERFORM set_config('app.casa_referral_sync',v_event::text,true);
  INSERT INTO public.casa_entries(id,polla_id,user_id,status,amount_cop,entry_number,origin,reviewed_at)
    VALUES(v_entry,p.id,p_user_id,'pagada',0,v_number,'invitacion',clock_timestamp());
  PERFORM set_config('app.casa_referral_sync','',true);
  RETURN jsonb_build_object('ok',true,'slug',p.slug,'entry_id',v_entry,'entry_number',v_number,'created',true,
    'available',(b->>'available')::integer-1);
END $$;

-- ── 5. Avisos de cupo ganado: cada evento se reclama una sola vez ───────────
-- Función nueva (la de la 135 reclamaba los regalos por polla y el código
-- desplegado durante la ventana de despliegue la sigue llamando sin efecto).
CREATE FUNCTION public.casa_referral_claim_credit_notices_v1(p_limit integer DEFAULT 20)
RETURNS TABLE(event_id uuid, user_id uuid, detail jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE public.casa_referral_events v SET notified_at=clock_timestamp()
  WHERE v.id IN (SELECT q.id FROM public.casa_referral_events q
    WHERE q.kind='cupo_ganado' AND q.notified_at IS NULL AND q.created_at>clock_timestamp()-interval '2 days'
    ORDER BY q.created_at LIMIT least(greatest(coalesce(p_limit,20),1),50) FOR UPDATE SKIP LOCKED)
  RETURNING v.id, v.referrer_user_id, v.detail;
$$;

-- ── 6. Lecturas para las pantallas ──────────────────────────────────────────
-- Invitados de esta persona con comprobante en revisión (todavía no cuentan).
CREATE FUNCTION public.casa_referral_in_review(p_user_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT count(*)::integer FROM public.casa_referrals x
  WHERE x.referrer_user_id=p_user_id
    AND NOT EXISTS(SELECT 1 FROM public.casa_entries e WHERE x.counted_polla_id IS NOT NULL
      AND e.polla_id=x.counted_polla_id AND e.user_id=x.referred_user_id
      AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0)
    AND EXISTS(SELECT 1 FROM public.casa_entries e JOIN public.casa_pollas q ON q.id=e.polla_id
      WHERE e.user_id=x.referred_user_id AND e.origin='compra' AND e.status='pendiente'
        AND e.proof_path IS NOT NULL AND e.ticket_number IS NULL
        AND public.casa_referral_every(q) IS NOT NULL);
$$;

-- Polla vista por una persona. Las cifras de avance son GLOBALES; de la polla
-- salen solo si participa, si el cupo gratis se puede usar aquí y cuántos hay.
-- Conserva las llaves de la 135 (gifts, waiting_gifts, owner_paid) para el código
-- desplegado durante la ventana de despliegue.
CREATE OR REPLACE FUNCTION public.casa_referral_polla_view_v1(p_user_id uuid, p_polla_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; v_on boolean; v_code text; b jsonb; v_active integer:=0; v_removed integer:=0;
  v_live integer:=0; v_open boolean; r public.casa_referrals;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED'; END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;
  v_on:=public.casa_referral_every(p) IS NOT NULL;
  BEGIN v_code:=public.casa_referral_code_v1(p_user_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_code:=NULL; END;
  b:=public.casa_referral_balance(p_user_id);
  SELECT count(*) INTO v_active FROM public.casa_entries e
    WHERE e.polla_id=p.id AND e.user_id=p_user_id AND e.origin='invitacion' AND e.status='pagada';
  SELECT count(*) INTO v_removed FROM public.casa_referral_gift_removals x
    WHERE x.polla_id=p.id AND x.user_id=p_user_id AND x.restored_at IS NULL;
  SELECT count(*) INTO v_live FROM public.casa_entries e
    WHERE e.polla_id=p.id AND e.user_id=p_user_id AND e.ticket_number IS NULL AND e.status<>'anulada';
  v_open:=p.status='abierta' AND p.archived_at IS NULL AND p.publication_mode<>'oculta'
    AND p.opens_at<=clock_timestamp() AND p.closes_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id);
  SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id;
  RETURN jsonb_build_object(
    'code',v_code,
    'every',CASE WHEN v_on THEN (b->>'every')::integer END,
    'counted',(b->>'counted')::integer,
    'in_review',public.casa_referral_in_review(p_user_id),
    'earned',(b->>'earned')::integer,
    'used',(b->>'used')::integer,
    'available',(b->>'available')::integer,
    -- El cupo gratis se puede usar en esta polla ahora mismo.
    'can_redeem',(v_on AND v_open AND (b->>'available')::integer>0 AND v_live<p.max_entries_per_user),
    'active_gifts',v_active,
    'removed_gifts',v_removed,
    'slots_left',greatest(p.max_entries_per_user-v_live,0),
    -- Llaves de la 135. waiting_gifts: ganados que esperan espacio en el tope de esta polla.
    'gifts',(b->>'earned')::integer,
    'waiting_gifts',(SELECT count(*) FROM public.casa_referral_gift_slots(p_user_id) z
      WHERE z.polla_id=p.id AND z.status<>'pagada' AND NOT z.removed AND z.slot<=(b->>'earned')::integer),
    'owner_paid',true,
    'referrer',CASE WHEN r.referred_user_id IS NULL THEN NULL ELSE public.casa_referral_person(r.referrer_user_id) END,
    'referrer_locked',r.locked_at IS NOT NULL,
    'can_set_referrer',(r.locked_at IS NULL AND public.casa_referral_is_new_user(p_user_id)));
END $$;

-- Perfil: código propio, avance global, saldo y quién la invitó.
CREATE OR REPLACE FUNCTION public.casa_referral_profile_v1(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_code text; r public.casa_referrals; b jsonb;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED'; END IF;
  BEGIN v_code:=public.casa_referral_code_v1(p_user_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_code:=NULL; END;
  SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id;
  b:=public.casa_referral_balance(p_user_id);
  RETURN jsonb_build_object('code',v_code,
    'invited',(SELECT count(*) FROM public.casa_referrals WHERE referrer_user_id=p_user_id),
    'every',(b->>'every')::integer,
    'counted',(b->>'counted')::integer,
    'in_review',public.casa_referral_in_review(p_user_id),
    'earned',(b->>'earned')::integer,
    'used',(b->>'used')::integer,
    'available',(b->>'available')::integer,
    'gifts',(SELECT count(*) FROM public.casa_entries WHERE user_id=p_user_id AND origin='invitacion' AND status='pagada'),
    'referrer',CASE WHEN r.referred_user_id IS NULL THEN NULL ELSE public.casa_referral_person(r.referrer_user_id) END,
    'referrer_locked',r.locked_at IS NOT NULL,
    'can_set_referrer',(r.locked_at IS NULL AND public.casa_referral_is_new_user(p_user_id)));
END $$;

-- Cupos gratis de una polla, para el panel. Los invitados son los de la persona
-- en total (el conteo ya no es por polla).
CREATE OR REPLACE FUNCTION public.casa_referral_gifts_admin_v1(p_polla_id uuid, p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.name, g.entry_number) FROM (
    SELECT e.id AS entry_id, e.entry_number, e.status::text AS status, u.display_name AS name,
      e.reviewed_at AS active_since, x.removed_at, x.reason AS removed_reason, x.restored_at,
      (public.casa_referral_balance(e.user_id)->>'counted')::integer AS invitados,
      -- Los mismos invitados que el número de arriba.
      (SELECT coalesce(jsonb_agg(v.display_name ORDER BY r.counted_at),'[]'::jsonb) FROM public.casa_referrals r
        JOIN public.users v ON v.id=r.referred_user_id
        WHERE r.referrer_user_id=e.user_id AND r.counted_polla_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM public.casa_entries i WHERE i.polla_id=r.counted_polla_id AND i.user_id=r.referred_user_id
            AND i.origin='compra' AND i.status='pagada' AND i.amount_cop>0)) AS nombres
    FROM public.casa_entries e
    JOIN public.users u ON u.id=e.user_id
    LEFT JOIN public.casa_referral_gift_removals x ON x.entry_id=e.id
    WHERE e.polla_id=p_polla_id AND e.origin='invitacion') g),'[]'::jsonb);
END $$;

-- ── 7. Permisos ─────────────────────────────────────────────────────────────
-- Internas: solo el dueño. Supabase le da EXECUTE a anon y authenticated en cada
-- función nueva: se revoca explícito.
REVOKE ALL ON FUNCTION public.casa_referral_polla_live(uuid),
  public.casa_referral_gift_slots(uuid),
  public.casa_referral_balance(uuid),
  public.casa_referral_in_review(uuid),
  public.casa_referral_sync(uuid,uuid),
  public.casa_referral_after_cap()
  FROM PUBLIC, anon, authenticated, service_role;

-- Para el servidor de la app.
REVOKE ALL ON FUNCTION public.casa_referral_redeem_v1(uuid,uuid,integer),
  public.casa_referral_claim_credit_notices_v1(integer),
  public.casa_referral_polla_view_v1(uuid,uuid),
  public.casa_referral_profile_v1(uuid),
  public.casa_referral_gifts_admin_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_referral_redeem_v1(uuid,uuid,integer),
  public.casa_referral_claim_credit_notices_v1(integer),
  public.casa_referral_polla_view_v1(uuid,uuid),
  public.casa_referral_profile_v1(uuid),
  public.casa_referral_gifts_admin_v1(uuid,uuid)
  TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT every FROM public.casa_referral_settings;                                   -- 5
--   SELECT proname, proacl FROM pg_proc WHERE proname IN ('casa_referral_redeem_v1',
--     'casa_referral_balance','casa_referral_claim_credit_notices_v1');                -- sin anon/authenticated
--   SELECT r.referrer_user_id, public.casa_referral_balance(r.referrer_user_id)
--     FROM public.casa_referrals r GROUP BY 1;                                         -- los conteos de antes
