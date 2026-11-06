-- 179_rifa_managers_can_buy.sql — el equipo de una rifa también compra números.
--
-- Pedido del dueño (2026-11-06): quien crea o administra una rifa debe poder
-- comprar números en ella con el flujo normal (elegir, transferir, subir el
-- comprobante) para vivir la experiencia de cualquier comprador. Antes
-- rifa_reserve_v1 respondía CREATOR_CANNOT_BUY a todo el equipo.
--
-- Qué cambia:
--   1. rifa_reserve_v1: se quita el bloqueo CREATOR_CANNOT_BUY.
--   2. rifa_public_view_v1: `can_reserve` ya no excluye al equipo.
--   3. rifa_review_proof_v1: nadie confirma ni rechaza SU PROPIO comprobante,
--      salvo quien creó la rifa (el dinero va a su propia cuenta). Así un
--      coadministrador no puede marcarse pagado sin pagar: lo confirma la
--      creadora. Código nuevo: OWN_PROOF.
--
-- Se mantienen: TEAM_CANNOT_BUY en la venta por fuera (anotarse a sí mismo
-- como pagado sin comprobante) y MANAGER_HAS_NUMBERS al sumar a alguien.
--
-- Parche en sitio (patrón de la 133): se lee la definición VIGENTE de cada
-- función y se reemplaza un fragmento exacto, que debe aparecer una sola vez.
-- Así no se revierten parches anteriores hechos sobre estas funciones.
-- Los fragmentos son de una sola línea y sin el salto: una base aplicada desde
-- Windows guarda las funciones con CRLF y el parche debe valer en las dos.
-- CREATE OR REPLACE conserva SECURITY DEFINER, search_path y los GRANT.

DO $$
DECLARE
  v_def text;
  v_new text;
  v_count int;
  -- [función, fragmento actual, reemplazo]
  v_patches text[][] := ARRAY[
    ARRAY['rifa_reserve_v1(uuid,uuid,integer[])',
          $f$IF public.rifa_is_manager(r.id, p_buyer) THEN PERFORM public.rifa_fail('CREATOR_CANNOT_BUY'); END IF;$f$,
          $f$-- (179) El equipo también compra: sin bloqueo para creadora ni coadministradores.$f$],
    ARRAY['rifa_public_view_v1(text,uuid)',
          $f$'can_reserve', p_viewer IS NOT NULL AND NOT v_is_creator AND r.status$f$,
          $f$'can_reserve', p_viewer IS NOT NULL AND r.status$f$],
    ARRAY['rifa_review_proof_v1(uuid,uuid,text,text)',
          $f$IF p.state <> 'en_revision' THEN PERFORM public.rifa_fail('ALREADY_REVIEWED'); END IF;$f$,
          $f$IF p.state <> 'en_revision' THEN PERFORM public.rifa_fail('ALREADY_REVIEWED'); END IF; IF p.buyer_id = p_actor AND r.creator_id <> p_actor THEN PERFORM public.rifa_fail('OWN_PROOF'); END IF; -- (179) nadie revisa su propio pago, salvo la creadora$f$]
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_patches, 1) LOOP
    v_def := pg_get_functiondef(('public.' || v_patches[i][1])::regprocedure);
    v_count := (length(v_def) - length(replace(v_def, v_patches[i][2], ''))) / length(v_patches[i][2]);
    IF v_count <> 1 THEN
      RAISE EXCEPTION '179: % tiene el fragmento % veces (se esperaba 1)', v_patches[i][1], v_count;
    END IF;
    v_new := replace(v_def, v_patches[i][2], v_patches[i][3]);
    EXECUTE v_new;
  END LOOP;
END $$;
