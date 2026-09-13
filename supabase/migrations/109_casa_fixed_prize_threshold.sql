-- Fixed prize = GUARANTEED MINIMUM (owner rule, 2026-09-13). Replaces the 104
-- rule where a fixed prize forced house_cut_pct=0 and never grew.
--
-- With G = paid gross (same definition as casa_pot_summaries_v2), F = fixed_prize_cop
-- and c = house_cut_pct:
--   G <= F  -> prize = F, house = G - F (zero or negative: the house covers it).
--   G >  F  -> E = G - F; the pot receives floor(E*(100-c)/100), exactly the
--              rounding the proportional pot applies to G; the house keeps the rest.
--              prize = F + floor(E*(100-c)/100), house = E - floor(E*(100-c)/100).
--
-- House balance (house_cop) keeps 107 for draft/voided/zero-point/resolved pools
-- and adds: a hidden pool OR a scheduled pool whose opens_at has not arrived yet
-- commits nothing (house = G) until it is published. prize_cop, which people see
-- and settlement reads, always follows the formula above.
--
-- Installing this migration writes no rows: no predictions, fixtures, entries,
-- payouts or settlements change. Settlement already reads prize_cop from
-- casa_pot_summaries_v2, so it follows the new formula without being redefined.

-- 1) One pure function for every cash prize. Proportional keeps its exact 099
--    expression; fixed applies the same rounding to the excess over F only.
CREATE FUNCTION public.casa_money_prize_cop(p_gross bigint,p_house_cut_pct integer,p_fixed_prize_cop bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT CASE
    WHEN p_fixed_prize_cop IS NULL THEN floor(p_gross::numeric*(100-p_house_cut_pct)/100)::bigint
    WHEN p_gross<=p_fixed_prize_cop THEN p_fixed_prize_cop
    ELSE p_fixed_prize_cop+floor((p_gross-p_fixed_prize_cop)::numeric*(100-p_house_cut_pct)/100)::bigint
  END;
$$;
REVOKE ALL ON FUNCTION public.casa_money_prize_cop(bigint,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_money_prize_cop(bigint,integer,bigint) TO service_role;

-- 2) A fixed prize may now carry any house percentage 0..100 (the column CHECK
--    casa_pollas_house_cut_pct_check keeps the range). Everything else of 104 stays.
ALTER TABLE public.casa_pollas
  DROP CONSTRAINT casa_fixed_prize_valid,
  ADD CONSTRAINT casa_fixed_prize_valid CHECK (
    (pot_mode='fijo' AND prize_kind='pozo' AND fixed_prize_cop IS NOT NULL AND fixed_prize_cop BETWEEN 1 AND 1000000000)
    OR (pot_mode='proporcional' AND fixed_prize_cop IS NULL));

-- 3) Summaries: definition installed by 107, with the prize from step 1 and the
--    unpublished scheduled pool added to the no-commitment balance cases.
CREATE OR REPLACE FUNCTION public.casa_pot_summaries_v2(p_ids uuid[],p_projection_entry uuid DEFAULT NULL)
RETURNS TABLE(polla_id uuid,paid_entries integer,gross_cop bigint,prize_cop bigint,house_cop bigint,
  entry_prize_cop bigint,projected_prize_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH totals AS (
    SELECT p.id,p.prize_kind,p.pot_mode,p.fixed_prize_cop,p.house_cut_pct,p.entry_price_cop,
      p.status,p.publication_mode,p.opens_at,p.settlement_outcome,count(e.id)::integer AS paid,
      coalesce(sum(e.amount_cop),0)::bigint AS gross,
      CASE WHEN p_projection_entry IS NULL THEN p.entry_price_cop
        ELSE coalesce((SELECT CASE WHEN x.status='pagada' THEN 0 ELSE x.amount_cop END
          FROM public.casa_entries x WHERE x.id=p_projection_entry AND x.polla_id=p.id),0) END AS extra,
      (SELECT sum(o.amount_cop)::bigint FROM public.casa_payouts o WHERE o.polla_id=p.id AND o.prize_kind='pozo') AS paid_out
    FROM public.casa_pollas p LEFT JOIN public.casa_entries e ON e.polla_id=p.id AND e.status='pagada'
    WHERE p.id=ANY(p_ids) GROUP BY p.id
  ), prizes AS (
    SELECT *,
      CASE WHEN prize_kind='objeto' THEN 0
        ELSE public.casa_money_prize_cop(gross,house_cut_pct,CASE WHEN pot_mode='fijo' THEN fixed_prize_cop END) END AS prize,
      CASE WHEN prize_kind='objeto' THEN 0
        ELSE public.casa_money_prize_cop(gross+extra,house_cut_pct,CASE WHEN pot_mode='fijo' THEN fixed_prize_cop END) END AS projected
    FROM totals
  )
  SELECT id,paid,gross,prize,
    CASE
      WHEN pot_mode<>'fijo' THEN gross-prize
      -- Hidden/draft, scheduled but not yet visible, voided, or settled with
      -- nobody above zero: no prize is committed.
      WHEN status IN ('borrador','anulada') OR publication_mode='oculta'
        OR (publication_mode='programada' AND opens_at>now())
        OR settlement_outcome='house_retained_zero_points' THEN gross
      -- Settled: what was actually paid, never the nominal commitment.
      WHEN status='resuelta' AND paid_out IS NOT NULL THEN gross-paid_out
      ELSE gross-prize
    END,
    -- What this entry adds to the pot: the proportional share, or for a fixed
    -- prize the real increase (0 while entries are still covering the minimum).
    CASE WHEN prize_kind='objeto' THEN 0
      WHEN pot_mode='fijo' THEN projected-prize
      ELSE floor(entry_price_cop::numeric*(100-house_cut_pct)/100)::bigint END,
    projected
  FROM prizes;
$$;
REVOKE ALL ON FUNCTION public.casa_pot_summaries_v2(uuid[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_pot_summaries_v2(uuid[],uuid) TO service_role;

-- 4) Creation: drop only the house_cut_pct=0 requirement for a fixed prize.
--    Rewrites the installed definition so every other guard is preserved verbatim.
DO $$ DECLARE definition text; needle text:=' OR (p_config->>''houseCutPct'')::integer IS DISTINCT FROM 0)';
BEGIN
  SELECT pg_get_functiondef('public.casa_create_polla_v2(jsonb,text,uuid,integer)'::regprocedure) INTO definition;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect casa_create_polla_v2 fixed-prize baseline'; END IF;
  EXECUTE replace(definition,needle,')');
END $$;
REVOKE ALL ON FUNCTION public.casa_create_polla_v2(jsonb,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_create_polla_v2(jsonb,text,uuid,integer) TO service_role;

-- 5) Admin preview of a fixed prize. Every amount comes from step 1.
--    entries_to_cover = entries needed for the paid gross to reach F (NULL when
--    the entry is free: the house covers the whole prize). entry_prize/entry_house
--    split each entry above the minimum, with the proportional rounding.
CREATE FUNCTION public.casa_fixed_prize_threshold_preview_v2(p_price integer,p_cut integer,p_fixed bigint,p_tickets integer)
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
    'entry_prize',v_each,'entry_house',p_price-v_each,
    'ten_prize',v_ten,'ten_balance',p_price::bigint*10-v_ten,
    'all_prize',v_all,'all_balance',p_price::bigint*p_tickets-v_all);
END $$;
REVOKE ALL ON FUNCTION public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer) TO service_role;

-- The 104 three-argument preview stays callable for older clients, but it can no
-- longer disagree with the new rule: it is the threshold preview with 0% house.
CREATE OR REPLACE FUNCTION public.casa_fixed_prize_preview_v2(p_price integer,p_fixed bigint,p_tickets integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 10000000 OR p_fixed IS NULL OR p_fixed NOT BETWEEN 1 AND 1000000000
    OR p_tickets IS NULL OR p_tickets NOT BETWEEN 2 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
  END IF;
  RETURN public.casa_fixed_prize_threshold_preview_v2(p_price,0,p_fixed,p_tickets);
END $$;
REVOKE ALL ON FUNCTION public.casa_fixed_prize_preview_v2(integer,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_fixed_prize_preview_v2(integer,bigint,integer) TO service_role;
