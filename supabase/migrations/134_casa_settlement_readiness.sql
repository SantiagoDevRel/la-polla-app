-- 134_casa_settlement_readiness.sql — cuándo una polla queda lista para
-- repartir y a quién se le pagaría, antes de confirmar el reparto.
--
-- Pedido del dueño (2026-09-17): «cuando termine el último partido de la
-- polla, comprobado con API-Football, calculas bien los ganadores y muestras
-- las cuentas de cada uno para pagarles, y subes los comprobantes».
--
-- El reparto sigue siendo una confirmación del administrador (no se puede
-- deshacer). Esta migración solo agrega LECTURAS para que el panel muestre,
-- apenas se verifica el último partido:
--   1. casa_settlement_readiness_v2(ids): por polla de pozo en dinero
--      (partidos o preguntas, abierta/cerrada, sin desempate de objeto), cuántos
--      partidos/preguntas faltan, casos abiertos, comprobantes por revisar,
--      inscripciones pagadas y si las inscripciones ya cerraron. `ready` usa
--      las MISMAS condiciones que casa_settle_polla_v2 (menos el barrido de
--      casos, que escribe y corre al repartir).
--   2. casa_provisional_payouts_v2(polla): el reparto por PERSONA que haría
--      casa_settle_polla_v2 ahora mismo (suma de sus participaciones
--      ganadoras, con el mismo redondeo). Sale de casa_provisional_prizes_v2
--      (133); la plata no se suma en TypeScript.
--
-- No escribe nada, no toca pollas, pronósticos, pagos ni partidos.
-- STABLE, SECURITY DEFINER, search_path fijo, EXECUTE solo para service_role.

CREATE OR REPLACE FUNCTION public.casa_settlement_readiness_v2(p_ids uuid[])
RETURNS TABLE(
  polla_id uuid,
  total_items integer,
  done_items integer,
  open_issues integer,
  pending_proofs integer,
  paid_entries integer,
  inscriptions_closed boolean,
  ready boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH p AS (
    SELECT cp.id, cp.kind, cp.status, cp.closes_at
      FROM public.casa_pollas cp
     WHERE cp.id = ANY(p_ids)
       AND cp.archived_at IS NULL
       AND cp.status IN ('abierta','cerrada')
       AND cp.prize_kind = 'pozo'
       AND cp.kind IN ('partidos','manual')
       AND NOT EXISTS (SELECT 1 FROM public.casa_object_draws d WHERE d.polla_id = cp.id)
  ), c AS (
    SELECT p.id, p.status, p.closes_at,
      CASE WHEN p.kind = 'partidos'
        THEN (SELECT count(*) FROM public.casa_polla_matches pm
               WHERE pm.polla_id = p.id AND pm.voided_at IS NULL)
        ELSE (SELECT count(*) FROM public.casa_questions q WHERE q.polla_id = p.id)
      END AS total,
      CASE WHEN p.kind = 'partidos'
        THEN (SELECT count(*) FROM public.casa_polla_matches pm
                JOIN public.matches m ON m.id = pm.match_id
               WHERE pm.polla_id = p.id AND pm.voided_at IS NULL AND m.final_verified_at IS NOT NULL)
        ELSE (SELECT count(*) FROM public.casa_questions q
               WHERE q.polla_id = p.id AND q.resolved_at IS NOT NULL)
      END AS done,
      (SELECT count(DISTINCT mi.id) FROM public.casa_match_issues mi
         JOIN public.casa_polla_matches pm ON pm.match_id = mi.match_id
        WHERE pm.polla_id = p.id AND pm.voided_at IS NULL AND mi.decision IS NULL) AS issues,
      (SELECT count(*) FROM public.casa_entries e
         LEFT JOIN public.casa_entry_proof_attempts a ON a.id = e.current_proof_attempt_id
        WHERE e.polla_id = p.id AND e.status = 'pendiente'
          AND (e.proof_path IS NOT NULL OR (a.state = 'uploading' AND a.expires_at > clock_timestamp()))) AS pending,
      (SELECT count(*) FROM public.casa_entries e WHERE e.polla_id = p.id AND e.status = 'pagada') AS paid
    FROM p
  )
  SELECT c.id,
         c.total::integer,
         c.done::integer,
         c.issues::integer,
         c.pending::integer,
         c.paid::integer,
         (c.status = 'cerrada' OR c.closes_at <= clock_timestamp()),
         (c.total > 0 AND c.done = c.total AND c.issues = 0 AND c.pending = 0 AND c.paid > 0
           AND (c.status = 'cerrada' OR c.closes_at <= clock_timestamp()))
    FROM c;
$$;

CREATE OR REPLACE FUNCTION public.casa_provisional_payouts_v2(p_polla_id uuid)
RETURNS TABLE(user_id uuid, amount_cop bigint, winning_entries integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT pr.user_id, sum(pr.amount_cop)::bigint, count(*)::integer
    FROM public.casa_provisional_prizes_v2(p_polla_id) pr
   GROUP BY pr.user_id
   ORDER BY pr.user_id;
$$;

-- ── Permisos: solo servidor ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.casa_settlement_readiness_v2(uuid[]),
  public.casa_provisional_payouts_v2(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_settlement_readiness_v2(uuid[]),
  public.casa_provisional_payouts_v2(uuid)
  TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT proname, proacl FROM pg_proc WHERE proname IN
--     ('casa_settlement_readiness_v2','casa_provisional_payouts_v2'); -- solo postgres + service_role
