-- 175_casa_admin_two_cases.sql — Costo de los premios físicos y los dos casos del balance (2026-10-25).
--
-- Pedido del dueño, después de la 174:
--   · Un premio físico también cuesta: POLLA JAMES costó $550.000 (la camiseta
--     firmada). El balance lo resta; antes contaba los $460.000 recaudados
--     como ganancia limpia.
--   · Mientras una polla está en juego, el panel muestra los dos casos: si gana
--     un jugador real (sale el premio) y si gana un jugador de la casa (no sale
--     dinero y el premio físico se queda en la casa).
--
-- casa_polla_costs guarda el costo del premio físico por polla. Va en su propia
-- tabla, solo para el servidor: casa_pollas es legible por `authenticated`.
-- casa_admin_money_v1 se recrea con prize_cost_cop y house_wins_cop
-- (real_house_cop sigue siendo «si gana un jugador»). Resuelta, los dos casos
-- coinciden con lo que de verdad pasó. casa_admin_house_totals_v1 suma los dos.
-- casa_house_total_v2 sigue sumando real_house_cop.
--
-- No cambia el pozo, los inscritos públicos, el ranking ni el reparto.
-- Regresión: scripts/casa-admin-money-check.sql.

SET client_encoding = 'UTF8';

CREATE TABLE public.casa_polla_costs (
  polla_id uuid PRIMARY KEY REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  prize_cost_cop bigint NOT NULL CHECK (prize_cost_cop >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.casa_polla_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.casa_polla_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.casa_polla_costs TO service_role;
CREATE POLICY casa_polla_costs_deny_players ON public.casa_polla_costs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
COMMENT ON TABLE public.casa_polla_costs IS
  'Costo de los premios físicos por polla (175). Solo servidor; lo resta el balance del administrador.';

-- Dato del dueño (2026-10-25). Sin esa polla (base local o de pruebas) no inserta nada.
INSERT INTO public.casa_polla_costs(polla_id,prize_cost_cop,note)
SELECT id,550000,'Camiseta de James firmada' FROM public.casa_pollas
WHERE id='e5e5719d-bdaf-407d-bf8d-b856338709a9'
ON CONFLICT (polla_id) DO NOTHING;

DROP FUNCTION public.casa_admin_money_v1(uuid[]);
CREATE FUNCTION public.casa_admin_money_v1(p_ids uuid[])
RETURNS TABLE(polla_id uuid, real_entries integer, house_entries integer, free_entries integer,
  real_gross_cop bigint, prize_cost_cop bigint, real_house_cop bigint, house_wins_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH entries AS (
    SELECT e.polla_id, e.amount_cop,
      (EXISTS(SELECT 1 FROM public.casa_admin_players a WHERE a.user_id=e.user_id)
        OR EXISTS(SELECT 1 FROM public.casa_admin_player_events v WHERE v.entry_id=e.id)) AS house,
      (e.origin='invitacion' OR EXISTS(SELECT 1 FROM public.casa_courtesies c WHERE c.entry_id=e.id)) AS gift
    FROM public.casa_entries e
    WHERE e.polla_id=ANY(p_ids) AND e.status='pagada'
  ), counts AS (
    SELECT x.polla_id,
      count(*) FILTER (WHERE NOT x.house AND NOT x.gift)::integer AS real_n,
      count(*) FILTER (WHERE x.house)::integer AS house_n,
      count(*) FILTER (WHERE x.gift AND NOT x.house)::integer AS gift_n,
      coalesce(sum(x.amount_cop) FILTER (WHERE NOT x.house AND NOT x.gift),0)::bigint AS real_gross
    FROM entries x GROUP BY x.polla_id
  ), payouts AS (
    -- Lo que salió hacia personas reales: dinero del pozo y si el premio físico
    -- se lo llevó alguien que no es de la casa.
    SELECT o.polla_id,
      coalesce(sum(o.amount_cop) FILTER (WHERE o.prize_kind='pozo' AND NOT x.house),0)::bigint AS real_paid,
      bool_or(o.prize_kind='objeto' AND NOT x.house) AS object_to_real
    FROM public.casa_payouts o
    CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.casa_admin_players a WHERE a.user_id=o.user_id) AS house) x
    WHERE o.polla_id=ANY(p_ids)
    GROUP BY o.polla_id
  ), base AS (
    SELECT p.id, coalesce(c.real_n,0) AS real_n, coalesce(c.house_n,0) AS house_n, coalesce(c.gift_n,0) AS gift_n,
      coalesce(c.real_gross,0) AS real_gross, coalesce(k.prize_cost_cop,0) AS cost, s.prize_cop,
      CASE
        WHEN p.status IN ('borrador','anulada') OR p.publication_mode='oculta'
          OR (p.publication_mode='programada' AND p.opens_at>now())
          OR p.settlement_outcome='house_retained_zero_points' THEN 'libre'
        WHEN p.status='resuelta' AND o.polla_id IS NOT NULL THEN 'resuelta'
        ELSE 'en_juego'
      END AS estado,
      coalesce(o.real_paid,0) AS real_paid, coalesce(o.object_to_real,false) AS object_to_real
    FROM public.casa_pollas p
    JOIN public.casa_pot_summaries_v2(p_ids) s ON s.polla_id=p.id
    LEFT JOIN counts c ON c.polla_id=p.id
    LEFT JOIN payouts o ON o.polla_id=p.id
    LEFT JOIN public.casa_polla_costs k ON k.polla_id=p.id
    WHERE p.id=ANY(p_ids)
  )
  SELECT id, real_n, house_n, gift_n, real_gross, cost,
    CASE estado
      WHEN 'libre' THEN real_gross
      WHEN 'resuelta' THEN real_gross-real_paid-CASE WHEN object_to_real THEN cost ELSE 0 END
      ELSE real_gross-prize_cop-cost
    END,
    CASE estado
      WHEN 'libre' THEN real_gross
      WHEN 'resuelta' THEN real_gross-real_paid-CASE WHEN object_to_real THEN cost ELSE 0 END
      ELSE real_gross
    END
  FROM base;
$$;

CREATE OR REPLACE FUNCTION public.casa_house_total_v2(p_ids uuid[])
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(sum(real_house_cop),0)::bigint FROM public.casa_admin_money_v1(p_ids);
$$;

CREATE FUNCTION public.casa_admin_house_totals_v1(p_ids uuid[])
RETURNS TABLE(if_player_wins_cop bigint, if_house_wins_cop bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(sum(real_house_cop),0)::bigint, coalesce(sum(house_wins_cop),0)::bigint
  FROM public.casa_admin_money_v1(p_ids);
$$;

REVOKE ALL ON FUNCTION public.casa_admin_money_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_admin_money_v1(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.casa_admin_house_totals_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_admin_house_totals_v1(uuid[]) TO service_role;
