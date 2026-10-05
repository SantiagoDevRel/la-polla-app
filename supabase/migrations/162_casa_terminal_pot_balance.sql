-- Terminal zero-points outcomes and voids account for all collected funds.
-- Preserve the current prize formula, paid payouts, and function privileges.
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
