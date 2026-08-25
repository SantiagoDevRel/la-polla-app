-- 084_fix_pot_count.sql
-- ============================================================================
-- BUG: una polla sin NADIE inscrito reportaba "1 jugando".
--
-- casa_polla_pot hacía:
--
--     SELECT COUNT(*) ...
--     FROM casa_pollas p
--     LEFT JOIN casa_entries e ON e.polla_id = p.id AND e.status = 'pagada'
--
-- Con LEFT JOIN y cero inscripciones pagadas, Postgres igual produce UNA fila
-- (la de la polla, con las columnas de `e` en NULL). `COUNT(*)` cuenta filas,
-- no valores, así que contaba esa fila fantasma y devolvía 1.
--
-- El resto de las cifras estaban bien de casualidad: SUM() ignora los NULL,
-- así que gross/prize/house daban 0 correctamente. Por eso el sintoma era
-- raro y facil de pasar por alto — "$0 de pozo, 1 jugando".
--
-- El arreglo es contar una COLUMNA de la tabla joineada en vez de contar
-- filas: COUNT(e.id) ignora los NULL igual que SUM.
--
-- Verificado antes del fix contra prod: finde-laliga-marcador y rifa-camiseta
-- tenian 0 inscripciones pagadas y el RPC devolvia paid_entries = 1.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.casa_polla_pot(p_polla_id uuid)
RETURNS TABLE (
  paid_entries integer,
  gross_cop    bigint,
  prize_cop    bigint,
  house_cop    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(e.id)::integer                                           AS paid_entries,
    COALESCE(SUM(e.amount_cop), 0)::bigint                         AS gross_cop,
    FLOOR(COALESCE(SUM(e.amount_cop), 0)
          * (100 - p.house_cut_pct) / 100.0)::bigint               AS prize_cop,
    (COALESCE(SUM(e.amount_cop), 0)
     - FLOOR(COALESCE(SUM(e.amount_cop), 0)
             * (100 - p.house_cut_pct) / 100.0))::bigint           AS house_cop
  FROM public.casa_pollas p
  LEFT JOIN public.casa_entries e
    ON e.polla_id = p.id AND e.status = 'pagada'
  WHERE p.id = p_polla_id
  GROUP BY p.house_cut_pct;
$$;

-- Los GRANT se reaplican porque CREATE OR REPLACE conserva los privilegios,
-- pero si algun dia esta migracion corre sobre una base donde la funcion no
-- existia, Supabase la crearia abierta a anon/authenticated (ver 083).
REVOKE ALL ON FUNCTION public.casa_polla_pot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_polla_pot(uuid) TO service_role;
