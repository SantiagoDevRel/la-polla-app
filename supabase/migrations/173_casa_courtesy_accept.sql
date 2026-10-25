-- 173_casa_courtesy_accept.sql — La cortesía es para quien la recibe (2026-10-25).
--
-- Pedido del dueño: cuando el administrador da cortesías desde el panel, esa
-- persona NO sabía dónde estaban. La 138 las hizo enlaces para regalar a cuentas
-- nuevas; el dueño las usa como un cupo gratis para la persona misma. Ahora:
--   · Al abrir la app, quien tiene cortesías sin aceptar ve un aviso que no se
--     cierra hasta aceptarlas (la app lo pinta con casa_pending_courtesies_v1).
--   · Un toque y queda dentro: casa_accept_courtesies_v1 crea un cupo de $0 por
--     cada cortesía disponible de esa persona en esa polla, igual al que crea el
--     canje de un enlace (pagada, amount_cop=0, sin comprobante).
--
-- Qué NO cambia:
--   · El pozo: el cupo vale $0, como en la 138.
--   · Los enlaces ya repartidos siguen canjeándose con casa_redeem_courtesy_v1 y
--     sus reglas (cuenta nueva, una vez en la vida). Una cortesía aceptada por su
--     dueño ya no está disponible para un enlace, y viceversa.
--   · El administrador sigue pudiendo retirar el cupo (139): la fila queda
--     `redimida` con su entry_id, igual que un canje.
--
-- Esquema: la 138 prohibía que el dueño redimiera su propia cortesía
-- (casa_courtesy_not_self) y limitaba a UNA cortesía por persona en su vida.
-- Esa regla sigue para los enlaces; para el dueño que acepta las suyas, no (el
-- administrador le puede dar varias). Mismo patrón de la 139 para cambiar
-- restricciones. Ninguna fila cambia.
-- Regresión local: scripts/casa-courtesy-accept-check.sql.

SET client_encoding = 'UTF8';

ALTER TABLE public.casa_courtesies DROP CONSTRAINT casa_courtesy_not_self;

DROP INDEX public.casa_courtesies_one_per_person;
CREATE UNIQUE INDEX casa_courtesies_one_per_person
  ON public.casa_courtesies(redeemed_by)
  WHERE redeemed_by IS NOT NULL AND redeemed_by <> holder_user_id;

COMMENT ON TABLE public.casa_courtesies IS
  'Cupos de cortesía (138, 173): el administrador se los da a una persona para UNA polla. Ella los acepta para jugar gratis (casa_accept_courtesies_v1); los enlaces ya repartidos siguen canjeándose por cuentas nuevas.';

-- Misma ventana que el canje (138): publicada, abierta, sin archivar, sin
-- desempate en curso y antes del cierre de inscripciones.
CREATE FUNCTION public.casa_courtesy_polla_live(p public.casa_pollas)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p.status='abierta' AND p.archived_at IS NULL AND p.publication_mode<>'oculta'
    AND p.opens_at<=clock_timestamp() AND p.closes_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM public.casa_object_draws d WHERE d.polla_id=p.id);
$$;

-- Lo que el aviso necesita: por polla viva, cuántas cortesías sin aceptar.
CREATE FUNCTION public.casa_pending_courtesies_v1(p_user_id uuid)
RETURNS TABLE(polla_id uuid, slug text, name text, closes_at timestamptz, pending integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p.id, p.slug::text, p.name::text, p.closes_at, count(*)::integer
  FROM public.casa_courtesies c
  JOIN public.casa_pollas p ON p.id=c.polla_id
  WHERE c.holder_user_id=p_user_id AND c.status='disponible'
    AND public.casa_courtesy_polla_live(p)
  GROUP BY p.id, p.slug, p.name, p.closes_at
  ORDER BY p.closes_at, p.id;
$$;

-- Acepta TODAS las cortesías disponibles de esta persona en esta polla.
-- Devuelve {ok:false,error:…} en vez de fallar, como el canje: la pantalla
-- explica el caso y deja de mostrar el aviso. Un doble toque no crea cupos de
-- más: la segunda llamada ya no encuentra cortesías disponibles.
CREATE FUNCTION public.casa_accept_courtesies_v1(
  p_polla_id uuid, p_user_id uuid, p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; c public.casa_courtesies; e public.casa_entries;
  v_numbers integer[] := '{}';
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  IF p_polla_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_NOT_FOUND');
  END IF;
  -- Padre antes que hijo: la polla, después las cortesías.
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','COURTESY_NOT_FOUND'); END IF;
  IF NOT public.casa_courtesy_polla_live(p) THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_EXPIRED','slug',p.slug);
  END IF;
  FOR c IN
    SELECT * FROM public.casa_courtesies
    WHERE polla_id=p.id AND holder_user_id=p_user_id AND status='disponible'
    ORDER BY granted_at, id
    FOR UPDATE
  LOOP
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number,entry_number)
      VALUES(p.id,p_user_id,'pagada',0,NULL,
        (SELECT coalesce(max(x.entry_number),0)+1 FROM public.casa_entries x
          WHERE x.polla_id=p.id AND x.user_id=p_user_id AND x.ticket_number IS NULL))
      RETURNING * INTO e;
    UPDATE public.casa_courtesies
      SET status='redimida', redeemed_by=p_user_id, redeemed_at=clock_timestamp(), entry_id=e.id
      WHERE id=c.id;
    v_numbers := v_numbers || e.entry_number;
  END LOOP;
  IF cardinality(v_numbers)=0 THEN
    RETURN jsonb_build_object('ok',false,'error','COURTESY_NOT_FOUND','slug',p.slug);
  END IF;
  RETURN jsonb_build_object('ok',true,'slug',p.slug,'polla',p.name,
    'accepted',cardinality(v_numbers),'entry_numbers',to_jsonb(v_numbers),
    'entry_number',v_numbers[1]);
END $$;

REVOKE ALL ON FUNCTION
  public.casa_courtesy_polla_live(public.casa_pollas),
  public.casa_pending_courtesies_v1(uuid),
  public.casa_accept_courtesies_v1(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.casa_courtesy_polla_live(public.casa_pollas),
  public.casa_pending_courtesies_v1(uuid),
  public.casa_accept_courtesies_v1(uuid,uuid,integer)
  TO service_role;
