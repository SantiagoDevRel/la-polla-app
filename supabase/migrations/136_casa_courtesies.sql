-- 136_casa_courtesies.sql — Cortesías: cupos de regalo que reparte una persona.
--
-- Pedido del dueño (2026-09-17):
--   · SOLO el administrador crea cortesías. Busca a una persona (Carlos, Sofía),
--     elige UNA polla y le da 1..N cortesías para esa polla.
--   · Cada cortesía es un ENLACE ÚNICO que esa persona le pasa a alguien. El
--     enlace sirve UNA sola vez y se quema al usarse.
--   · Solo valen para personas NUEVAS: cuentas creadas después de que se creó
--     la cortesía y que nunca han tenido una inscripción en La Polla.
--   · Valen SOLO en la polla elegida. Quien redime una cortesía no puede redimir
--     otra nunca más, tampoco en otra polla (índice único por persona).
--   · Quien entró con cortesía puede comprar los cupos que quiera, como todos.
--   · Vencen con la polla: si nadie las redime antes del cierre de inscripciones,
--     no se trasladan a otra polla. No hay cron: el cierre lo verifica el canje.
--
-- Qué NO cambia:
--   · El pozo. Un cupo de cortesía vale $0 y casa_pot_summaries_v2 suma
--     amount_cop: entra a la tabla y compite, pero no infla el premio ni lo que
--     se lleva la casa. Igual que cualquier inscripción, cuenta en «inscritos».
--   · Nada de predictions, pronósticos de Casa, pagos, reparto ni pollas viejas.
--   · casa_entries no cambia de forma: la cortesía se reconoce por su fila en
--     casa_courtesies (entry_id), no por una columna nueva en la inscripción.
--
-- Seguridad: la tabla es de solo lectura para service_role y toda escritura pasa
-- por funciones SECURITY DEFINER con search_path fijo, contrato v2 y la polla
-- bloqueada (padre antes que hijo, como el resto de Casa).
--
-- Numeración: la 135 quedó tomada por la rama de invitaciones.
-- Regresión local: scripts/casa-courtesies-check.sql.

-- ── 1. Tabla ────────────────────────────────────────────────────────────────
CREATE TABLE public.casa_courtesies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  -- A quién se la dio el administrador: es quien reparte los enlaces.
  holder_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Lo que viaja en el enlace. 10 caracteres sin letras/números confundibles.
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'disponible'
    CHECK (status IN ('disponible','redimida','revocada')),
  granted_by uuid NOT NULL REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redeemed_by uuid REFERENCES public.users(id),
  redeemed_at timestamptz,
  -- La inscripción gratis que quedó. Sin ella no hay cortesía redimida.
  entry_id uuid REFERENCES public.casa_entries(id) ON DELETE SET NULL,
  revoked_by uuid REFERENCES public.users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT casa_courtesy_code_shape CHECK (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  CONSTRAINT casa_courtesy_state_shape CHECK (
    (status='disponible' AND redeemed_by IS NULL AND redeemed_at IS NULL AND entry_id IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status='redimida' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL AND entry_id IS NOT NULL
      AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status='revocada' AND redeemed_by IS NULL AND redeemed_at IS NULL AND entry_id IS NULL
      AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)),
  -- Nadie redime su propia cortesía.
  CONSTRAINT casa_courtesy_not_self CHECK (redeemed_by IS NULL OR redeemed_by <> holder_user_id)
);

-- Una persona redime UNA cortesía en su vida: por eso no vale para otra polla.
CREATE UNIQUE INDEX casa_courtesies_one_per_person
  ON public.casa_courtesies(redeemed_by) WHERE redeemed_by IS NOT NULL;
-- Una inscripción no puede venir de dos cortesías.
CREATE UNIQUE INDEX casa_courtesies_entry_key
  ON public.casa_courtesies(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX casa_courtesies_polla_status ON public.casa_courtesies(polla_id,status);
CREATE INDEX casa_courtesies_holder ON public.casa_courtesies(holder_user_id,polla_id);

COMMENT ON TABLE public.casa_courtesies IS
  'Cupos de cortesía (migración 136): el administrador se los da a una persona para UNA polla y ella reparte un enlace único por cada uno. Solo los redimen cuentas nuevas, una vez en la vida.';

CREATE TRIGGER set_casa_courtesies_updated_at BEFORE UPDATE ON public.casa_courtesies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.casa_courtesies ENABLE ROW LEVEL SECURITY;
-- Nadie lee esta tabla desde el cliente: la app entra con service_role y las
-- escrituras pasan por las funciones de abajo. Deny-all explícito para el
-- Security Advisor (misma forma que el resto de las tablas casa_*).
CREATE POLICY casa_courtesies_service_only ON public.casa_courtesies
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- Supabase otorga TODOS los privilegios a anon/authenticated en cada tabla nueva
-- de `public`: hay que quitarlos explícito, igual que con las funciones en las
-- migraciones 079/080. RLS ya niega todo; esto es la segunda capa.
REVOKE ALL ON public.casa_courtesies FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.casa_courtesies TO service_role;

-- ── 2. Reglas internas ──────────────────────────────────────────────────────
-- Alfabeto sin 0/O/1/I/L: el código se dicta por teléfono sin equivocarse.
CREATE FUNCTION public.casa_courtesy_new_code() RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_code text; i integer;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..10 LOOP
      v_code := v_code || substr(alphabet, 1+floor(random()*length(alphabet))::integer, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM public.casa_courtesies WHERE code=v_code);
  END LOOP;
  RETURN v_code;
END $$;

-- Lo que escribe una persona → forma canónica. Espejo de normalizeCourtesyCode()
-- en lib/casa/courtesies-shared.ts.
CREATE FUNCTION public.casa_courtesy_normalize_code(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT nullif(regexp_replace(upper(coalesce(p_code,'')),'[^A-Z0-9]','','g'),'');
$$;

-- Persona nueva: la cuenta de acceso se creó DESPUÉS de que existiera la
-- cortesía y nunca tuvo una inscripción en Casa (una 'anulada' es una subida de
-- comprobante que se cayó, no una participación). La fecha sale de auth.users:
-- public.users.created_at lo puede reescribir su dueño por la API.
-- Los administradores no redimen cortesías.
CREATE FUNCTION public.casa_courtesy_is_new_user(p_user_id uuid, p_since timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users a JOIN public.users u ON u.id=a.id
      WHERE a.id=p_user_id AND a.created_at>=p_since AND u.is_admin IS NOT TRUE)
    AND NOT EXISTS(SELECT 1 FROM public.casa_entries e
      WHERE e.user_id=p_user_id AND e.status<>'anulada')
    AND NOT EXISTS(SELECT 1 FROM public.casa_courtesies c WHERE c.redeemed_by=p_user_id);
$$;

-- ── 3. El administrador da cortesías ────────────────────────────────────────
-- Devuelve {ok:true,granted:n,codes:[…]}. Falla (no devuelve ok:false) porque
-- quien llama es el panel: cada error es una condición que el admin debe ver.
CREATE FUNCTION public.casa_grant_courtesies_v1(
  p_polla_id uuid, p_user_id uuid, p_count integer, p_actor_id uuid, p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; v_codes text[] := '{}'; v_code text; v_live integer; i integer;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id, NULL);
  IF p_count IS NULL OR p_count NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='INVALID_COUNT',
      DETAIL='Puedes dar entre 1 y 20 cortesías a la vez.';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='USER_REQUIRED', DETAIL='Elige a quién le das las cortesías.';
  END IF;
  p := public.casa_v2_lock_polla(p_polla_id);
  -- Una rifa se juega con boletas numeradas: un cupo suelto no cabe ahí.
  IF p.kind='rifa' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='COURTESY_RAFFLE',
      DETAIL='Las rifas se juegan con boletas, no admiten cortesías.';
  END IF;
  IF p.entry_price_cop<=0 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='COURTESY_FREE_POLLA',
      DETAIL='Esta polla ya es gratis: no necesita cortesías.';
  END IF;
  -- El enlace tiene que servir hoy: una polla sin publicar o cerrada no recibe
  -- inscripciones, así que la cortesía nacería vencida.
  IF p.status<>'abierta' OR p.publication_mode='oculta' OR p.opens_at>clock_timestamp()
    OR p.closes_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POLLA_NOT_OPEN',
      DETAIL='Solo puedes dar cortesías en una polla publicada y con inscripciones abiertas.';
  END IF;
  SELECT count(*) INTO v_live FROM public.casa_courtesies
    WHERE polla_id=p.id AND holder_user_id=p_user_id AND status<>'revocada';
  IF v_live+p_count>50 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='COURTESY_LIMIT',
      DETAIL='Esa persona ya llegó al tope de 50 cortesías en esta polla.';
  END IF;
  FOR i IN 1..p_count LOOP
    v_code := public.casa_courtesy_new_code();
    INSERT INTO public.casa_courtesies(polla_id,holder_user_id,code,granted_by)
      VALUES(p.id,p_user_id,v_code,p_actor_id);
    v_codes := v_codes || v_code;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'granted',p_count,'codes',to_jsonb(v_codes));
END $$;

-- Quitar una cortesía que todavía no se ha redimido. Una redimida ya es una
-- inscripción de alguien: no se toca.
CREATE FUNCTION public.casa_revoke_courtesy_v1(
  p_courtesy_id uuid, p_actor_id uuid, p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.casa_courtesies;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id, NULL);
  SELECT * INTO c FROM public.casa_courtesies WHERE id=p_courtesy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='COURTESY_NOT_FOUND';
  END IF;
  -- La polla se bloquea primero, como en toda escritura de Casa.
  PERFORM public.casa_v2_lock_polla(c.polla_id);
  SELECT * INTO c FROM public.casa_courtesies WHERE id=p_courtesy_id FOR UPDATE;
  IF c.status='redimida' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='COURTESY_USED',
      DETAIL='Esa cortesía ya la usó alguien: su cupo queda.';
  END IF;
  IF c.status='revocada' THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
  UPDATE public.casa_courtesies
    SET status='revocada', revoked_by=p_actor_id, revoked_at=clock_timestamp()
    WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'changed',true);
END $$;

-- ── 4. La persona nueva redime su enlace ────────────────────────────────────
-- Devuelve {ok:false,error:…} en vez de fallar: casi todos los casos son cosas
-- que la pantalla tiene que explicar (no eres nueva, ya la usaste, ya cerró).
CREATE FUNCTION public.casa_redeem_courtesy_v1(
  p_code text, p_user_id uuid, p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
  IF c.status='revocada' THEN
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
END $$;

-- ── 5. Lecturas ─────────────────────────────────────────────────────────────
-- Lo que ve quien abre el enlace ANTES de tener cuenta: de qué polla es y si
-- sigue sirviendo. Sin identificadores internos y sin datos de terceros más
-- allá del nombre de quien lo invitó, que es justamente lo que le compartieron.
CREATE FUNCTION public.casa_courtesy_preview_v1(p_code text, p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.casa_courtesies; p public.casa_pollas; v_code text; v_usable boolean;
BEGIN
  v_code := public.casa_courtesy_normalize_code(p_code);
  IF v_code IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.casa_courtesies WHERE code=v_code;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=c.polla_id;
  v_usable := c.status='disponible' AND p.status='abierta' AND p.archived_at IS NULL
    AND p.publication_mode<>'oculta'
    AND p.opens_at<=clock_timestamp() AND p.closes_at>clock_timestamp();
  RETURN jsonb_build_object(
    'status',c.status,
    'slug',p.slug,
    'name',p.name,
    'entry_price_cop',p.entry_price_cop,
    'holder',(SELECT display_name FROM public.users WHERE id=c.holder_user_id),
    'usable', v_usable,
    -- Con persona: si es SUYA para regalar, y si ella misma la puede activar.
    'mine', p_user_id IS NOT NULL AND c.holder_user_id=p_user_id,
    'redeemable', v_usable AND p_user_id IS NOT NULL AND c.holder_user_id<>p_user_id
      AND public.casa_courtesy_is_new_user(p_user_id, c.granted_at));
END $$;

-- Las cortesías de una persona, para la tarjeta que reparte los enlaces.
CREATE FUNCTION public.casa_my_courtesies_v1(p_user_id uuid)
RETURNS TABLE(id uuid, code text, status text, polla_id uuid, slug text, name text,
  closes_at timestamptz, polla_status text, redeemed_name text, redeemed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT c.id, c.code, c.status, p.id, p.slug::text, p.name::text, p.closes_at, p.status::text,
    u.display_name::text, c.redeemed_at
  FROM public.casa_courtesies c
  JOIN public.casa_pollas p ON p.id=c.polla_id
  LEFT JOIN public.users u ON u.id=c.redeemed_by
  WHERE c.holder_user_id=p_user_id AND c.status<>'revocada' AND p.archived_at IS NULL
  ORDER BY p.closes_at DESC, c.granted_at, c.code;
$$;

-- Lo que ve el administrador: por polla, por persona, o todo.
CREATE FUNCTION public.casa_courtesies_admin_v1(
  p_actor_id uuid, p_polla_id uuid DEFAULT NULL, p_holder_id uuid DEFAULT NULL
) RETURNS TABLE(id uuid, code text, status text, polla_id uuid, slug text, polla_name text,
  polla_status text, closes_at timestamptz, holder_id uuid, holder_name text,
  granted_at timestamptz, redeemed_name text, redeemed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.casa_v2_admin(p_actor_id, NULL);
  RETURN QUERY
    SELECT c.id, c.code, c.status, p.id, p.slug::text, p.name::text, p.status::text, p.closes_at,
      h.id, h.display_name::text, c.granted_at, r.display_name::text, c.redeemed_at
    FROM public.casa_courtesies c
    JOIN public.casa_pollas p ON p.id=c.polla_id
    JOIN public.users h ON h.id=c.holder_user_id
    LEFT JOIN public.users r ON r.id=c.redeemed_by
    WHERE (p_polla_id IS NULL OR c.polla_id=p_polla_id)
      AND (p_holder_id IS NULL OR c.holder_user_id=p_holder_id)
    ORDER BY c.granted_at DESC, c.code
    LIMIT 500;
END $$;

-- ── 6. Permisos ─────────────────────────────────────────────────────────────
-- Supabase otorga EXECUTE a anon/authenticated por defecto: hay que revocarlo
-- explícito (regla del repo, migraciones 079/080).
REVOKE ALL ON FUNCTION
  public.casa_courtesy_new_code(),
  public.casa_courtesy_normalize_code(text),
  public.casa_courtesy_is_new_user(uuid,timestamptz),
  public.casa_grant_courtesies_v1(uuid,uuid,integer,uuid,integer),
  public.casa_revoke_courtesy_v1(uuid,uuid,integer),
  public.casa_redeem_courtesy_v1(text,uuid,integer),
  public.casa_courtesy_preview_v1(text,uuid),
  public.casa_my_courtesies_v1(uuid),
  public.casa_courtesies_admin_v1(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.casa_courtesy_new_code(),
  public.casa_courtesy_normalize_code(text),
  public.casa_courtesy_is_new_user(uuid,timestamptz),
  public.casa_grant_courtesies_v1(uuid,uuid,integer,uuid,integer),
  public.casa_revoke_courtesy_v1(uuid,uuid,integer),
  public.casa_redeem_courtesy_v1(text,uuid,integer),
  public.casa_courtesy_preview_v1(text,uuid),
  public.casa_my_courtesies_v1(uuid),
  public.casa_courtesies_admin_v1(uuid,uuid,uuid)
  TO service_role;
