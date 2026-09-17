-- scripts/casa-exact-score-check.sql — regresión de la migración 132:
-- en las pollas de marcador NUEVAS solo suma el marcador exacto.
--
--   Get-Content -Raw -Encoding UTF8 scripts/casa-exact-score-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
--
-- ⚠️ SOLO contra un Supabase LOCAL. Arma sus propias fixtures (uuids con el
-- prefijo `e1e1e1e1`, slugs `test-exact-%`, partidos `test-exact:%`, gente con
-- teléfono +5730000001x), las borra al empezar y termina en ROLLBACK. Nunca
-- contra producción.
--
-- Qué asegura (cada caso falla con ASSERT):
--   A · el DEFAULT de casa_pollas.points_one_team es 0
--   B · casa_create_polla_v2 crea con 3 / 3 / 0 (resultado / exacto / un equipo)
--   C · en esa polla, acertar los goles de un solo equipo da 0 y el exacto 3
--   D · una polla anterior (points_one_team = 1) sigue dando 1: nada se repuntúa
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control), 'v2');
SELECT set_config('app.casa_contract', '2', true);

-- ── limpieza de corridas anteriores de ESTE harness ──────────────────────
DELETE FROM public.casa_payouts WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-exact-%');
DELETE FROM public.casa_picks   WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-exact-%');
DELETE FROM public.casa_entries WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-exact-%');
DELETE FROM public.casa_polla_matches WHERE polla_id IN (SELECT id FROM public.casa_pollas WHERE slug LIKE 'test-exact-%');
DELETE FROM public.casa_pollas   WHERE slug LIKE 'test-exact-%';
DELETE FROM public.matches       WHERE external_id LIKE 'test-exact:%';
DELETE FROM public.users         WHERE whatsapp_number LIKE '+5730000001%';

INSERT INTO public.users (id, whatsapp_number, display_name, is_admin) VALUES
  ('e1e1e1e1-1111-4111-8111-000000000010', '+573000000010', 'Admin Exacto', true),
  ('e1e1e1e1-1111-4111-8111-000000000011', '+573000000011', 'Ana Exacto',   false);

-- Saque en 2 horas: los pronósticos se guardan antes del bloqueo de 5 minutos.
INSERT INTO public.matches (id, external_id, tournament, home_team, away_team, scheduled_at, status) VALUES
  ('e1e1e1e1-2222-4222-8222-000000000011', 'test-exact:1', 'premier_2025', 'Equipo A1', 'Equipo B1', now() + interval '2 hours', 'scheduled'),
  ('e1e1e1e1-2222-4222-8222-000000000012', 'test-exact:2', 'premier_2025', 'Equipo A2', 'Equipo B2', now() + interval '2 hours', 'scheduled');

-- ════════════════════════════════════════════════════════════════════════
-- A · DEFAULT de la columna
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_default text;
BEGIN
  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'casa_pollas' AND column_name = 'points_one_team';
  ASSERT v_default = '0', format('A: el DEFAULT de points_one_team debe ser 0, es %s', v_default);
  RAISE NOTICE 'A OK · DEFAULT points_one_team = 0';
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- B · Crear por el RPC → 3 / 3 / 0
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r jsonb; p public.casa_pollas;
BEGIN
  r := public.casa_create_polla_v2(jsonb_build_object(
    'kind', 'partidos', 'prizeKind', 'pozo', 'name', 'Prueba solo exacto', 'tournament', 'premier_2025',
    'scoringMode', 'marcador', 'entryPriceCop', 10000, 'houseCutPct', 30, 'closeMode', 'auto',
    'matchIds', jsonb_build_array('e1e1e1e1-2222-4222-8222-000000000011', 'e1e1e1e1-2222-4222-8222-000000000012'),
    'payoutMethod', 'Nequi', 'payoutAccount', '3000000000', 'payoutAccountName', 'La Casa', 'publicationMode', 'ahora'
  ), 'test-exact-nueva', 'e1e1e1e1-1111-4111-8111-000000000010', 2);
  SELECT * INTO p FROM public.casa_pollas WHERE id = (r->>'id')::uuid;
  ASSERT p.points_result = 3 AND p.points_exact = 3, format('B: resultado/exacto deben ser 3/3, son %s/%s', p.points_result, p.points_exact);
  ASSERT p.points_one_team = 0, format('B: points_one_team debe ser 0 en una polla nueva, es %s', p.points_one_team);
  ASSERT p.status = 'abierta', format('B: la polla debía publicarse, quedó %s', p.status);
  RAISE NOTICE 'B OK · creada con 3/3/0 · %', r;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- C · Puntaje en la polla nueva: un equipo = 0, exacto = 3
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop, entry_number)
SELECT 'e1e1e1e1-4444-4444-8444-000000000c01', id, 'e1e1e1e1-1111-4111-8111-000000000011', 'pagada', 10000, 1
  FROM public.casa_pollas WHERE slug = 'test-exact-nueva';
-- Partido 1: pone 2-1 (real 2-0 → solo un equipo). Partido 2: pone 2-0 (exacto).
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, home_score, away_score)
SELECT 'e1e1e1e1-4444-4444-8444-000000000c01', id, 'e1e1e1e1-1111-4111-8111-000000000011', 'e1e1e1e1-2222-4222-8222-000000000011', 2, 1 FROM public.casa_pollas WHERE slug = 'test-exact-nueva';
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, home_score, away_score)
SELECT 'e1e1e1e1-4444-4444-8444-000000000c01', id, 'e1e1e1e1-1111-4111-8111-000000000011', 'e1e1e1e1-2222-4222-8222-000000000012', 2, 0 FROM public.casa_pollas WHERE slug = 'test-exact-nueva';

-- ════════════════════════════════════════════════════════════════════════
-- D · Una polla anterior conserva su punto por un solo equipo
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.casa_pollas (id, slug, name, kind, tournament, scoring_mode, entry_price_cop, house_cut_pct, status, closes_at, created_by, payout_method, payout_account, payout_account_name, points_exact, points_one_team, points_result)
VALUES ('e1e1e1e1-3333-4333-8333-00000000000d', 'test-exact-vieja', 'D · vieja', 'partidos', 'premier_2025', 'marcador', 10000, 30, 'abierta', now() + interval '1 hour', 'e1e1e1e1-1111-4111-8111-000000000010', 'Nequi', '3000000000', 'La Casa', 3, 1, 3);
INSERT INTO public.casa_polla_matches (polla_id, match_id, order_index) VALUES
  ('e1e1e1e1-3333-4333-8333-00000000000d', 'e1e1e1e1-2222-4222-8222-000000000011', 0);
INSERT INTO public.casa_entries (id, polla_id, user_id, status, amount_cop, entry_number) VALUES
  ('e1e1e1e1-4444-4444-8444-000000000d01', 'e1e1e1e1-3333-4333-8333-00000000000d', 'e1e1e1e1-1111-4111-8111-000000000011', 'pagada', 10000, 1);
INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, home_score, away_score) VALUES
  ('e1e1e1e1-4444-4444-8444-000000000d01', 'e1e1e1e1-3333-4333-8333-00000000000d', 'e1e1e1e1-1111-4111-8111-000000000011', 'e1e1e1e1-2222-4222-8222-000000000011', 2, 1);

-- Se juegan y se verifican los 90': 2-0 en los dos.
UPDATE public.matches SET home_score = 2, away_score = 0, status = 'finished', final_verified_at = now()
 WHERE id IN ('e1e1e1e1-2222-4222-8222-000000000011', 'e1e1e1e1-2222-4222-8222-000000000012');

DO $$
DECLARE v_polla uuid; v_uno int; v_exacto int; v_total int;
BEGIN
  SELECT id INTO v_polla FROM public.casa_pollas WHERE slug = 'test-exact-nueva';
  PERFORM public.casa_score_polla(v_polla);
  SELECT points_earned INTO v_uno    FROM public.casa_picks WHERE polla_id = v_polla AND match_id = 'e1e1e1e1-2222-4222-8222-000000000011';
  SELECT points_earned INTO v_exacto FROM public.casa_picks WHERE polla_id = v_polla AND match_id = 'e1e1e1e1-2222-4222-8222-000000000012';
  ASSERT v_uno = 0, format('C: acertar un solo equipo debe dar 0, dio %s', v_uno);
  ASSERT v_exacto = 3, format('C: el marcador exacto debe dar 3, dio %s', v_exacto);
  SELECT points INTO v_total FROM public.casa_leaderboard(v_polla) WHERE user_id = 'e1e1e1e1-1111-4111-8111-000000000011';
  ASSERT v_total = 3, format('C: la tabla debe sumar 3, suma %s', v_total);
  RAISE NOTICE 'C OK · un equipo = 0, exacto = 3';
END $$;

DO $$
DECLARE v_uno int;
BEGIN
  PERFORM public.casa_score_polla('e1e1e1e1-3333-4333-8333-00000000000d');
  SELECT points_earned INTO v_uno FROM public.casa_picks WHERE polla_id = 'e1e1e1e1-3333-4333-8333-00000000000d';
  ASSERT v_uno = 1, format('D: la polla vieja debe seguir dando 1 por un solo equipo, dio %s', v_uno);
  RAISE NOTICE 'D OK · polla anterior conserva 1 punto';
END $$;

ROLLBACK;
