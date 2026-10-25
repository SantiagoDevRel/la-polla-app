-- 174_casa_admin_real_money.sql — La cuenta del administrador solo suma consignaciones reales (2026-10-25).
--
-- Pedido del dueño: en el panel de administración, la cuenta de cada polla no
-- debe sumar a los jugadores de la casa (169) ni los cupos gratis (cortesías de
-- la 138/173 e invitaciones de la 135). Solo cuenta el dinero que de verdad
-- consignó la gente.
--
-- casa_admin_money_v1 separa, por polla y entre las inscripciones pagadas:
--   · casa: perfiles de casa_admin_players o entradas creadas por su selector;
--   · gratis: invitaciones (origin='invitacion') y cupos de una cortesía;
--   · reales: todas las demás. real_gross_cop suma solo su amount_cop.
-- real_house_cop es lo que le queda a la casa con ese dinero real: consignado
-- menos el premio comprometido (en juego) o menos lo que se le pagó a personas
-- reales (resuelta). Si gana un jugador de la casa, ese premio no sale de caja.
-- Mismas reglas de compromiso que casa_pot_summaries_v2 (borrador, anulada,
-- oculta, programada sin abrir o sin ganador no comprometen premio).
--
-- casa_house_total_v2 (el «Balance de la casa» del panel; solo lo llama la app)
-- pasa a sumar real_house_cop. Con solo inscripciones reales da lo mismo que
-- antes.
--
-- Qué NO cambia: el pozo, los inscritos públicos, el ranking ni el reparto. Los
-- jugadores de la casa siguen sumando al pozo y compitiendo (decisión de la
-- 169) y un cupo gratis gana igual que uno pagado. Ninguna fila cambia.
-- Regresión: scripts/casa-admin-money-check.sql.

SET client_encoding = 'UTF8';

CREATE FUNCTION public.casa_admin_money_v1(p_ids uuid[])
RETURNS TABLE(polla_id uuid, real_entries integer, house_entries integer, free_entries integer,
  real_gross_cop bigint, real_house_cop bigint)
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
    SELECT o.polla_id,
      coalesce(sum(o.amount_cop) FILTER (WHERE NOT EXISTS(
        SELECT 1 FROM public.casa_admin_players a WHERE a.user_id=o.user_id)),0)::bigint AS real_paid
    FROM public.casa_payouts o
    WHERE o.polla_id=ANY(p_ids) AND o.prize_kind='pozo'
    GROUP BY o.polla_id
  )
  SELECT p.id, coalesce(c.real_n,0), coalesce(c.house_n,0), coalesce(c.gift_n,0), coalesce(c.real_gross,0),
    coalesce(c.real_gross,0) - CASE
      WHEN p.status IN ('borrador','anulada') OR p.publication_mode='oculta'
        OR (p.publication_mode='programada' AND p.opens_at>now())
        OR p.settlement_outcome='house_retained_zero_points' THEN 0
      -- Resuelta: lo que de verdad salió de caja hacia personas reales.
      WHEN p.status='resuelta' AND o.polla_id IS NOT NULL THEN o.real_paid
      ELSE s.prize_cop
    END
  FROM public.casa_pollas p
  JOIN public.casa_pot_summaries_v2(p_ids) s ON s.polla_id=p.id
  LEFT JOIN counts c ON c.polla_id=p.id
  LEFT JOIN payouts o ON o.polla_id=p.id
  WHERE p.id=ANY(p_ids);
$$;

CREATE OR REPLACE FUNCTION public.casa_house_total_v2(p_ids uuid[])
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(sum(real_house_cop),0)::bigint FROM public.casa_admin_money_v1(p_ids);
$$;

REVOKE ALL ON FUNCTION public.casa_admin_money_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_admin_money_v1(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.casa_house_total_v2(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_house_total_v2(uuid[]) TO service_role;
