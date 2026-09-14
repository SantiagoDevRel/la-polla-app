-- scripts/telegram-login-single-link-check.sql — Regresión de la migración 120
-- (un solo enlace vigente por cuenta de Telegram). SOLO contra Supabase LOCAL,
-- con 119 y 120 aplicadas: todo corre en una transacción que se revierte.
--
--   docker cp scripts/telegram-login-single-link-check.sql supabase_db_la-polla:/tmp/tg120.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/tg120.sql
--
-- Termina con "telegram-login-single-link-check OK". Cualquier ASSERT roto
-- aborta. scripts/telegram-login-v2-check.sql (119) sigue vigente con 120.

\set ON_ERROR_STOP 1
BEGIN;

CREATE FUNCTION pg_temp.live_links(p_tg bigint) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.telegram_login_requests r
   WHERE r.telegram_user_id = p_tg
     AND r.status = 'approved'
     AND r.expires_at > clock_timestamp();
$$;

DO $$
DECLARE
  ana uuid := 'c1000000-0000-4000-8000-000000000120';
  beto uuid := 'c2000000-0000-4000-8000-000000000120';
  caro uuid := 'c3000000-0000-4000-8000-000000000120';
  req_a uuid;
  req_b uuid;
  req_c uuid;
  req_d uuid;
  r record;
BEGIN
  -- Tres cuentas de La Polla, cada una vinculada a su cuenta de Telegram.
  INSERT INTO auth.users (id, phone) VALUES
    (ana, '351912000120'), (beto, '573120000120'), (caro, '14155550120');
  INSERT INTO public.telegram_login_identities (user_id, telegram_user_id) VALUES
    (ana, 8101), (beto, 8102), (caro, 8103);

  -- ── Dos solicitudes del navegador aprobadas por la misma cuenta ──
  PERFORM public.telegram_login_request_create(md5('a1') || md5('a2'), md5('ba1') || md5('ba2'), 'es', '203.0.113.120', NULL);
  SELECT request_id INTO req_a FROM public.telegram_login_request_find(md5('a1') || md5('a2'));
  SELECT * INTO r FROM public.telegram_login_request_approve(req_a, 8101, ana, '+351912000120', repeat('a', 64));
  ASSERT r.status = 'ok';
  ASSERT pg_temp.live_links(8101) = 1;

  PERFORM public.telegram_login_request_create(md5('b1') || md5('b2'), md5('bb1') || md5('bb2'), 'es', '203.0.113.120', NULL);
  SELECT request_id INTO req_b FROM public.telegram_login_request_find(md5('b1') || md5('b2'));
  SELECT * INTO r FROM public.telegram_login_request_approve(req_b, 8101, ana, '+351912000120', repeat('b', 64));
  ASSERT r.status = 'ok';
  ASSERT pg_temp.live_links(8101) = 1, 'aprobar otra solicitud deja un solo enlace vivo';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('a', 64), md5('ba1') || md5('ba2'));
  ASSERT r.status = 'expired' AND r.phone_e164 IS NULL, 'el enlace anterior ya no sirve';
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('a', 64), md5('ba1') || md5('ba2'));
  ASSERT r.status = 'expired' AND r.user_id IS NULL, 'el enlace anterior no abre sesión';
  SELECT * INTO r FROM public.telegram_login_request_status(md5('ba1') || md5('ba2'));
  ASSERT r.status = 'expired', 'la pestaña de la solicitud anterior ve vencida';
  SELECT * INTO r FROM public.telegram_login_requests WHERE id = req_a;
  ASSERT r.expires_at <= clock_timestamp() AND r.approved_at IS NOT NULL AND r.link_token_hash = repeat('a', 64),
    'se vence sin borrar la historia de la fila';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('b', 64), NULL);
  ASSERT r.status = 'ok';

  -- ── Un enlace suelto vence también el de una solicitud del navegador ──
  SELECT * INTO r FROM public.telegram_login_link_issue(8101, ana, '+351912000120', repeat('c', 64), 'es');
  ASSERT r.status = 'ok';
  ASSERT pg_temp.live_links(8101) = 1;
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('b', 64), NULL);
  ASSERT r.status = 'expired', 'emitir un enlace suelto vence el de la solicitud (119 no lo hacía)';
  SELECT * INTO r FROM public.telegram_login_request_status(md5('bb1') || md5('bb2'));
  ASSERT r.status = 'expired';

  -- ── Y aprobar una solicitud vence el enlace suelto ──
  PERFORM public.telegram_login_request_create(md5('c1') || md5('c2'), md5('bc1') || md5('bc2'), 'es', '203.0.113.120', NULL);
  SELECT request_id INTO req_c FROM public.telegram_login_request_find(md5('c1') || md5('c2'));
  SELECT * INTO r FROM public.telegram_login_request_approve(req_c, 8101, ana, '+351912000120', repeat('d', 64));
  ASSERT r.status = 'ok';
  ASSERT pg_temp.live_links(8101) = 1;
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('c', 64), NULL);
  ASSERT r.status = 'expired', 'aprobar una solicitud vence el enlace suelto';
  SELECT * INTO r FROM public.telegram_login_link_consume(repeat('d', 64), md5('bc1') || md5('bc2'));
  ASSERT r.status = 'ok' AND r.user_id = ana AND r.same_browser;

  -- Un enlace canjeado no cambia al emitir otro.
  SELECT * INTO r FROM public.telegram_login_link_issue(8101, ana, '+351912000120', repeat('e', 64), 'en');
  ASSERT r.status = 'ok';
  SELECT * INTO r FROM public.telegram_login_requests WHERE id = req_c;
  ASSERT r.status = 'consumed' AND r.consumed_at IS NOT NULL, 'lo ya canjeado sigue canjeado';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('d', 64), NULL);
  ASSERT r.status = 'used';
  ASSERT pg_temp.live_links(8101) = 1;

  -- ── Otra cuenta de Telegram no se toca ──
  SELECT * INTO r FROM public.telegram_login_link_issue(8102, beto, '+573120000120', repeat('f', 64), 'es');
  ASSERT r.status = 'ok';
  ASSERT pg_temp.live_links(8101) = 1 AND pg_temp.live_links(8102) = 1;
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('e', 64), NULL);
  ASSERT r.status = 'ok', 'el enlace de otra cuenta de Telegram sigue vivo';
  SELECT * INTO r FROM public.telegram_login_link_issue(8101, beto, '+573120000120', repeat('0', 64), 'es');
  ASSERT r.status = 'not_linked', 'un grant inválido no vence nada';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('e', 64), NULL);
  ASSERT r.status = 'ok';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('f', 64), NULL);
  ASSERT r.status = 'ok';

  -- ── Volver a aprobar la misma solicitud (tocó Iniciar dos veces) ──
  -- Una fila aprobada anterior a 120 (dos vivas a la vez) se vence al
  -- reemplazar el enlace de la solicitud.
  PERFORM public.telegram_login_request_create(md5('d1') || md5('d2'), md5('bd1') || md5('bd2'), 'en', '203.0.113.120', NULL);
  SELECT request_id INTO req_d FROM public.telegram_login_request_find(md5('d1') || md5('d2'));
  SELECT * INTO r FROM public.telegram_login_request_approve(req_d, 8103, caro, '+14155550120', repeat('1', 64));
  ASSERT r.status = 'ok' AND r.locale = 'en';
  INSERT INTO public.telegram_login_requests
    (status, locale, telegram_user_id, user_id, phone_e164, link_token_hash, created_at, approved_at, expires_at)
  VALUES
    ('approved', 'en', 8103, caro, '+14155550120', repeat('2', 64),
     clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '5 minutes');
  ASSERT pg_temp.live_links(8103) = 2, 'estado heredado de 119: dos vivos';
  SELECT * INTO r FROM public.telegram_login_request_approve(req_d, 8103, caro, '+14155550120', repeat('3', 64));
  ASSERT r.status = 'ok';
  ASSERT pg_temp.live_links(8103) = 1, 'la re-aprobación deja un solo enlace vivo';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('1', 64), NULL);
  ASSERT r.status = 'invalid', 'el enlace reemplazado ya no existe';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('2', 64), NULL);
  ASSERT r.status = 'expired';
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('3', 64), md5('bd1') || md5('bd2'));
  ASSERT r.status = 'ok' AND r.same_browser;

  -- Los topes siguen contando aprobaciones vencidas: 5 / 15 min por cuenta.
  SELECT * INTO r FROM public.telegram_login_link_issue(8101, ana, '+351912000120', repeat('4', 64), 'es');
  ASSERT r.status = 'rate_limited', format('se esperaba rate_limited, llegó %s', r.status);
  SELECT * INTO r FROM public.telegram_login_link_peek(repeat('e', 64), NULL);
  ASSERT r.status = 'ok', 'un intento rechazado por tope no vence el enlace vivo';
END $$;

-- Permisos y definición: solo service_role, SECURITY DEFINER, search_path fijo.
DO $$
DECLARE
  fn text;
  p record;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.telegram_login_request_approve(uuid,bigint,uuid,text,text)',
    'public.telegram_login_link_issue(bigint,uuid,text,text,text)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), fn || ': anon puede ejecutar';
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), fn || ': authenticated puede ejecutar';
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), fn || ': service_role no puede ejecutar';
    SELECT prosecdef, proconfig INTO p FROM pg_proc WHERE oid = fn::regprocedure;
    ASSERT p.prosecdef, fn || ': no es SECURITY DEFINER';
    ASSERT p.proconfig @> ARRAY['search_path=public, pg_temp'], fn || ': search_path sin fijar';
  END LOOP;
END $$;

SELECT 'telegram-login-single-link-check OK' AS result;
ROLLBACK;
