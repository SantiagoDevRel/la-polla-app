-- 135_casa_referrals.sql — Invitaciones: un cupo de regalo por cada 5 invitados nuevos.
--
-- Reglas del dueño (2026-09-17):
--   · Cada persona tiene un código (p. ej. JUAN4821) y el enlace de Compartir lo
--     lleva. La persona invitada tiene UN solo invitador y puede corregirlo hasta
--     que se apruebe su primer pago; desde ahí queda fijo.
--   · Solo cuentan personas NUEVAS: cuentas de acceso (auth.users, que nadie
--     edita desde la app) creadas desde que se instala esta migración
--     (casa_referral_settings.accounts_since) y que no han pagado ninguna polla
--     con entrada. Las cuentas que ya existían no cuentan.
--   · Los administradores no tienen código ni ganan regalos: la casa no se
--     queda con cupos que pagan los jugadores, y sus enlaces no le quitan el
--     invitado a quien sí lo trajo.
--   · Cada invitado cuenta UNA sola vez: en la primera polla con invitaciones
--     donde se le aprueba un pago. Aunque después juegue cien pollas, no vuelve
--     a contar. Desmarcar ese pago no la mueve (vuelve a revisión); si se
--     rechaza y no le queda otro cupo pagado ahí, cuenta en su primer cupo pagado
--     de otra polla con invitaciones o, si no tiene, en la próxima donde pague.
--   · El conteo es por invitador y POR POLLA: cada `referral_every` (5) invitados
--     con pago aprobado en esa polla dan un cupo de regalo en esa misma polla. En
--     otra polla el conteo empieza de cero.
--   · El regalo aparece solo, sin el administrador, en cuanto el invitador tiene
--     un cupo pagado en esa polla; el orden no importa.
--   · El cupo de regalo vale $0 (el pozo solo suma lo que entró), compite como
--     cualquier cupo y cuenta dentro de max_entries_per_user.
--   · Los regalos se numeran en orden: el k-ésimo está activo mientras haya k
--     ganados. Si un pago se desmarca y el conteo baja, los últimos quedan en
--     pausa (conservan sus pronósticos) y vuelven si se aprueba otra vez.
--   · "Remover cupo" (administrador) anula ese regalo y le descuenta ese puesto
--     a la persona; no lo reemplaza otro. Restaurar lo devuelve si sigue ganado.
--     Ninguno de los dos se puede después del reparto.
--   · Solo pollas de partidos o preguntas con entrada mayor a $0 creadas desde
--     esta migración (DEFAULT 5), más los borradores nunca publicados y sin
--     inscripciones. Las pollas publicadas que ya existen quedan sin el programa.
--
-- Seguridad: las tablas nuevas son de solo lectura para service_role y toda
-- escritura pasa por funciones SECURITY DEFINER. Un cupo de regalo solo se crea o
-- cambia con un evento de casa_referral_events escrito en la misma transacción
-- (el patrón de casa_payment_corrections en la 105).
--
-- casa_v2_write_guard y casa_begin_entry_proof_v2/v3 se parchean con
-- needle/replacement sobre su definición VIVA (como la 105 y la 133), y fallan
-- si el texto no es el esperado. No cambian el pozo, la tabla, el reparto ni
-- ningún pronóstico existente.
--
-- Orden de despliegue: esta migración ANTES del código (las lecturas piden
-- casa_entries.origin y casa_pollas.referral_every).
-- Regresión local: scripts/casa-referrals-check.sql.

SET client_encoding = 'UTF8';

-- ── 1. Inicio del programa y columnas ───────────────────────────────────────
CREATE TABLE public.casa_referral_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  -- Solo las cuentas creadas desde este momento son "personas nuevas".
  accounts_since timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.casa_referral_settings(singleton) VALUES (true);

ALTER TABLE public.casa_entries ADD COLUMN origin text NOT NULL DEFAULT 'compra';
ALTER TABLE public.casa_entries ADD CONSTRAINT casa_entries_origin_check
  CHECK (origin IN ('compra','invitacion'));
-- Un cupo de regalo no tiene comprobante ni monto y solo está activo o en pausa.
ALTER TABLE public.casa_entries ADD CONSTRAINT casa_entries_gift_shape CHECK (
  origin='compra' OR (ticket_number IS NULL AND entry_number IS NOT NULL AND amount_cop=0
    AND proof_path IS NULL AND proof_uploaded_at IS NULL AND current_proof_attempt_id IS NULL
    AND reviewed_by IS NULL AND status IN ('pagada','anulada')));

-- Sin DEFAULT al agregarla: las pollas existentes quedan en NULL (sin programa).
ALTER TABLE public.casa_pollas ADD COLUMN referral_every smallint;
ALTER TABLE public.casa_pollas ALTER COLUMN referral_every SET DEFAULT 5;
ALTER TABLE public.casa_pollas ADD CONSTRAINT casa_pollas_referral_every_check
  CHECK (referral_every IS NULL OR referral_every BETWEEN 1 AND 50);

-- ── 2. Tablas ───────────────────────────────────────────────────────────────
CREATE TABLE public.casa_referral_codes (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{3,6}[0-9]{4,6}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Una fila por persona invitada: la clave primaria impide dos invitadores.
CREATE TABLE public.casa_referrals (
  referred_user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  referrer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  via text NOT NULL CHECK (via IN ('enlace','codigo','telegram')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Primer pago aprobado: desde aquí el invitador no cambia.
  locked_at timestamptz,
  -- La única polla donde esta persona cuenta para su invitador.
  counted_polla_id uuid REFERENCES public.casa_pollas(id) ON DELETE SET NULL,
  counted_entry_id uuid,
  counted_at timestamptz,
  CHECK (referred_user_id <> referrer_user_id),
  CHECK (counted_polla_id IS NULL OR locked_at IS NOT NULL)
);
CREATE INDEX casa_referrals_referrer_polla_idx ON public.casa_referrals(referrer_user_id, counted_polla_id);
CREATE INDEX casa_referrals_counted_polla_idx ON public.casa_referrals(counted_polla_id)
  WHERE counted_polla_id IS NOT NULL;

-- Historial. entry_id no lleva FK: el evento de un regalo nuevo se escribe antes
-- que el cupo, y el guard exige ese evento.
CREATE TABLE public.casa_referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind text NOT NULL CHECK (kind IN ('vinculo','cambio','codigo_invalido','bloqueo','conteo',
    'regalo_otorgado','regalo_pausado','regalo_reactivado','regalo_removido','regalo_restaurado')),
  polla_id uuid REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  referrer_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  referred_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  entry_id uuid,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  notified_at timestamptz
);
CREATE INDEX casa_referral_events_attempts_idx ON public.casa_referral_events(referred_user_id, created_at)
  WHERE kind='codigo_invalido';
CREATE INDEX casa_referral_events_polla_idx ON public.casa_referral_events(polla_id, referrer_user_id, created_at);
CREATE INDEX casa_referral_events_entry_idx ON public.casa_referral_events(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX casa_referral_events_notice_idx ON public.casa_referral_events(created_at)
  WHERE kind='regalo_otorgado' AND notified_at IS NULL;

-- "Remover cupo" del administrador. Mientras esté removido, ese regalo no vuelve
-- y descuenta uno de los ganados.
CREATE TABLE public.casa_referral_gift_removals (
  entry_id uuid PRIMARY KEY REFERENCES public.casa_entries(id) ON DELETE CASCADE,
  polla_id uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  restored_at timestamptz,
  restored_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX casa_referral_gift_removals_active_idx ON public.casa_referral_gift_removals(polla_id, user_id)
  WHERE restored_at IS NULL;

-- Solo el servidor lee; nadie escribe fuera de las funciones de abajo.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['casa_referral_settings','casa_referral_codes','casa_referrals',
    'casa_referral_events','casa_referral_gift_removals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t || '_deny', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ── 3. Reglas internas ──────────────────────────────────────────────────────
-- Cada cuántos invitados hay regalo en esta polla; NULL = no participa.
-- Espejo para la UI: referralEvery() en lib/casa/referrals-shared.ts.
CREATE FUNCTION public.casa_referral_every(p public.casa_pollas) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN p.referral_every IS NOT NULL AND p.kind<>'rifa' AND p.entry_price_cop>0
    THEN p.referral_every::integer END;
$$;

-- Lo que escribe una persona → forma canónica (mayúsculas, sin espacios ni guiones).
CREATE FUNCTION public.casa_referral_normalize_code(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN p_code IS NULL OR length(p_code)>40 THEN NULL
    ELSE nullif(upper(regexp_replace(p_code,'[^A-Za-z0-9]','','g')),'') END;
$$;

-- Evento que autoriza la escritura de un cupo de regalo en esta transacción.
CREATE FUNCTION public.casa_referral_sync_event() RETURNS uuid
LANGUAGE sql VOLATILE SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN coalesce(current_setting('app.casa_referral_sync',true),'')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.casa_referral_sync',true)::uuid END;
$$;

-- Persona nueva: cuenta de acceso creada desde el inicio del programa, sin ningún
-- pago aprobado (ni uno que después se haya desmarcado). La fecha sale de
-- auth.users: public.users.created_at lo puede reescribir su dueño por la API.
-- Las pollas gratis no son un pago.
CREATE FUNCTION public.casa_referral_is_new_user(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users a JOIN public.users u ON u.id=a.id
      CROSS JOIN public.casa_referral_settings s
      WHERE a.id=p_user_id AND a.created_at>=s.accounts_since)
    AND NOT EXISTS(SELECT 1 FROM public.casa_entries e
      WHERE e.user_id=p_user_id AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0)
    AND NOT EXISTS(SELECT 1 FROM public.casa_payment_corrections c
      JOIN public.casa_entries e ON e.id=c.entry_id
      WHERE e.user_id=p_user_id AND e.origin='compra' AND e.amount_cop>0);
$$;

-- Quién puede invitar: cualquier cuenta menos los administradores.
CREATE FUNCTION public.casa_referral_can_refer(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.is_admin IS NOT TRUE);
$$;

CREATE FUNCTION public.casa_referral_log(p_kind text, p_polla uuid, p_referrer uuid, p_referred uuid,
  p_entry uuid, p_actor uuid, p_detail jsonb) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  INSERT INTO public.casa_referral_events(kind,polla_id,referrer_user_id,referred_user_id,entry_id,actor_id,detail)
  VALUES(p_kind,p_polla,p_referrer,p_referred,p_entry,p_actor,coalesce(p_detail,'{}'::jsonb)) RETURNING id;
$$;

-- Lo que la pantalla muestra de quien invitó. Sin id interno.
CREATE FUNCTION public.casa_referral_person(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('name',u.display_name,'avatar',u.avatar_url,'code',c.code)
  FROM public.users u LEFT JOIN public.casa_referral_codes c ON c.user_id=u.id WHERE u.id=p_user_id;
$$;

-- ── 4. Código personal ──────────────────────────────────────────────────────
-- Letras del nombre (máximo 6, sin tildes) + 4 dígitos. Se crea una vez y no cambia.
-- Los administradores no tienen código (tampoco uno creado antes de serlo).
CREATE FUNCTION public.casa_referral_code_v1(p_user_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_code text; v_name text; v_prefix text; i integer;
BEGIN
  IF NOT public.casa_referral_can_refer(p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REFERRAL_NOT_AVAILABLE';
  END IF;
  SELECT code INTO v_code FROM public.casa_referral_codes WHERE user_id=p_user_id;
  IF FOUND THEN RETURN v_code; END IF;
  SELECT display_name INTO v_name FROM public.users
    WHERE id=p_user_id AND avatar_url IS NOT NULL AND length(btrim(coalesce(display_name,'')))>=2;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PROFILE_REQUIRED'; END IF;
  v_prefix:=left(regexp_replace(upper(public.unaccent(v_name)),'[^A-Z]','','g'),6);
  IF length(v_prefix)<3 THEN v_prefix:='POLLA'; END IF;
  FOR i IN 1..40 LOOP
    v_code:=v_prefix||CASE WHEN i<=30 THEN lpad(floor(random()*10000)::integer::text,4,'0')
      ELSE lpad(floor(random()*1000000)::integer::text,6,'0') END;
    INSERT INTO public.casa_referral_codes(user_id,code) VALUES(p_user_id,v_code) ON CONFLICT DO NOTHING;
    -- Otra pestaña pudo crearlo al mismo tiempo: gana la fila guardada.
    SELECT code INTO v_code FROM public.casa_referral_codes WHERE user_id=p_user_id;
    IF FOUND THEN RETURN v_code; END IF;
  END LOOP;
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REFERRAL_CODE_UNAVAILABLE';
END $$;

-- ── 5. Quién invitó a quién ─────────────────────────────────────────────────
-- Devuelve {ok:false,error} en vez de fallar para conservar el registro de
-- códigos inválidos (tope: 10 por hora por persona).
CREATE FUNCTION public.casa_set_referrer_v1(p_user_id uuid, p_code text, p_via text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_code text; v_referrer uuid; r public.casa_referrals; v_exists boolean; v_fails integer; v_pass integer;
BEGIN
  IF p_user_id IS NULL OR p_via IS NULL OR p_via NOT IN ('enlace','codigo','telegram') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERRAL';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('casa_referral:'||p_user_id::text,0));
  SELECT count(*) INTO v_fails FROM public.casa_referral_events
    WHERE referred_user_id=p_user_id AND kind='codigo_invalido' AND created_at>clock_timestamp()-interval '1 hour';
  IF v_fails>=10 THEN RETURN jsonb_build_object('ok',false,'error','REFERRAL_RATE_LIMITED'); END IF;
  v_code:=public.casa_referral_normalize_code(p_code);
  -- El código de un administrador no invita (ver casa_referral_can_refer).
  SELECT c.user_id INTO v_referrer FROM public.casa_referral_codes c
    WHERE c.code=v_code AND public.casa_referral_can_refer(c.user_id);
  IF v_referrer IS NULL THEN
    PERFORM public.casa_referral_log('codigo_invalido',NULL,NULL,p_user_id,NULL,p_user_id,
      jsonb_build_object('via',p_via,'length',length(coalesce(v_code,''))));
    RETURN jsonb_build_object('ok',false,'error','REFERRAL_CODE_NOT_FOUND');
  END IF;
  IF v_referrer=p_user_id THEN RETURN jsonb_build_object('ok',false,'error','SELF_REFERRAL'); END IF;
  -- Primera vuelta sin bloquear: los rechazos no esperan a nadie. La segunda
  -- bloquea en el orden de una aprobación (cupos comprados → vínculo) y repite
  -- las mismas preguntas. Los regalos no se bloquean: una aprobación puede
  -- pausarlos o reactivarlos mientras tanto.
  FOR v_pass IN 1..2 LOOP
    IF v_pass=1 THEN
      SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id;
    ELSE
      PERFORM 1 FROM public.casa_entries WHERE user_id=p_user_id AND origin='compra' FOR SHARE;
      SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id FOR UPDATE;
    END IF;
    v_exists:=FOUND;
    IF v_exists AND r.referrer_user_id=v_referrer THEN
      RETURN jsonb_build_object('ok',true,'changed',false,'locked',r.locked_at IS NOT NULL,
        'referrer',public.casa_referral_person(v_referrer));
    END IF;
    -- Abrir otro enlace nunca reemplaza a quien ya quedó; cambiarlo es escribir el código.
    IF v_exists AND p_via='enlace' THEN
      RETURN jsonb_build_object('ok',false,'error','REFERRAL_EXISTS','referrer',public.casa_referral_person(r.referrer_user_id));
    END IF;
    IF v_exists AND r.locked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'error','REFERRAL_LOCKED','referrer',public.casa_referral_person(r.referrer_user_id));
    END IF;
    IF NOT public.casa_referral_is_new_user(p_user_id) THEN
      RETURN jsonb_build_object('ok',false,'error','NOT_NEW_USER');
    END IF;
  END LOOP;
  IF v_exists THEN
    UPDATE public.casa_referrals SET referrer_user_id=v_referrer,code=v_code,via=p_via,updated_at=clock_timestamp()
      WHERE referred_user_id=p_user_id;
    PERFORM public.casa_referral_log('cambio',NULL,v_referrer,p_user_id,NULL,p_user_id,
      jsonb_build_object('via',p_via,'anterior',r.referrer_user_id));
  ELSE
    INSERT INTO public.casa_referrals(referred_user_id,referrer_user_id,code,via)
      VALUES(p_user_id,v_referrer,v_code,p_via);
    PERFORM public.casa_referral_log('vinculo',NULL,v_referrer,p_user_id,NULL,p_user_id,jsonb_build_object('via',p_via));
  END IF;
  RETURN jsonb_build_object('ok',true,'changed',true,'locked',false,'referrer',public.casa_referral_person(v_referrer));
END $$;

-- ── 6. Conteo por polla y cupos de regalo ───────────────────────────────────
-- Idempotente. Todos los llamadores ya tienen bloqueada la polla (guards de
-- casa_entries, casa_v2_lock_polla o el UPDATE de casa_pollas).
--
-- Los regalos de una persona en una polla se ordenan por número: el k-ésimo
-- está activo si k <= ganados, no está removido y cabe en el tope. Uno removido
-- conserva su puesto (así descuenta justo ese regalo, y si el conteo baja es el
-- primero en dejar de estar ganado); los que pasan de lo ganado quedan en pausa.
CREATE FUNCTION public.casa_referral_sync(p_polla_id uuid, p_referrer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; v_every integer; v_counted integer; v_owner boolean; v_earned integer;
  v_removed integer; v_slot integer:=0; v_number integer; v_entry uuid; v_event uuid; g record; v_detail jsonb;
BEGIN
  IF p_polla_id IS NULL OR p_referrer IS NULL THEN RETURN; END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND OR p.archived_at IS NOT NULL OR p.status NOT IN ('abierta','cerrada')
    OR EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN RETURN; END IF;
  v_every:=public.casa_referral_every(p);
  -- Invitados que cuentan aquí y tienen un cupo comprado y aprobado aquí.
  SELECT count(*) INTO v_counted FROM public.casa_referrals r
    WHERE r.referrer_user_id=p_referrer AND r.counted_polla_id=p.id
      AND EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=r.referred_user_id
        AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0);
  -- "Un cupo más": el invitador necesita su propio cupo pagado en esta polla.
  v_owner:=public.casa_referral_can_refer(p_referrer)
    AND EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=p_referrer
      AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0 AND e.ticket_number IS NULL);
  v_earned:=CASE WHEN v_every IS NULL OR NOT v_owner THEN 0 ELSE v_counted/v_every END;
  SELECT count(*) INTO v_removed FROM public.casa_referral_gift_removals x
    WHERE x.polla_id=p.id AND x.user_id=p_referrer AND x.restored_at IS NULL;
  v_detail:=jsonb_build_object('invitados',v_counted,'cada',v_every,'cupo_pagado',v_owner,'removidos',v_removed);

  FOR g IN SELECT e.id, e.status,
        EXISTS(SELECT 1 FROM public.casa_referral_gift_removals x WHERE x.entry_id=e.id AND x.restored_at IS NULL) AS removed
      FROM public.casa_entries e
      WHERE e.polla_id=p.id AND e.user_id=p_referrer AND e.origin='invitacion'
      ORDER BY e.entry_number FOR UPDATE OF e LOOP
    v_slot:=v_slot+1;
    IF g.status='pagada' AND (g.removed OR v_slot>v_earned) THEN
      -- Ya no está ganado (se desmarcó un pago): en pausa, con sus pronósticos.
      v_event:=public.casa_referral_log('regalo_pausado',p.id,p_referrer,NULL,g.id,NULL,v_detail);
      PERFORM set_config('app.casa_referral_sync',v_event::text,true);
      UPDATE public.casa_entries SET status='anulada',reviewed_at=NULL,
        reject_reason='Cupo de regalo en pausa: cambió el conteo de invitados.' WHERE id=g.id;
      PERFORM set_config('app.casa_referral_sync','',true);
    ELSIF g.status<>'pagada' AND NOT g.removed AND v_slot<=v_earned
      -- Tope por persona: cuentan todos sus cupos vivos, también los de regalo.
      AND (SELECT count(*) FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=p_referrer
        AND e.ticket_number IS NULL AND e.status<>'anulada')<p.max_entries_per_user THEN
      v_event:=public.casa_referral_log('regalo_reactivado',p.id,p_referrer,NULL,g.id,NULL,v_detail);
      PERFORM set_config('app.casa_referral_sync',v_event::text,true);
      UPDATE public.casa_entries SET status='pagada',reviewed_at=clock_timestamp(),reject_reason=NULL WHERE id=g.id;
      PERFORM set_config('app.casa_referral_sync','',true);
    END IF;
  END LOOP;

  -- Ganados que todavía no tienen fila: se crean mientras quepan en el tope.
  WHILE v_slot<v_earned LOOP
    EXIT WHEN (SELECT count(*) FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=p_referrer
      AND e.ticket_number IS NULL AND e.status<>'anulada')>=p.max_entries_per_user;
    SELECT coalesce(max(entry_number),0)+1 INTO v_number FROM public.casa_entries
      WHERE polla_id=p.id AND user_id=p_referrer AND ticket_number IS NULL;
    EXIT WHEN v_number>50;
    v_entry:=gen_random_uuid();
    v_event:=public.casa_referral_log('regalo_otorgado',p.id,p_referrer,NULL,v_entry,NULL,v_detail);
    PERFORM set_config('app.casa_referral_sync',v_event::text,true);
    INSERT INTO public.casa_entries(id,polla_id,user_id,status,amount_cop,entry_number,origin,reviewed_at)
      VALUES(v_entry,p.id,p_referrer,'pagada',0,v_number,'invitacion',clock_timestamp());
    PERFORM set_config('app.casa_referral_sync','',true);
    v_slot:=v_slot+1;
  END LOOP;
END $$;

-- Cada cambio de estado de un cupo comprado: bloquea el vínculo en el primer pago,
-- lo ancla en la primera polla con invitaciones y recuenta a los afectados.
CREATE FUNCTION public.casa_referral_after_entry() RETURNS trigger
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
      IF public.casa_referral_every(p) IS NOT NULL THEN
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
    -- invitaciones (y se recuenta allá ya mismo); si tampoco, cuenta en la próxima
    -- polla donde se le apruebe un pago. El recuento de abajo usa la polla anterior (r).
    -- Recontar otra polla la bloquea también: dos rechazos cruzados al mismo tiempo
    -- pueden chocar (Postgres aborta uno y el administrador reintenta).
    SELECT e.id, e.polla_id INTO v_other, v_other_polla FROM public.casa_entries e
      JOIN public.casa_pollas q ON q.id=e.polla_id
      WHERE e.user_id=NEW.user_id AND e.id<>NEW.id AND e.origin='compra'
        AND e.status='pagada' AND e.amount_cop>0 AND e.ticket_number IS NULL
        AND (e.polla_id=NEW.polla_id OR public.casa_referral_every(q) IS NOT NULL)
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
CREATE TRIGGER casa_zz_referral_sync AFTER INSERT OR UPDATE OF status, amount_cop ON public.casa_entries
  FOR EACH ROW EXECUTE FUNCTION public.casa_referral_after_entry();

-- Subir el tope libera espacio para un regalo que estaba esperando.
CREATE FUNCTION public.casa_referral_after_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid;
BEGIN
  IF NEW.max_entries_per_user IS NOT DISTINCT FROM OLD.max_entries_per_user THEN RETURN NULL; END IF;
  FOR u IN SELECT DISTINCT r.referrer_user_id FROM public.casa_referrals r
      WHERE r.counted_polla_id=NEW.id ORDER BY 1 LOOP
    PERFORM public.casa_referral_sync(NEW.id,u);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER casa_zz_referral_cap AFTER UPDATE OF max_entries_per_user ON public.casa_pollas
  FOR EACH ROW EXECUTE FUNCTION public.casa_referral_after_cap();

-- Un cupo de regalo solo se crea o cambia con su evento; el origen nunca cambia.
CREATE FUNCTION public.casa_referral_entry_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.origin IS DISTINCT FROM OLD.origin THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ENTRY_ORIGIN_IMMUTABLE';
  END IF;
  IF NEW.origin='compra' THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.casa_referral_events v
      WHERE v.id=public.casa_referral_sync_event() AND v.entry_id=NEW.id
        AND v.polla_id=NEW.polla_id AND v.referrer_user_id=NEW.user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='REFERRAL_ENTRY_LOCKED';
  END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','reviewed_at','reject_reason','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_at','reject_reason','updated_at']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='REFERRAL_ENTRY_LOCKED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER casa_02_referral_guard BEFORE INSERT OR UPDATE ON public.casa_entries
  FOR EACH ROW EXECUTE FUNCTION public.casa_referral_entry_guard();

-- ── 7. Administración ───────────────────────────────────────────────────────
-- Remover o restaurar un regalo cambia la tabla: igual que desmarcar un pago
-- (casa_unpay_attempt_v2), no se permite después del reparto.
CREATE FUNCTION public.casa_referral_lock_unsettled(p_polla_id uuid) RETURNS public.casa_pollas
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p.status NOT IN ('abierta','cerrada') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_FINAL'; END IF;
  IF p.settled_at IS NOT NULL OR p.settlement_outcome IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED';
  END IF;
  RETURN p;
END $$;

CREATE FUNCTION public.casa_referral_remove_gift_v1(p_entry_id uuid, p_reason text, p_actor_id uuid, p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries; p public.casa_pollas; v_event uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REASON';
  END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=p_entry_id;
  IF NOT FOUND OR e.origin<>'invitacion' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GIFT_NOT_FOUND'; END IF;
  p:=public.casa_referral_lock_unsettled(e.polla_id);
  SELECT * INTO e FROM public.casa_entries WHERE id=p_entry_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.casa_referral_gift_removals WHERE entry_id=e.id AND restored_at IS NULL) THEN
    RETURN jsonb_build_object('ok',true,'changed',false,'entry_id',e.id,'polla_id',e.polla_id);
  END IF;
  INSERT INTO public.casa_referral_gift_removals(entry_id,polla_id,user_id,removed_by,reason)
    VALUES(e.id,e.polla_id,e.user_id,p_actor_id,btrim(p_reason))
    ON CONFLICT(entry_id) DO UPDATE SET removed_at=clock_timestamp(),removed_by=EXCLUDED.removed_by,
      reason=EXCLUDED.reason,restored_at=NULL,restored_by=NULL;
  v_event:=public.casa_referral_log('regalo_removido',e.polla_id,e.user_id,NULL,e.id,p_actor_id,
    jsonb_build_object('motivo',btrim(p_reason),'estado',e.status));
  IF e.status='pagada' THEN
    PERFORM set_config('app.casa_referral_sync',v_event::text,true);
    UPDATE public.casa_entries SET status='anulada',reviewed_at=NULL,
      reject_reason=left('Removido por el administrador: '||btrim(p_reason),240) WHERE id=e.id;
    PERFORM set_config('app.casa_referral_sync','',true);
  END IF;
  PERFORM public.casa_referral_sync(e.polla_id,e.user_id);
  RETURN jsonb_build_object('ok',true,'changed',true,'entry_id',e.id,'polla_id',e.polla_id);
END $$;

CREATE FUNCTION public.casa_referral_restore_gift_v1(p_entry_id uuid, p_actor_id uuid, p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries; p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT * INTO e FROM public.casa_entries WHERE id=p_entry_id;
  IF NOT FOUND OR e.origin<>'invitacion' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GIFT_NOT_FOUND'; END IF;
  p:=public.casa_referral_lock_unsettled(e.polla_id);
  UPDATE public.casa_referral_gift_removals SET restored_at=clock_timestamp(),restored_by=p_actor_id
    WHERE entry_id=e.id AND restored_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',true,'changed',false,'entry_id',e.id,'polla_id',e.polla_id);
  END IF;
  PERFORM public.casa_referral_log('regalo_restaurado',e.polla_id,e.user_id,NULL,e.id,p_actor_id,'{}'::jsonb);
  -- Vuelve solo si el conteo y el tope lo permiten.
  PERFORM public.casa_referral_sync(e.polla_id,e.user_id);
  RETURN jsonb_build_object('ok',true,'changed',true,'entry_id',e.id,'polla_id',e.polla_id,
    'active',(SELECT status='pagada' FROM public.casa_entries WHERE id=e.id));
END $$;

-- Activar o apagar el programa en una polla: solo mientras no tenga inscripciones.
CREATE FUNCTION public.casa_set_referral_every_v1(p_polla_id uuid, p_every integer, p_actor_id uuid, p_contract integer)
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
  IF EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_HAS_ENTRIES';
  END IF;
  UPDATE public.casa_pollas SET referral_every=p_every WHERE id=p.id;
  RETURN jsonb_build_object('ok',true,'changed',true,'referral_every',p_every);
END $$;

-- Cupos de regalo de una polla, para el panel.
CREATE FUNCTION public.casa_referral_gifts_admin_v1(p_polla_id uuid, p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.name, g.entry_number) FROM (
    SELECT e.id AS entry_id, e.entry_number, e.status::text AS status, u.display_name AS name,
      e.reviewed_at AS active_since, x.removed_at, x.reason AS removed_reason, x.restored_at,
      (SELECT count(*) FROM public.casa_referrals r WHERE r.referrer_user_id=e.user_id AND r.counted_polla_id=e.polla_id
        AND EXISTS(SELECT 1 FROM public.casa_entries i WHERE i.polla_id=e.polla_id AND i.user_id=r.referred_user_id
          AND i.origin='compra' AND i.status='pagada' AND i.amount_cop>0))::integer AS invitados,
      -- Los mismos invitados que el número de arriba.
      (SELECT coalesce(jsonb_agg(v.display_name ORDER BY r.counted_at),'[]'::jsonb) FROM public.casa_referrals r
        JOIN public.users v ON v.id=r.referred_user_id
        WHERE r.referrer_user_id=e.user_id AND r.counted_polla_id=e.polla_id
          AND EXISTS(SELECT 1 FROM public.casa_entries i WHERE i.polla_id=e.polla_id AND i.user_id=r.referred_user_id
            AND i.origin='compra' AND i.status='pagada' AND i.amount_cop>0)) AS nombres
    FROM public.casa_entries e
    JOIN public.users u ON u.id=e.user_id
    LEFT JOIN public.casa_referral_gift_removals x ON x.entry_id=e.id
    WHERE e.polla_id=p_polla_id AND e.origin='invitacion') g),'[]'::jsonb);
END $$;

-- Avisos de regalo pendientes: cada evento se reclama una sola vez.
CREATE FUNCTION public.casa_referral_claim_gift_notices_v1(p_limit integer DEFAULT 20)
RETURNS TABLE(event_id uuid, polla_id uuid, user_id uuid, entry_id uuid, detail jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE public.casa_referral_events v SET notified_at=clock_timestamp()
  WHERE v.id IN (SELECT q.id FROM public.casa_referral_events q
    WHERE q.kind='regalo_otorgado' AND q.notified_at IS NULL AND q.created_at>clock_timestamp()-interval '2 days'
    ORDER BY q.created_at LIMIT least(greatest(coalesce(p_limit,20),1),50) FOR UPDATE SKIP LOCKED)
  RETURNING v.id, v.polla_id, v.referrer_user_id, v.entry_id, v.detail;
$$;

-- ── 8. Lecturas para las pantallas ──────────────────────────────────────────
-- Polla vista por una persona: su código (se crea la primera vez), su avance
-- como invitadora y, si todavía puede, quién la invitó.
CREATE FUNCTION public.casa_referral_polla_view_v1(p_user_id uuid, p_polla_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; v_every integer; v_code text; v_counted integer:=0; v_review integer:=0;
  v_owner boolean:=false; v_active integer:=0; v_removed integer:=0; v_removed_in integer:=0; v_live integer:=0;
  v_earned integer:=0; r public.casa_referrals;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED'; END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;
  v_every:=public.casa_referral_every(p);
  BEGIN v_code:=public.casa_referral_code_v1(p_user_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_code:=NULL; END;
  IF v_every IS NOT NULL THEN
    SELECT count(*) INTO v_counted FROM public.casa_referrals x
      WHERE x.referrer_user_id=p_user_id AND x.counted_polla_id=p.id
        AND EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=x.referred_user_id
          AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0);
    -- Invitados con comprobante en revisión aquí: todavía no cuentan.
    SELECT count(*) INTO v_review FROM public.casa_referrals x
      WHERE x.referrer_user_id=p_user_id AND x.counted_polla_id IS NULL
        AND EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=x.referred_user_id
          AND e.origin='compra' AND e.status='pendiente' AND e.proof_path IS NOT NULL);
    v_owner:=EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id AND e.user_id=p_user_id
      AND e.origin='compra' AND e.status='pagada' AND e.amount_cop>0 AND e.ticket_number IS NULL);
    SELECT count(*) INTO v_active FROM public.casa_entries e
      WHERE e.polla_id=p.id AND e.user_id=p_user_id AND e.origin='invitacion' AND e.status='pagada';
    SELECT count(*) INTO v_removed FROM public.casa_referral_gift_removals x
      WHERE x.polla_id=p.id AND x.user_id=p_user_id AND x.restored_at IS NULL;
    SELECT count(*) INTO v_live FROM public.casa_entries e
      WHERE e.polla_id=p.id AND e.user_id=p_user_id AND e.ticket_number IS NULL AND e.status<>'anulada';
    v_earned:=v_counted/v_every;
    -- Removidos dentro de los puestos ganados: esos regalos ya no valen (casa_referral_sync).
    SELECT count(*) INTO v_removed_in FROM (SELECT e.id FROM public.casa_entries e
        WHERE e.polla_id=p.id AND e.user_id=p_user_id AND e.origin='invitacion'
        ORDER BY e.entry_number LIMIT v_earned) z
      WHERE EXISTS(SELECT 1 FROM public.casa_referral_gift_removals x WHERE x.entry_id=z.id AND x.restored_at IS NULL);
  END IF;
  SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id;
  RETURN jsonb_build_object(
    'code',v_code,
    'every',v_every,
    'counted',v_counted,
    'in_review',v_review,
    'earned',v_earned,
    -- Ganados que valen (sin los removidos) y los que esperan tu pago o espacio.
    'gifts',greatest(v_earned-v_removed_in,0),
    'waiting_gifts',greatest(v_earned-v_removed_in-v_active,0),
    'active_gifts',v_active,
    'removed_gifts',v_removed,
    'owner_paid',v_owner,
    'slots_left',greatest(p.max_entries_per_user-v_live,0),
    'referrer',CASE WHEN r.referred_user_id IS NULL THEN NULL ELSE public.casa_referral_person(r.referrer_user_id) END,
    'referrer_locked',r.locked_at IS NOT NULL,
    'can_set_referrer',(r.locked_at IS NULL AND public.casa_referral_is_new_user(p_user_id)));
END $$;

-- Persona invitada: quién la invitó y, si todavía puede elegir, a quién apunta
-- el código del enlace que abrió (p_hint). Solo lectura.
CREATE FUNCTION public.casa_referral_invitee_v1(p_user_id uuid, p_hint text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.casa_referrals; v_can boolean; v_hint uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED'; END IF;
  SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id;
  v_can:=r.locked_at IS NULL AND public.casa_referral_is_new_user(p_user_id);
  IF v_can AND p_hint IS NOT NULL THEN
    SELECT c.user_id INTO v_hint FROM public.casa_referral_codes c
      WHERE c.code=public.casa_referral_normalize_code(p_hint) AND c.user_id<>p_user_id
        AND public.casa_referral_can_refer(c.user_id);
  END IF;
  RETURN jsonb_build_object(
    'can_set_referrer',v_can,
    'referrer',CASE WHEN r.referred_user_id IS NULL THEN NULL ELSE public.casa_referral_person(r.referrer_user_id) END,
    'referrer_locked',r.locked_at IS NOT NULL,
    'hint',CASE WHEN v_hint IS NULL OR v_hint IS NOT DISTINCT FROM r.referrer_user_id THEN NULL
      ELSE public.casa_referral_person(v_hint) END);
END $$;

-- Perfil: código propio, cuántas personas invitó y quién la invitó.
CREATE FUNCTION public.casa_referral_profile_v1(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_code text; r public.casa_referrals;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED'; END IF;
  BEGIN v_code:=public.casa_referral_code_v1(p_user_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_code:=NULL; END;
  SELECT * INTO r FROM public.casa_referrals WHERE referred_user_id=p_user_id;
  RETURN jsonb_build_object('code',v_code,
    'invited',(SELECT count(*) FROM public.casa_referrals WHERE referrer_user_id=p_user_id),
    'counted',(SELECT count(*) FROM public.casa_referrals WHERE referrer_user_id=p_user_id AND counted_polla_id IS NOT NULL),
    'gifts',(SELECT count(*) FROM public.casa_entries WHERE user_id=p_user_id AND origin='invitacion' AND status='pagada'),
    'referrer',CASE WHEN r.referred_user_id IS NULL THEN NULL ELSE public.casa_referral_person(r.referrer_user_id) END,
    'referrer_locked',r.locked_at IS NOT NULL,
    'can_set_referrer',(r.locked_at IS NULL AND public.casa_referral_is_new_user(p_user_id)));
END $$;

-- ── 9. Parches sobre las definiciones vivas ─────────────────────────────────
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
  -- 9a. casa_v2_write_guard: un cupo de regalo pagado solo cambia con su evento.
  SELECT replace(pg_get_functiondef('public.casa_v2_write_guard()'::regprocedure),chr(13),'') INTO definition;
  needle:=replace($n$      IF OLD.status='pagada' AND NEW IS DISTINCT FROM OLD THEN
$n$,chr(13),'');
  replacement:=needle||replace($r$        -- Migración 135: un cupo de regalo no tiene comprobante; solo lo cambia
        -- el conteo de invitaciones, con su evento en esta misma transacción.
        IF OLD.origin='invitacion' THEN
          IF EXISTS(SELECT 1 FROM public.casa_referral_events v
            WHERE v.id=public.casa_referral_sync_event() AND v.entry_id=OLD.id) THEN RETURN NEW; END IF;
          RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REFERRAL_ENTRY_LOCKED';
        END IF;
$r$,chr(13),'');
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'casa_v2_write_guard differs from the expected baseline; inspect before applying 135';
  END IF;
  EXECUTE replace(definition,needle,replacement);

  -- 9b. casa_begin_entry_proof_v3: un cupo de regalo no recibe comprobante y uno
  --     en pausa o removido nunca se reusa como compra.
  SELECT replace(pg_get_functiondef('public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer)'::regprocedure),chr(13),'')
    INTO definition;
  needle:=replace($n$  ELSIF p_entry_number IS NOT NULL THEN
$n$,chr(13),'');
  replacement:=replace($r$  ELSIF p_entry_number IS NOT NULL AND EXISTS(SELECT 1 FROM public.casa_entries g WHERE g.polla_id=p.id
      AND g.user_id=p_user_id AND g.ticket_number IS NULL AND g.entry_number=p_entry_number AND g.origin<>'compra') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GIFT_ENTRY',DETAIL='Ese cupo es de regalo: no necesita comprobante.';
$r$,chr(13),'')||needle;
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'casa_begin_entry_proof_v3 (numbered entry) differs from the expected baseline; inspect before applying 135';
  END IF;
  definition:=replace(definition,needle,replacement);
  needle:='      WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL AND entry_number=p_entry_number FOR UPDATE;';
  replacement:='      WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL AND entry_number=p_entry_number AND origin=''compra'' FOR UPDATE;';
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'casa_begin_entry_proof_v3 (entry lookup) differs from the expected baseline; inspect before applying 135';
  END IF;
  definition:=replace(definition,needle,replacement);
  needle:='        WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL AND status=''anulada''';
  replacement:=needle||' AND origin=''compra''';
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'casa_begin_entry_proof_v3 (failed upload reuse) differs from the expected baseline; inspect before applying 135';
  END IF;
  EXECUTE replace(definition,needle,replacement);

  -- 9c. casa_begin_entry_proof_v2 (bot y clientes viejos): elige solo cupos comprados.
  SELECT replace(pg_get_functiondef('public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer)'::regprocedure),chr(13),'')
    INTO definition;
  needle:='        WHERE e.polla_id=p_polla_id AND e.user_id=p_user_id AND e.ticket_number IS NULL';
  replacement:=needle||' AND e.origin=''compra''';
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'casa_begin_entry_proof_v2 differs from the expected baseline; inspect before applying 135';
  END IF;
  EXECUTE replace(definition,needle,replacement);

  -- 9d. casa_my_entry_v2 se redefine entera: verificar que prod sigue siendo la de la 131.
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
      WHERE oid='public.casa_my_entry_v2(uuid,uuid)'::regprocedure)<>'4f9efa68b228adaf791d9e16b29dfbec' THEN
    RAISE EXCEPTION 'casa_my_entry_v2 differs from migration 131; inspect before applying 135';
  END IF;
END $$;

-- La participación "principal" (web con una sola inscripción y bot) prefiere un
-- cupo comprado y nunca devuelve un regalo en pausa.
CREATE OR REPLACE FUNCTION public.casa_my_entry_v2(p_polla_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('id',id,'polla_id',polla_id,'user_id',user_id,'status',status,
    'amount_cop',amount_cop,'proof_path',proof_path,'current_proof_attempt_id',current_proof_attempt_id,
    'proof_uploaded_at',proof_uploaded_at,'reviewed_at',reviewed_at,'reject_reason',reject_reason,
    'ticket_number',ticket_number,'entry_number',entry_number,'origin',origin,'created_at',created_at)
  FROM public.casa_entries WHERE polla_id=p_polla_id AND user_id=p_user_id
    AND NOT (origin='invitacion' AND status<>'pagada')
  ORDER BY CASE status WHEN 'pagada' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'rechazada' THEN 2 ELSE 3 END,
    (origin<>'compra'),entry_number NULLS LAST,created_at DESC,id LIMIT 1;
$$;

-- ── 10. Borradores ──────────────────────────────────────────────────────────
-- Un borrador que nunca se publicó no tiene jugadores ni reglas en curso: queda
-- con el programa, como una polla nueva (la próxima OFIGOLAZO puede salir de uno).
DO $$ DECLARE m text;
BEGIN
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton;
  IF m='paused' THEN
    RAISE NOTICE 'Casa en pausa: los borradores quedan sin invitaciones (actívalas desde el editor)';
    RETURN;
  END IF;
  IF m='v2' THEN PERFORM set_config('app.casa_contract','2',true); END IF;
  UPDATE public.casa_pollas p SET referral_every=5
    WHERE p.status='borrador' AND p.archived_at IS NULL AND p.referral_every IS NULL
      AND p.kind<>'rifa' AND p.entry_price_cop>0
      AND NOT EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id);
  PERFORM set_config('app.casa_contract','',true);
END $$;

-- ── 11. Permisos ────────────────────────────────────────────────────────────
-- Internas: solo el dueño (las ejecutan triggers y funciones SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.casa_referral_every(public.casa_pollas),
  public.casa_referral_normalize_code(text),
  public.casa_referral_sync_event(),
  public.casa_referral_is_new_user(uuid),
  public.casa_referral_can_refer(uuid),
  public.casa_referral_lock_unsettled(uuid),
  public.casa_referral_log(text,uuid,uuid,uuid,uuid,uuid,jsonb),
  public.casa_referral_person(uuid),
  public.casa_referral_sync(uuid,uuid),
  public.casa_referral_after_entry(),
  public.casa_referral_after_cap(),
  public.casa_referral_entry_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- Para el servidor de la app.
REVOKE ALL ON FUNCTION public.casa_referral_code_v1(uuid),
  public.casa_set_referrer_v1(uuid,text,text),
  public.casa_referral_remove_gift_v1(uuid,text,uuid,integer),
  public.casa_referral_restore_gift_v1(uuid,uuid,integer),
  public.casa_set_referral_every_v1(uuid,integer,uuid,integer),
  public.casa_referral_gifts_admin_v1(uuid,uuid),
  public.casa_referral_claim_gift_notices_v1(integer),
  public.casa_referral_polla_view_v1(uuid,uuid),
  public.casa_referral_invitee_v1(uuid,text),
  public.casa_referral_profile_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_referral_code_v1(uuid),
  public.casa_set_referrer_v1(uuid,text,text),
  public.casa_referral_remove_gift_v1(uuid,text,uuid,integer),
  public.casa_referral_restore_gift_v1(uuid,uuid,integer),
  public.casa_set_referral_every_v1(uuid,integer,uuid,integer),
  public.casa_referral_gifts_admin_v1(uuid,uuid),
  public.casa_referral_claim_gift_notices_v1(integer),
  public.casa_referral_polla_view_v1(uuid,uuid),
  public.casa_referral_invitee_v1(uuid,text),
  public.casa_referral_profile_v1(uuid)
  TO service_role;

-- Las redefinidas conservan su ACL; se reafirma como en la 133.
REVOKE ALL ON FUNCTION public.casa_v2_write_guard(),
  public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer),
  public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer),
  public.casa_my_entry_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_v2_write_guard(),
  public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer),
  public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer),
  public.casa_my_entry_v2(uuid,uuid)
  TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT count(*) FROM public.casa_entries WHERE origin<>'compra';                  -- 0
--   SELECT count(*) FROM public.casa_pollas WHERE referral_every IS NOT NULL
--     AND status<>'borrador';                                                        -- 0
--   SELECT proname, proacl FROM pg_proc WHERE proname LIKE 'casa_referral%'
--     OR proname IN ('casa_set_referrer_v1','casa_set_referral_every_v1');           -- sin anon/authenticated
--   SELECT relname, relacl FROM pg_class WHERE relname LIKE 'casa_referral%';          -- service_role solo r
