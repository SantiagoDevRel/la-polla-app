-- 126: entries_to_grow cuenta las entradas que NO hacen crecer el pozo.
--
-- 125 lo calculaba con ceil(2F/entrada). Si 2F no es múltiplo de la entrada, la
-- entrada número ceil(...) ya pasa el doble y suma algo al pozo, pero el texto
-- («Si más de N personas se inscriben, el pozo crece…») lo anunciaba una persona
-- tarde. Ejemplo (auditoría con muse, 2026-09-15): entrada $30.000, F=$1.000.000,
-- casa 50 %: con 67 inscritos G=$2.010.000 y el pozo ya sube $5.000; 125 decía
-- «más de 67». Ahora es floor(2F/entrada)=66: el crecimiento empieza en la 67.
-- Con 2F múltiplo de la entrada (OFIGOLAZO: $20.000 y $1.000.000) no cambia: 100.
--
-- Solo cambia el preview. casa_money_prize_cop (la plata) queda igual que en 125.
-- No escribe filas.
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
    'entries_to_grow',CASE WHEN p_price=0 THEN NULL ELSE floor(2*p_fixed::numeric/p_price)::bigint END,
    'entry_prize',v_each,'entry_house',p_price-v_each,
    'ten_prize',v_ten,'ten_balance',p_price::bigint*10-v_ten,
    'all_prize',v_all,'all_balance',p_price::bigint*p_tickets-v_all);
END $$;
REVOKE ALL ON FUNCTION public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer) TO service_role;
