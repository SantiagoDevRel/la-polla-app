-- 096_casa_pozo_solo_ganador.sql
-- (2026-09-11) EL POZO ES DEL GANADOR. Nada más.
--
-- Pedido literal del dueño: "que siempre la plata del pozo sea repartida SOLO
-- para el ganador, y en caso de empate de varios ganadores [dividida entre
-- ellos]". Y el alcance también fue literal: lo ÚNICO que se toca acá es la
-- distribución del premio. Ni el puntaje, ni el pozo (casa_polla_pot sigue
-- igual: 70% jugadores / 30% casa), ni el ciclo de vida, ni los guards que
-- trajo la 091 — esos se copian tal cual.
--
-- El reparto de la 091 ya pagaba solo al puntaje más alto y dividía en caso de
-- empate. Lo que arregla esta migración son los tres casos donde ese "solo el
-- ganador" se rompía en silencio y la plata terminaba donde no debía:
--
-- ── 1. NADIE SUMÓ UN PUNTO ───────────────────────────────────────────────
-- `v_top` salía 0 y entonces TODA inscripción pagada quedaba "empatada en el
-- primer puesto": el pozo se repartía por igual entre todos, incluidos los que
-- pagaron y nunca marcaron un solo pronóstico. Eso no es pagarle al ganador,
-- es un reembolso parcial encubierto — y se ejecutaba solo, sin que nadie lo
-- decidiera. Ahora el reparto se DETIENE con un mensaje claro: no hay ganador,
-- y qué se hace con esa plata es una decisión de la casa, no del código.
-- (Con 1X2 o marcador es rarísimo; pero es exactamente el caso en que un
-- reparto automático movería plata de verdad hacia quien no ganó.)
--
-- ── 2. LA BOLETA GANADORA NO SE VENDIÓ (rifa) ────────────────────────────
-- Si `drawn_number` no lo tenía ninguna inscripción pagada, la función
-- insertaba CERO payouts, marcaba la rifa 'resuelta' y el pozo entero se
-- quedaba callado en la casa. Misma respuesta: se detiene y lo decide una
-- persona (volver a sortear entre las boletas vendidas, o lo que la casa
-- anuncie). Una rifa 'resuelta' sin un solo ganador es un estado del que no
-- se vuelve: `casa_settle_polla` rechaza repartir dos veces.
--
-- ── 3. EL SOBRANTE DEL REDONDEO SE LO QUEDABA LA CASA ────────────────────
-- $70.000 entre 3 → $23.333 cada uno y "$1 queda en la casa". Son centavos,
-- pero contradicen la regla: el pozo es de los ganadores, completo. Ahora los
-- pesos sueltos (siempre menos que la cantidad de ganadores) se reparten de a
-- uno, en orden estable por user_id, y la suma de casa_payouts es EXACTAMENTE
-- prize_cop. `settle_notes` ya no escribe la nota del sobrante.
--
-- Lo que NO cambia, y conviene dejar dicho porque es la otra mitad de "solo el
-- ganador": nunca se paga un segundo ni un tercer puesto. `place` es siempre 1.
-- La casa no tiene una tabla de distribución configurable y no se le agrega
-- una — el modelo viejo P2P (`pollas.prize_distribution`) sí la tiene, pero
-- ese modelo ya no crea pollas nuevas (/pollas/crear redirige a /casa) y sus
-- filas históricas no se tocan.

CREATE OR REPLACE FUNCTION public.casa_settle_polla(p_polla_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_polla record;
  v_prize bigint;
  v_winners integer := 0;
  v_each bigint := 0;
  v_top integer;
  v_remainder bigint := 0;
BEGIN
  SELECT id, kind, status, archived_at, drawn_number, draw_method
    INTO v_polla FROM public.casa_pollas
    WHERE id = p_polla_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'No existe esa polla.';
  END IF;
  IF v_polla.archived_at IS NOT NULL OR v_polla.status <> 'cerrada' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Solo se puede repartir una polla cerrada que no se haya eliminado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.casa_entries
             WHERE polla_id = p_polla_id AND status = 'pendiente' AND proof_path IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Revisa todos los comprobantes pendientes antes de repartir el pozo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.casa_payouts WHERE polla_id = p_polla_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Esta polla ya tiene un reparto registrado.';
  END IF;
  IF v_polla.kind = 'partidos' AND EXISTS (
    SELECT 1 FROM public.casa_polla_matches pm
    JOIN public.matches m ON m.id = pm.match_id
    WHERE pm.polla_id = p_polla_id AND m.final_verified_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Faltan partidos por verificar antes de repartir.';
  END IF;
  IF v_polla.kind = 'manual' AND EXISTS (
    SELECT 1 FROM public.casa_questions WHERE polla_id = p_polla_id AND resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Faltan preguntas por resolver antes de repartir.';
  END IF;
  IF v_polla.kind = 'rifa' AND v_polla.drawn_number IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Falta el número ganador de la rifa.';
  END IF;

  SELECT prize_cop INTO v_prize FROM public.casa_polla_pot(p_polla_id);
  v_prize := COALESCE(v_prize, 0);

  IF v_polla.kind = 'rifa' THEN
    -- Quién tiene la boleta que salió. El índice único casa_entries_ticket_unique
    -- garantiza que sea UNA sola inscripción pagada como máximo.
    SELECT COUNT(*) INTO v_winners
      FROM public.casa_entries e
      WHERE e.polla_id = p_polla_id AND e.status = 'pagada'
        AND e.ticket_number = v_polla.drawn_number;

    IF v_winners = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'La boleta ' || v_polla.drawn_number || ' no la compró nadie: esta rifa no tiene ganador. '
               || 'Registra otro número o anuncia qué pasa con el pozo antes de repartir.';
    END IF;

    INSERT INTO public.casa_payouts (polla_id, user_id, place, points, amount_cop, note)
    SELECT p_polla_id, e.user_id, 1, NULL, v_prize,
           'Boleta ' || e.ticket_number || ' — ' || v_polla.draw_method
    FROM public.casa_entries e
    WHERE e.polla_id = p_polla_id AND e.status = 'pagada'
      AND e.ticket_number = v_polla.drawn_number;
    v_each := v_prize;

  ELSE
    PERFORM public.casa_score_polla(p_polla_id);
    SELECT MAX(points) INTO v_top FROM public.casa_leaderboard(p_polla_id);
    v_top := COALESCE(v_top, 0);

    -- Sin puntos no hay ganador. Antes esto repartía el pozo entre TODOS los
    -- que pagaron (incluidos los que nunca pronosticaron); ahora se frena.
    IF v_top <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'Nadie sumó puntos en esta polla: no hay ganador a quien pagarle. '
               || 'Decide qué pasa con el pozo (devolución o nuevo sorteo) antes de repartir.';
    END IF;

    SELECT COUNT(*) INTO v_winners
      FROM public.casa_leaderboard(p_polla_id) WHERE points = v_top;

    -- v_winners >= 1 garantizado: v_top salió de ese mismo leaderboard.
    v_each := FLOOR(v_prize / v_winners);
    v_remainder := v_prize - (v_each * v_winners);

    -- El sobrante del redondeo (siempre < v_winners pesos) se reparte de a un
    -- peso, en orden estable por user_id, para que la suma de los payouts sea
    -- EXACTAMENTE el pozo y no quede un resto en la casa.
    INSERT INTO public.casa_payouts (polla_id, user_id, place, points, amount_cop, note)
    SELECT p_polla_id, w.user_id, 1, w.points,
           v_each + CASE WHEN w.orden <= v_remainder THEN 1 ELSE 0 END,
      CASE WHEN v_winners > 1
        THEN 'Empate en ' || v_top || ' pts — pozo dividido entre ' || v_winners
        ELSE NULL END
    FROM (
      SELECT lb.user_id, lb.points,
             ROW_NUMBER() OVER (ORDER BY lb.user_id) AS orden
      FROM public.casa_leaderboard(p_polla_id) lb
      WHERE lb.points = v_top
    ) w;
  END IF;

  UPDATE public.casa_pollas
     SET status = 'resuelta', settled_at = now()
   WHERE id = p_polla_id;

  RETURN jsonb_build_object('polla_id', p_polla_id, 'kind', v_polla.kind,
    'prize_cop', v_prize, 'winners', v_winners, 'each_cop', v_each,
    'remainder', v_remainder, 'top_points', v_top);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.casa_settle_polla(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_settle_polla(uuid) TO service_role;

COMMENT ON FUNCTION public.casa_settle_polla(uuid) IS
  'Reparte el pozo (casa_polla_pot.prize_cop) COMPLETO y SOLO al puntaje más alto; '
  'si hay empate, en partes iguales entre los empatados (place siempre 1, el sobrante '
  'del redondeo también va a los ganadores). Sin ganador — nadie sumó puntos, o la '
  'boleta sorteada no se vendió — no reparte: falla y lo decide una persona.';
