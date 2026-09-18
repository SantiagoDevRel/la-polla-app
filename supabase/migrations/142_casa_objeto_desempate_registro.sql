-- 142 — Desempate por orden de registro para premios en objeto (2026-09-18)
--
-- Decision del dueno: cuando un premio en objeto no se puede dividir (un pase
-- doble de boletas), el empate en el primer puesto NO se sortea: gana la
-- participacion que se registro primero en la polla. Es determinista, se anuncia
-- en la Info antes de abrir la polla y la fecha de registro de cada participante
-- queda visible en la tabla de posiciones, para que cualquiera lo verifique.
--
-- Por que importa aca: con `scoring_mode='marcador'` y solo el marcador exacto
-- sumando, el puntaje ganador suele ser 1 o 2 aciertos y los empates arriba son
-- el caso normal, no el borde. El desempate decide la polla seguido.
--
-- Las tablas del sorteo (`casa_object_draws`, candidatos, intentos de evidencia)
-- NO se tocan ni se borran: quedan intactas y sin uso nuevo. Hoy tienen 0 filas.
-- El RPC de settlement conserva su early-return por si existiera uno pendiente.
--
-- Base: definiciones VIVAS en produccion al 2026-09-18
--   casa_settle_polla_v2  md5 f4f0c925c39697c3d02a5b37286e4cf1
--   casa_change_status_v2 md5 164a3e931787c70fcf066ca01e50d2d1
-- (ambas traian parches posteriores a la 099; se copian tal cual y solo se
-- cambia lo descrito arriba.)

CREATE OR REPLACE FUNCTION public.casa_settle_polla_v2(p_polla_id uuid,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; d public.casa_object_draws; v_prize bigint; v_paid integer;
  v_top integer; v_winners integer; v_shares integer; v_each bigint:=0; v_remainder bigint:=0; v_outcome text; v_user uuid;
  v_entry uuid; v_registered timestamptz;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  PERFORM public.casa_sweep_match_issues();
  p := public.casa_v2_lock_polla(p_polla_id,true);
  IF p.status<>'cerrada' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CLOSE_FIRST'; END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE polla_id=p.id;
  IF FOUND THEN
    IF d.state<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED'; END IF;
    RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
      'draw_id',d.id,'prize_cop',0,'winners',0,'each_cop',0,'top_points',d.top_points);
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_match_issues mi JOIN public.casa_polla_matches pm ON pm.match_id=mi.match_id
    WHERE pm.polla_id=p.id AND pm.voided_at IS NULL AND mi.decision IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPEN_MATCH_ISSUES',DETAIL='Hay partidos con novedades sin decidir.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_entries e LEFT JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id
    WHERE e.polla_id=p.id AND e.status='pendiente' AND
      (e.proof_path IS NOT NULL OR (a.state='uploading' AND a.expires_at>clock_timestamp()))) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PENDING_PROOFS',DETAIL='Revisa los comprobantes pendientes y espera las cargas en curso.';
  END IF;
  SELECT paid_entries,prize_cop INTO v_paid,v_prize FROM public.casa_pot_summaries_v2(ARRAY[p.id]);
  IF v_paid=0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES',DETAIL='Esta polla no tiene inscripciones pagadas.'; END IF;
  IF p.kind='partidos' AND EXISTS(SELECT 1 FROM public.casa_polla_matches pm JOIN public.matches m ON m.id=pm.match_id
    WHERE pm.polla_id=p.id AND m.final_verified_at IS NULL AND pm.voided_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNVERIFIED_MATCHES',DETAIL='Faltan partidos por verificar.';
  END IF;
  IF p.kind='manual' AND EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id AND resolved_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNRESOLVED_QUESTIONS',DETAIL='Faltan preguntas por resolver.';
  END IF;
  IF p.prize_kind='objeto' AND nullif(btrim(p.prize_object),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_REQUIRED';
  END IF;
  IF p.kind='rifa' THEN
    IF p.drawn_number IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_NUMBER_REQUIRED'; END IF;
    SELECT user_id INTO v_user FROM public.casa_entries WHERE polla_id=p.id AND status='pagada' AND ticket_number=p.drawn_number;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNSOLD_TICKET',DETAIL='La boleta sorteada no está pagada. No se ha adjudicado el premio.'; END IF;
    v_winners:=1; v_shares:=1;
  ELSE
    PERFORM public.casa_score_polla(p.id);
    SELECT max(points) INTO v_top FROM public.casa_leaderboard(p.id);
    IF v_top IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES'; END IF;
    IF v_top=0 THEN
      UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,
        settled_chat_id=p_chat_id,settlement_outcome='house_retained_zero_points',settlement_prize_cop=v_prize WHERE id=p.id;
      RETURN jsonb_build_object('contract',2,'outcome','house_retained_zero_points','polla_id',p.id,'status','resuelta',
        'prize_cop',0,'retained_prize_cop',v_prize,'winners',0,'each_cop',0,'top_points',0);
    END IF;
    IF v_top<0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POINTS'; END IF;
    -- A share per winning participation; a payout per person.
    SELECT count(*),count(DISTINCT user_id) INTO v_shares,v_winners FROM public.casa_leaderboard(p.id) WHERE points=v_top;
    IF p.prize_kind='objeto' AND v_winners>1 THEN
      -- Un objeto no se parte. Gana la participacion registrada primero; el
      -- orden es el mismo que la app muestra en la tabla, y un empate del
      -- desempate (mismo microsegundo) cae en un orden estable, nunca aleatorio.
      SELECT lb.entry_id,e.user_id,e.created_at INTO v_entry,v_user,v_registered
        FROM public.casa_leaderboard(p.id) lb
        JOIN public.casa_entries e ON e.id=lb.entry_id
       WHERE lb.points=v_top
       ORDER BY e.created_at,e.entry_number NULLS LAST,e.id
       LIMIT 1;
      IF v_entry IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='TIEBREAK_FAILED'; END IF;
      INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
        VALUES(p.id,v_user,1,v_top,0,'Empate en '||v_top||' puntos · gana el registro más antiguo ('
          ||to_char(v_registered AT TIME ZONE 'America/Bogota','DD/MM/YYYY HH24:MI')||')',p.prize_kind,p.prize_object);
      UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,
        settled_chat_id=p_chat_id,settlement_outcome='object_awarded',settlement_prize_cop=0 WHERE id=p.id;
      RETURN jsonb_build_object('contract',2,'outcome','object_awarded','polla_id',p.id,'status','resuelta',
        'prize_cop',0,'winners',1,'winning_entries',1,'each_cop',0,'remainder',0,'top_points',v_top,
        'tiebreak','registro','tied_entries',v_shares,'tied_people',v_winners);
    END IF;
  END IF;
  v_each:=v_prize/v_shares;
  v_remainder:=v_prize-v_each*v_shares;
  v_outcome:=CASE WHEN p.prize_kind='objeto' THEN 'object_awarded' ELSE 'money_awarded' END;
  IF p.kind='rifa' THEN
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      VALUES(p.id,v_user,1,NULL,v_prize,'Boleta '||p.drawn_number||' — '||p.draw_method,p.prize_kind,
        CASE WHEN p.prize_kind='objeto' THEN p.prize_object END);
  ELSE
    -- Rounding pesos go one per winning participation, in a stable order, so the
    -- payouts add up to exactly the prize.
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      SELECT p.id,s.user_id,1,v_top,sum(s.amount)::integer,
        CASE WHEN v_shares>1 THEN 'Empate en '||v_top||' puntos'
          ||CASE WHEN count(*)>1 THEN ' · '||count(*)||' participaciones ganadoras' ELSE '' END END,
        p.prize_kind,CASE WHEN p.prize_kind='objeto' THEN p.prize_object END
      FROM (SELECT user_id,v_each+CASE WHEN row_number() OVER(ORDER BY user_id,entry_number)<=v_remainder THEN 1 ELSE 0 END AS amount
              FROM public.casa_leaderboard(p.id) WHERE points=v_top) s
      GROUP BY s.user_id;
  END IF;
  UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,settled_chat_id=p_chat_id,
    settlement_outcome=v_outcome,settlement_prize_cop=v_prize WHERE id=p.id;
  RETURN jsonb_build_object('contract',2,'outcome',v_outcome,'polla_id',p.id,'status','resuelta',
    'prize_cop',v_prize,'winners',v_winners,'winning_entries',v_shares,'each_cop',v_each,'remainder',v_remainder,'top_points',v_top);
END $$;

-- Publicar una polla por puntos con premio en objeto ya no depende del protocolo
-- de sorteo: el empate se resuelve por orden de registro y no abre un sorteo.
-- `object_draws_enabled` se conserva tal cual (hoy false) y sigue gobernando la
-- confirmacion de un sorteo, que es el camino que deja de usarse.
CREATE OR REPLACE FUNCTION public.casa_change_status_v2(p_polla_id uuid,p_action text,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; s public.casa_polla_status;
BEGIN
  PERFORM public.casa_v2_context(p_contract); PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  p:=public.casa_v2_lock_polla(p_polla_id);
  IF p_action='publicar' AND (p.status='borrador' OR (p.status='abierta' AND p.opens_at>clock_timestamp())) THEN
    IF p.closes_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED'; END IF;
    IF p.entry_price_cop>0 AND (nullif(btrim(p.payout_method),'') IS NULL OR nullif(btrim(p.payout_account),'') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PAYMENT_ACCOUNT_REQUIRED';
    END IF;
    IF p.prize_kind='objeto' AND nullif(btrim(p.prize_object),'') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_REQUIRED';
    END IF;
    IF p.kind='partidos' AND NOT EXISTS(SELECT 1 FROM public.casa_polla_matches WHERE polla_id=p.id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_MATCHES';
    END IF;
    IF p.kind='manual' AND (NOT EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id) OR EXISTS(
      SELECT 1 FROM public.casa_questions q WHERE q.polla_id=p.id AND q.input_kind='opciones'
        AND (SELECT count(*) FROM public.casa_options o WHERE o.question_id=q.id)<2)) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_QUESTIONS';
    END IF;
    s:='abierta';
  ELSIF p_action='cerrar' AND p.status='abierta' AND p.opens_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_PUBLISHED',
      DETAIL='Esta polla todavía no se publica. Publícala, cambia la fecha u ocúltala antes de cerrarla.';
  ELSIF p_action='cerrar' AND p.status='abierta' THEN s:='cerrada';
  ELSIF p_action='anular' AND p.status IN ('borrador','abierta') THEN s:='anulada';
  ELSE RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_TRANSITION'; END IF;
  UPDATE public.casa_pollas SET status=s,
    publication_mode=CASE WHEN p_action='publicar' THEN 'ahora' ELSE publication_mode END,
    opens_at=CASE WHEN p_action='publicar' THEN clock_timestamp() ELSE opens_at END WHERE id=p.id;
  RETURN jsonb_build_object('slug',p.slug,'status',s);
END $$;
