-- 125: el pozo fijo crece solo cuando lo recaudado supera el DOBLE del premio
-- garantizado (regla del dueño, 2026-09-15). Reemplaza el umbral simple de 109.
--
-- Ejemplo del dueño (OFIGOLAZO): entrada $20.000, premio garantizado $1.000.000,
-- casa 50 %. Las primeras 50 entradas cubren el premio; las siguientes 50 son
-- para la casa (otro $1.000.000); desde la persona 101, cada entrada suma al
-- pozo la parte que no es de la casa ($10.000).
--
-- Con G = recaudado pagado (misma definición de casa_pot_summaries_v2),
-- F = fixed_prize_cop y c = house_cut_pct:
--   G <= 2F -> premio = F; balance de la casa = G - F (negativo mientras G < F).
--   G >  2F -> E = G - 2F; el pozo recibe floor(E*(100-c)/100), el mismo redondeo
--              del pozo proporcional; la casa se queda el resto.
--              premio = F + floor(E*(100-c)/100).
--
-- casa_money_prize_cop sigue siendo la única fórmula: casa_pot_summaries_v2 (pozo,
-- balance, "si entras"), casa_polla_pot, casa_payment_details_v2, la liquidación y
-- los previews la leen, así que todos siguen la regla nueva sin redefinirse.
-- El proporcional (p_fixed_prize_cop NULL) no cambia.
--
-- Instalar esta migración no escribe filas: ni inscripciones, ni pronósticos, ni
-- pagos, ni liquidaciones. Al 2026-09-15 ninguna polla de pozo fijo en producción
-- había recaudado más de F, así que ningún premio visible cambia al instalarla.

-- 1) La fórmula única del premio en dinero.
CREATE OR REPLACE FUNCTION public.casa_money_prize_cop(p_gross bigint,p_house_cut_pct integer,p_fixed_prize_cop bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT CASE
    WHEN p_fixed_prize_cop IS NULL THEN floor(p_gross::numeric*(100-p_house_cut_pct)/100)::bigint
    WHEN p_gross<=2*p_fixed_prize_cop THEN p_fixed_prize_cop
    ELSE p_fixed_prize_cop+floor((p_gross-2*p_fixed_prize_cop)::numeric*(100-p_house_cut_pct)/100)::bigint
  END;
$$;
REVOKE ALL ON FUNCTION public.casa_money_prize_cop(bigint,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_money_prize_cop(bigint,integer,bigint) TO service_role;

-- 2) Preview administrativo y texto de reglas. Conserva las claves de 109 y agrega
--    entries_to_grow: inscritos que cubren el doble del premio (ceil(2F/entrada)),
--    a partir de los cuales cada entrada suma entry_prize al pozo. NULL con
--    entrada gratis: el pozo nunca crece y la casa pone todo el premio.
CREATE OR REPLACE FUNCTION public.casa_fixed_prize_threshold_preview_v2(p_price integer,p_cut integer,p_fixed bigint,p_tickets integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_each bigint; v_ten bigint; v_all bigint;
BEGIN
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 10000000 OR p_cut IS NULL OR p_cut NOT BETWEEN 0 AND 100
    OR p_tickets IS NULL OR p_tickets NOT BETWEEN 2 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  IF p_fixed IS NULL OR p_fixed NOT BETWEEN 1 AND 1000000000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
  END IF;
  v_each:=public.casa_money_prize_cop(p_price::bigint,p_cut,NULL);
  v_ten:=public.casa_money_prize_cop(p_price::bigint*10,p_cut,p_fixed);
  v_all:=public.casa_money_prize_cop(p_price::bigint*p_tickets,p_cut,p_fixed);
  RETURN jsonb_build_object('fixed_prize',p_fixed,
    'entries_to_cover',CASE WHEN p_price=0 THEN NULL ELSE ceil(p_fixed::numeric/p_price)::bigint END,
    'entries_to_grow',CASE WHEN p_price=0 THEN NULL ELSE ceil(2*p_fixed::numeric/p_price)::bigint END,
    'entry_prize',v_each,'entry_house',p_price-v_each,
    'ten_prize',v_ten,'ten_balance',p_price::bigint*10-v_ten,
    'all_prize',v_all,'all_balance',p_price::bigint*p_tickets-v_all);
END $$;
REVOKE ALL ON FUNCTION public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer) TO service_role;
