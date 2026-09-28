-- 158_rifa_coadministradores.sql
--
-- Coadministradores de una rifa (pedido del dueño, 28-sep): quien creó la rifa
-- puede sumar a otra persona para que la opere con él (revisar comprobantes,
-- ventas por fuera, imagen, resultado). El dinero sigue yendo a la cuenta que
-- el creador puso en la rifa; el coadministrador no cambia eso.
--
--   * Solo el creador agrega o quita coadministradores, por celular.
--   * El coadministrador tiene los mismos permisos de operación que el creador
--     (rifa_require_owner), ve la rifa aunque sea Privada y no puede comprar.
--   * Se suma a «Mis rifas» del coadministrador.
--   * Publicar (Privada → Pública) exige que el CREADOR siga habilitado,
--     opere quien opere (auditoría codex, 29-sep).
--   * Nadie del equipo tiene números: ni por la app ni por venta por fuera a
--     su celular.
--
-- Enlaces legibles (pedido del dueño): /rifa/iphone-6 en vez de /rifa/mwrikpci.
-- Se arma del nombre, sin tildes, y si ya existe se le agrega -2, -3…
-- Los enlaces de 8 caracteres ya creados siguen funcionando.
--
-- Las funciones de la 157 se redefinen completas (rifa_require_owner,
-- rifa_can_view) o con reemplazo puntual fail-closed (reserva, vista pública,
-- mis rifas), como hicieron la 105 y la 133: si el texto buscado no está, la
-- migración aborta en vez de dejar la función a medias.

BEGIN;

CREATE TABLE public.rifa_managers (
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES public.users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rifa_id, user_id)
);
CREATE INDEX rifa_managers_user_idx ON public.rifa_managers (user_id);
COMMENT ON TABLE public.rifa_managers IS
  'Coadministradores de una rifa: operan la rifa igual que el creador. El dinero sigue yendo a la cuenta del creador.';

ALTER TABLE public.rifa_managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rifa_managers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rifa_managers TO service_role;
CREATE POLICY rifa_managers_deny_clients ON public.rifa_managers FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ¿Opera esta rifa? El creador o un coadministrador.
CREATE OR REPLACE FUNCTION public.rifa_is_manager(p_rifa uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.rifas r WHERE r.id = p_rifa AND r.creator_id = p_user)
    OR EXISTS (SELECT 1 FROM public.rifa_managers m WHERE m.rifa_id = p_rifa AND m.user_id = p_user))
$$;

CREATE OR REPLACE FUNCTION public.rifa_require_owner(p_rifa public.rifas, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL OR NOT public.rifa_is_manager(p_rifa.id, p_actor) THEN
    PERFORM public.rifa_fail('CREATOR_ONLY', NULL, '42501');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rifa_can_view(p_rifa public.rifas, p_viewer uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_viewer IS NOT NULL AND (public.rifa_is_manager(p_rifa.id, p_viewer) OR public.rifa_is_admin(p_viewer)) THEN
    RETURN true;
  END IF;
  IF p_rifa.visibility <> 'publica' THEN RETURN false; END IF;
  IF p_rifa.hidden_at IS NULL THEN RETURN true; END IF;
  RETURN p_viewer IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = p_rifa.id AND t.buyer_id = p_viewer AND t.state <> 'liberado');
END $$;

-- ─── Enlaces legibles ────────────────────────────────────────────────────────
ALTER TABLE public.rifas DROP CONSTRAINT IF EXISTS rifas_slug_check;
ALTER TABLE public.rifas ADD CONSTRAINT rifas_slug_check
  CHECK (char_length(slug) BETWEEN 3 AND 40 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE OR REPLACE FUNCTION public.rifa_slug_from_name(p_name text)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE v_base text; v_slug text; n int := 1;
BEGIN
  v_base := lower(translate(coalesce(p_name, ''), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
                                                  'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun'));
  v_base := btrim(regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'), '-');
  v_base := btrim(left(v_base, 34), '-');
  IF char_length(v_base) < 3 THEN v_base := 'rifa'; END IF;
  -- Dos rifas con el mismo nombre al mismo tiempo: la segunda espera a que la
  -- primera confirme y toma el sufijo siguiente (lock hasta el fin de la transacción).
  PERFORM pg_advisory_xact_lock(hashtext('rifa_slug:' || v_base));
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.rifas WHERE slug = v_slug) LOOP
    n := n + 1;
    v_slug := v_base || '-' || n;
  END LOOP;
  RETURN v_slug;
END $$;

-- Reemplazos puntuales (fail-closed) sobre el texto vivo de la 157.
DO $$
DECLARE
  v_def text;
  v_patches text[][] := ARRAY[
    ['public.rifa_reserve_v1(uuid,uuid,integer[])',
     'IF r.creator_id = p_buyer THEN PERFORM public.rifa_fail(''CREATOR_CANNOT_BUY''); END IF;',
     'IF public.rifa_is_manager(r.id, p_buyer) THEN PERFORM public.rifa_fail(''CREATOR_CANNOT_BUY''); END IF;'],
    ['public.rifa_public_view_v1(text,uuid)',
     'v_is_creator := p_viewer IS NOT NULL AND p_viewer = r.creator_id;',
     'v_is_creator := p_viewer IS NOT NULL AND public.rifa_is_manager(r.id, p_viewer);'],
    ['public.rifa_my_list_v1(uuid)',
     'FROM public.rifas r WHERE r.creator_id = p_user), ''[]''::jsonb),',
     'FROM public.rifas r WHERE public.rifa_is_manager(r.id, p_user)), ''[]''::jsonb),'],
    ['public.rifa_set_visibility_v1(uuid,uuid,text)',
     'AND NOT public.rifa_is_creator(p_actor) THEN',
     'AND NOT public.rifa_is_creator(r.creator_id) THEN'],
    ['public.rifa_offline_sale_v1(uuid,uuid,integer,text,text,boolean)',
     'PERFORM public.rifa_fail(''INVALID_PHONE'', NULL, ''22023''); END IF;',
     'PERFORM public.rifa_fail(''INVALID_PHONE'', NULL, ''22023''); END IF;
  IF p_phone = public.rifa_user_phone(r.creator_id) OR EXISTS (SELECT 1 FROM public.rifa_managers m
       WHERE m.rifa_id = p_rifa AND public.rifa_user_phone(m.user_id) = p_phone) THEN
    PERFORM public.rifa_fail(''TEAM_CANNOT_BUY'');
  END IF;'],
    ['public.rifa_create_v1(uuid,text,text,bigint,text,integer,integer,text,text,timestamp with time zone,text,text,text,text)',
     'v_slug := public.rifa_new_slug();',
     'v_slug := public.rifa_slug_from_name(p_name);']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_patches, 1) LOOP
    SELECT pg_get_functiondef(v_patches[i][1]::regprocedure) INTO v_def;
    IF position(v_patches[i][2] IN v_def) = 0 THEN
      RAISE EXCEPTION '158: no encontré el texto a reemplazar en %', v_patches[i][1];
    END IF;
    EXECUTE replace(v_def, v_patches[i][2], v_patches[i][3]);
  END LOOP;
END $$;

-- Equipo de la rifa (para el panel): quién la creó y quiénes la operan.
CREATE OR REPLACE FUNCTION public.rifa_team_v1(p_actor uuid, p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  SELECT * INTO r FROM public.rifas WHERE slug = p_slug;
  IF NOT FOUND THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  PERFORM public.rifa_require_owner(r, p_actor);
  RETURN jsonb_build_object(
    'is_owner', r.creator_id = p_actor,
    'owner_name', (SELECT display_name FROM public.users WHERE id = r.creator_id),
    'managers', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', u.display_name) ORDER BY m.added_at)
      FROM public.rifa_managers m JOIN public.users u ON u.id = m.user_id WHERE m.rifa_id = r.id), '[]'::jsonb));
END $$;

-- Solo el creador suma coadministradores, por el celular con el que la persona
-- entra a La Polla (E.164). La persona tiene que tener cuenta.
CREATE OR REPLACE FUNCTION public.rifa_add_manager_v1(p_actor uuid, p_rifa uuid, p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; v_user uuid; v_name text;
BEGIN
  r := public.rifa_lock(p_rifa);
  IF p_actor IS NULL OR r.creator_id <> p_actor THEN PERFORM public.rifa_fail('OWNER_ONLY', NULL, '42501'); END IF;
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN PERFORM public.rifa_fail('INVALID_PHONE', NULL, '22023'); END IF;
  SELECT id, display_name INTO v_user, v_name FROM public.users
   WHERE whatsapp_number = substr(p_phone, 2) LIMIT 1;
  IF v_user IS NULL THEN PERFORM public.rifa_fail('USER_NOT_FOUND', NULL, 'P0002'); END IF;
  IF v_user = r.creator_id THEN PERFORM public.rifa_fail('ALREADY_MANAGER'); END IF;
  IF (SELECT count(*) FROM public.rifa_managers WHERE rifa_id = p_rifa) >= 5 THEN PERFORM public.rifa_fail('MAX_MANAGERS'); END IF;
  -- Un coadministrador no puede tener números a su nombre en la misma rifa.
  IF EXISTS (SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = p_rifa AND t.state <> 'liberado'
               AND (t.buyer_id = v_user OR t.buyer_phone = p_phone)) THEN
    PERFORM public.rifa_fail('MANAGER_HAS_NUMBERS');
  END IF;
  INSERT INTO public.rifa_managers (rifa_id, user_id, added_by) VALUES (p_rifa, v_user, p_actor)
  ON CONFLICT (rifa_id, user_id) DO NOTHING;
  IF NOT FOUND THEN PERFORM public.rifa_fail('ALREADY_MANAGER'); END IF;
  INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind) VALUES (p_rifa, p_actor, v_user, 'coadmin_agregado');
  RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'name', v_name);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_remove_manager_v1(p_actor uuid, p_rifa uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  r := public.rifa_lock(p_rifa);
  IF p_actor IS NULL OR r.creator_id <> p_actor THEN PERFORM public.rifa_fail('OWNER_ONLY', NULL, '42501'); END IF;
  DELETE FROM public.rifa_managers WHERE rifa_id = p_rifa AND user_id = p_user;
  IF FOUND THEN
    INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind) VALUES (p_rifa, p_actor, p_user, 'coadmin_quitado');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ─── Permisos de ejecución: solo el servidor ────────────────────────────────
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'rifa\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

COMMIT;
