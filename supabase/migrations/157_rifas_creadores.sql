-- 157_rifas_creadores.sql
--
-- Rifas de creadores habilitados (docs/rifas-spec.md, docs/rifas.md).
--
-- Un administrador habilita a ciertos usuarios como «creadores de rifas». Cada
-- creador publica SUS rifas (00–99 como máximo), el dinero va directo a SU
-- cuenta (nunca pasa por La Polla) y él mismo revisa los comprobantes.
--
-- Por qué tablas propias (rifa_*) y no casa_*: Casa asume que La Polla cobra y
-- reparte. casa_entries dispara el conteo de invitados (casa_referral_sync),
-- los guards de v2 (casa_v2_write_guard), el pozo 70/30, la cola de recibos del
-- administrador y los avisos de Telegram a los administradores. Nada de eso
-- aplica cuando cobra un tercero. Mezclarlo rompería la liquidación de Casa o
-- abriría a un creador datos de la casa. Se reutiliza CÓDIGO (carga firmada,
-- verificación de bytes, compresión, editor de cuenta, botón Copiar), no filas.
--
-- Contrato:
--   * Autoridad en SQL. Todas las RPC son SECURITY DEFINER, reciben el actor
--     (uuid de la sesión ya validada en el servidor) y solo las ejecuta
--     service_role. Ninguna confía en el cliente.
--   * La reserva es atómica: bloqueo de la fila de la rifa (FOR UPDATE) +
--     índice único parcial (rifa, número) sobre boletas vivas.
--   * Vencimiento perezoso: una reserva sin comprobante vence a los
--     rifa_settings.reservation_minutes (30). Las lecturas la tratan como libre
--     y las escrituras la marcan «liberado» bajo el bloqueo. Sin cron.
--   * Privacidad (Ley 1581): nombres y celulares de compradores solo en
--     rifa_creator_view_v1, que exige ser el creador (ni siquiera un admin).
--   * Privada = solo creador y administradores; se valida aquí y en RLS.
--   * Todo detrás de RIFAS_ENABLED en la app; esta migración no activa nada.
--
-- Decisiones por defecto (en rifa_settings, confirmables por el dueño):
--   reservation_minutes=30, listing_mode='enlace', max_active_rifas_per_creator=3,
--   max_pending_numbers_per_buyer=10. La Polla no cobra por rifa (no hay campo).
--   Número ganador no vendido: el creador elige 'volver_a_jugar' o 'desierta'.

BEGIN;

-- ─── Configuración (un solo lugar) ──────────────────────────────────────────
CREATE TABLE public.rifa_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  reservation_minutes integer NOT NULL DEFAULT 30 CHECK (reservation_minutes BETWEEN 5 AND 1440),
  upload_minutes integer NOT NULL DEFAULT 15 CHECK (upload_minutes BETWEEN 5 AND 120),
  max_active_rifas_per_creator integer NOT NULL DEFAULT 3 CHECK (max_active_rifas_per_creator BETWEEN 1 AND 50),
  max_pending_numbers_per_buyer integer NOT NULL DEFAULT 10 CHECK (max_pending_numbers_per_buyer BETWEEN 1 AND 100),
  max_reports_per_user_day integer NOT NULL DEFAULT 10 CHECK (max_reports_per_user_day BETWEEN 1 AND 100),
  listing_mode text NOT NULL DEFAULT 'enlace' CHECK (listing_mode IN ('enlace', 'publico')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.rifa_settings DEFAULT VALUES;
COMMENT ON TABLE public.rifa_settings IS
  'Única fila con las decisiones configurables de rifas: vencimiento de reservas, límites anti-abuso y modo de listado.';

-- ─── Creadores habilitados ───────────────────────────────────────────────────
CREATE TABLE public.rifa_creators (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.users(id),
  revoked_at timestamptz,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
COMMENT ON TABLE public.rifa_creators IS
  'Permiso para crear rifas. Solo users.is_admin lo asigna o quita. El historial completo queda en rifa_events.';

-- ─── Rifas ───────────────────────────────────────────────────────────────────
CREATE TABLE public.rifas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]{8}$'),
  creator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 80),
  prize_kind text NOT NULL CHECK (prize_kind IN ('dinero', 'texto')),
  prize_cop bigint CHECK (prize_cop IS NULL OR prize_cop BETWEEN 1000 AND 1000000000),
  prize_text text CHECK (prize_text IS NULL OR char_length(btrim(prize_text)) BETWEEN 3 AND 120),
  prize_image_path text,
  number_count integer NOT NULL DEFAULT 100 CHECK (number_count BETWEEN 2 AND 100),
  price_cop integer NOT NULL CHECK (price_cop BETWEEN 500 AND 1000000),
  lottery_name text NOT NULL CHECK (char_length(btrim(lottery_name)) BETWEEN 2 AND 60),
  digits_rule text NOT NULL DEFAULT 'ultimas_dos' CHECK (digits_rule IN ('ultimas_dos', 'primeras_dos')),
  draw_at timestamptz NOT NULL,
  visibility text NOT NULL DEFAULT 'privada' CHECK (visibility IN ('privada', 'publica')),
  payment_method text NOT NULL CHECK (payment_method IN ('nequi', 'bancolombia', 'daviplata', 'otro')),
  payment_account text NOT NULL CHECK (char_length(btrim(payment_account)) BETWEEN 3 AND 60),
  payment_holder text NOT NULL CHECK (char_length(btrim(payment_holder)) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'resuelta', 'desierta')),
  winning_number integer CHECK (winning_number IS NULL OR winning_number BETWEEN 0 AND 99),
  winner_ticket_id uuid,
  resolved_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid REFERENCES public.users(id),
  hidden_reason text CHECK (hidden_reason IS NULL OR char_length(hidden_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rifas_prize_shape CHECK (
    (prize_kind = 'dinero' AND prize_cop IS NOT NULL AND prize_text IS NULL)
    OR (prize_kind = 'texto' AND prize_text IS NOT NULL AND prize_cop IS NULL)),
  CONSTRAINT rifas_result_shape CHECK (
    (status = 'abierta' AND resolved_at IS NULL AND winner_ticket_id IS NULL)
    OR (status = 'resuelta' AND winning_number IS NOT NULL AND winner_ticket_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status = 'desierta' AND winning_number IS NOT NULL AND winner_ticket_id IS NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX rifas_creator_idx ON public.rifas (creator_id, created_at DESC);
CREATE TRIGGER set_rifas_updated_at BEFORE UPDATE ON public.rifas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Comprobantes (un comprobante puede cubrir varios números) ─────────────
CREATE TABLE public.rifa_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  numbers integer[] NOT NULL CHECK (cardinality(numbers) BETWEEN 1 AND 100),
  amount_cop bigint NOT NULL CHECK (amount_cop > 0),
  path text NOT NULL UNIQUE,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  content_bytes integer NOT NULL CHECK (content_bytes BETWEEN 1 AND 8388608),
  state text NOT NULL DEFAULT 'subiendo'
    CHECK (state IN ('subiendo', 'en_revision', 'aprobado', 'rechazado', 'fallido', 'vencido')),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id),
  reject_reason text CHECK (reject_reason IS NULL OR char_length(reject_reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, request_id)
);
CREATE INDEX rifa_proofs_rifa_state_idx ON public.rifa_proofs (rifa_id, state, submitted_at);

-- ─── Números tomados (un número libre no tiene fila viva) ───────────────────
CREATE TABLE public.rifa_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number BETWEEN 0 AND 99),
  state text NOT NULL CHECK (state IN ('reservado', 'en_revision', 'pagado', 'liberado')),
  origin text NOT NULL CHECK (origin IN ('app', 'fuera')),
  buyer_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  buyer_name text CHECK (buyer_name IS NULL OR char_length(btrim(buyer_name)) BETWEEN 2 AND 80),
  buyer_phone text CHECK (buyer_phone IS NULL OR buyer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  proof_id uuid REFERENCES public.rifa_proofs(id) ON DELETE SET NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  paid_at timestamptz,
  paid_by uuid REFERENCES public.users(id),
  released_at timestamptz,
  release_reason text CHECK (release_reason IS NULL OR release_reason IN ('vencida', 'rechazada', 'liberada', 'cancelada')),
  created_by uuid NOT NULL REFERENCES public.users(id),
  CONSTRAINT rifa_tickets_origin_shape CHECK (
    (origin = 'app' AND buyer_name IS NULL AND buyer_phone IS NULL)
    OR (origin = 'fuera' AND buyer_id IS NULL AND buyer_name IS NOT NULL AND buyer_phone IS NOT NULL)),
  CONSTRAINT rifa_tickets_release_shape CHECK ((state = 'liberado') = (released_at IS NOT NULL)),
  CONSTRAINT rifa_tickets_paid_shape CHECK ((state = 'pagado') = (paid_at IS NOT NULL))
);
-- La garantía de fondo: un número vivo por rifa. La reserva además bloquea la
-- rifa, así que dos compradores simultáneos se serializan y el segundo recibe
-- NUMBER_TAKEN con mensaje claro; este índice es la red por si alguien no bloquea.
CREATE UNIQUE INDEX rifa_tickets_live_number ON public.rifa_tickets (rifa_id, number) WHERE state <> 'liberado';
CREATE INDEX rifa_tickets_buyer_idx ON public.rifa_tickets (buyer_id) WHERE buyer_id IS NOT NULL;
CREATE INDEX rifa_tickets_phone_idx ON public.rifa_tickets (buyer_phone) WHERE buyer_phone IS NOT NULL;
CREATE INDEX rifa_tickets_proof_idx ON public.rifa_tickets (proof_id) WHERE proof_id IS NOT NULL;
ALTER TABLE public.rifas ADD CONSTRAINT rifas_winner_ticket_fk
  FOREIGN KEY (winner_ticket_id) REFERENCES public.rifa_tickets(id);

-- ─── Historial de sorteos (transparencia: se muestra a todos) ──────────────
CREATE TABLE public.rifa_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number BETWEEN 0 AND 99),
  lottery_name text NOT NULL,
  draw_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ganador', 'volver_a_jugar', 'desierta')),
  ticket_id uuid REFERENCES public.rifa_tickets(id),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rifa_draws_rifa_idx ON public.rifa_draws (rifa_id, created_at);

-- ─── Auditoría (sin nombres ni celulares) ───────────────────────────────────
CREATE TABLE public.rifa_events (
  id bigserial PRIMARY KEY,
  rifa_id uuid REFERENCES public.rifas(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rifa_events_rifa_idx ON public.rifa_events (rifa_id, created_at DESC);
CREATE INDEX rifa_events_subject_idx ON public.rifa_events (subject_user_id, created_at DESC);

-- ─── Reportes de usuarios ───────────────────────────────────────────────────
CREATE TABLE public.rifa_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rifa_id, reporter_id)
);

-- ─── Embudo: rifas abiertas por enlace, visitas anónimas y cuentas nuevas ──
CREATE TABLE public.rifa_visits (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rifa_id)
);
CREATE TABLE public.rifa_link_views (
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  day date NOT NULL,
  anonymous_views integer NOT NULL DEFAULT 0 CHECK (anonymous_views >= 0),
  PRIMARY KEY (rifa_id, day)
);
CREATE TABLE public.rifa_signups (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  rifa_id uuid NOT NULL REFERENCES public.rifas(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rifa_signups IS
  'Cuentas creadas después de abrir el enlace de una rifa sin sesión (cookie lp_rifa). Base del embudo rifa → cuenta → polla.';

-- ─── RLS: deny-all salvo lectura de rifas visibles ──────────────────────────
ALTER TABLE public.rifa_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_link_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rifa_signups ENABLE ROW LEVEL SECURITY;

-- Supabase auto-otorga a anon/authenticated en tablas nuevas: se revoca todo y
-- se vuelve a dar lo mínimo (GRANT explícitos: plazo de Supabase 30-oct-2026).
REVOKE ALL ON public.rifa_settings, public.rifa_creators, public.rifas, public.rifa_proofs,
  public.rifa_tickets, public.rifa_draws, public.rifa_events, public.rifa_reports,
  public.rifa_visits, public.rifa_link_views, public.rifa_signups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rifa_settings, public.rifa_creators, public.rifas,
  public.rifa_proofs, public.rifa_tickets, public.rifa_draws, public.rifa_events, public.rifa_reports,
  public.rifa_visits, public.rifa_link_views, public.rifa_signups TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rifa_events_id_seq TO service_role;
GRANT SELECT ON public.rifas TO authenticated;

-- Función de la política en `private` (lección de la 124: si vive en public con
-- EXECUTE revocado, la tabla responde 42501 a authenticated).
CREATE OR REPLACE FUNCTION private.rifa_viewer_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT u.is_admin FROM public.users u WHERE u.id = auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION private.rifa_viewer_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rifa_viewer_is_admin() TO authenticated, service_role;

-- Privada: solo creador y administradores. Oculta: solo creador y administradores.
CREATE POLICY rifas_select_visible ON public.rifas FOR SELECT TO authenticated
  USING (creator_id = auth.uid()
    OR private.rifa_viewer_is_admin()
    OR (visibility = 'publica' AND hidden_at IS NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rifa_settings','rifa_creators','rifa_proofs','rifa_tickets','rifa_draws',
    'rifa_events','rifa_reports','rifa_visits','rifa_link_views','rifa_signups'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t || '_deny_clients', t);
  END LOOP;
END $$;

-- ─── Storage: comprobantes y fotos del premio, privados ─────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rifa-proofs', 'rifa-proofs', false, 10 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp']),
       ('rifa-media', 'rifa-media', false, 4 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS rifa_files_service_only ON storage.objects;
CREATE POLICY rifa_files_service_only ON storage.objects FOR ALL TO service_role
  USING (bucket_id IN ('rifa-proofs', 'rifa-media'))
  WITH CHECK (bucket_id IN ('rifa-proofs', 'rifa-media'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Ayudantes internos (no expuestos)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rifa_fail(p_code text, p_detail text DEFAULT NULL, p_errcode text DEFAULT '55000')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = p_errcode, MESSAGE = p_code, DETAIL = coalesce(p_detail, '');
END $$;

CREATE OR REPLACE FUNCTION public.rifa_is_admin(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT is_admin FROM public.users WHERE id = p_user), false)
$$;

CREATE OR REPLACE FUNCTION public.rifa_is_creator(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.rifa_creators WHERE user_id = p_user AND revoked_at IS NULL)
$$;

-- Una boleta ocupa su número mientras no esté liberada y, si es una reserva
-- de la app sin comprobante confirmado, mientras no haya vencido.
CREATE OR REPLACE FUNCTION public.rifa_ticket_live(p_state text, p_origin text, p_expires_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_state <> 'liberado'
    AND NOT (p_state = 'reservado' AND p_origin = 'app' AND p_expires_at IS NOT NULL AND p_expires_at <= now())
$$;

-- ¿Puede ver la rifa? Pública: cualquiera (también sin sesión). Privada:
-- creador y administradores. Oculta por administración: creador,
-- administradores y quien ya tiene números (para no dejarlo sin su compra).
CREATE OR REPLACE FUNCTION public.rifa_can_view(p_rifa public.rifas, p_viewer uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_viewer IS NOT NULL AND (p_viewer = p_rifa.creator_id OR public.rifa_is_admin(p_viewer)) THEN
    RETURN true;
  END IF;
  IF p_rifa.visibility <> 'publica' THEN RETURN false; END IF;
  IF p_rifa.hidden_at IS NULL THEN RETURN true; END IF;
  RETURN p_viewer IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = p_rifa.id AND t.buyer_id = p_viewer AND t.state <> 'liberado');
END $$;

-- Marca como liberadas las reservas vencidas y como vencidas las cargas
-- abandonadas. Solo se llama con la fila de la rifa bloqueada.
CREATE OR REPLACE FUNCTION public.rifa_sweep_expired(p_rifa uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_numbers integer[];
BEGIN
  UPDATE public.rifa_proofs SET state = 'vencido'
   WHERE rifa_id = p_rifa AND state = 'subiendo' AND expires_at <= now();
  WITH freed AS (
    UPDATE public.rifa_tickets SET state = 'liberado', released_at = now(), release_reason = 'vencida'
     WHERE rifa_id = p_rifa AND state = 'reservado' AND origin = 'app' AND expires_at <= now()
    RETURNING number)
  SELECT array_agg(number ORDER BY number) INTO v_numbers FROM freed;
  IF v_numbers IS NOT NULL THEN
    INSERT INTO public.rifa_events (rifa_id, kind, detail)
    VALUES (p_rifa, 'reservas_vencidas', jsonb_build_object('numbers', to_jsonb(v_numbers)));
  END IF;
  RETURN coalesce(cardinality(v_numbers), 0);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_lock(p_rifa uuid)
RETURNS public.rifas LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  SELECT * INTO r FROM public.rifas WHERE id = p_rifa FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.rifa_require_owner(p_rifa public.rifas, p_actor uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actor IS NULL OR p_rifa.creator_id <> p_actor THEN
    PERFORM public.rifa_fail('CREATOR_ONLY', NULL, '42501');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rifa_fmt(p_number integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lpad(p_number::text, 2, '0') $$;

-- users.whatsapp_number se guarda sin «+»; las ventas por fuera, en E.164.
CREATE OR REPLACE FUNCTION public.rifa_user_phone(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN d ~ '^[1-9][0-9]{7,14}$' THEN '+' || d END
    FROM (SELECT regexp_replace(coalesce(whatsapp_number, ''), '[^0-9]', '', 'g') AS d
            FROM public.users WHERE id = p_user) x
$$;

-- Código del enlace: 8 caracteres sin ambigüedades (sin 0/o, 1/l).
CREATE OR REPLACE FUNCTION public.rifa_new_slug()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_bytes bytea;
  v_slug text;
BEGIN
  LOOP
    v_bytes := gen_random_bytes(8);
    v_slug := '';
    FOR i IN 0..7 LOOP
      v_slug := v_slug || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rifas WHERE slug = v_slug);
  END LOOP;
  RETURN v_slug;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Administración: creadores, ocultar, listado y embudo
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rifa_grant_creator_v1(p_actor uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rifa_is_admin(p_actor) THEN PERFORM public.rifa_fail('ADMIN_REQUIRED', NULL, '42501'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN PERFORM public.rifa_fail('USER_NOT_FOUND', NULL, 'P0002'); END IF;
  INSERT INTO public.rifa_creators (user_id, granted_by, granted_at)
  VALUES (p_user, p_actor, now())
  ON CONFLICT (user_id) DO UPDATE
    SET granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_by = NULL, revoked_at = NULL
    WHERE public.rifa_creators.revoked_at IS NOT NULL;
  IF FOUND THEN
    INSERT INTO public.rifa_events (actor_id, subject_user_id, kind) VALUES (p_actor, p_user, 'creador_asignado');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_revoke_creator_v1(p_actor uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rifa_is_admin(p_actor) THEN PERFORM public.rifa_fail('ADMIN_REQUIRED', NULL, '42501'); END IF;
  -- Las rifas en curso siguen funcionando: sus compradores ya pagaron.
  UPDATE public.rifa_creators SET revoked_by = p_actor, revoked_at = now()
   WHERE user_id = p_user AND revoked_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.rifa_events (actor_id, subject_user_id, kind) VALUES (p_actor, p_user, 'creador_retirado');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_admin_creators_v1(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rifa_is_admin(p_actor) THEN PERFORM public.rifa_fail('ADMIN_REQUIRED', NULL, '42501'); END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', c.user_id, 'display_name', u.display_name, 'whatsapp_number', u.whatsapp_number,
      'granted_at', c.granted_at, 'granted_by_name', g.display_name,
      'revoked_at', c.revoked_at, 'revoked_by_name', rv.display_name,
      'active_rifas', (SELECT count(*) FROM public.rifas r WHERE r.creator_id = c.user_id AND r.status = 'abierta'),
      'total_rifas', (SELECT count(*) FROM public.rifas r WHERE r.creator_id = c.user_id))
      ORDER BY (c.revoked_at IS NOT NULL), c.granted_at DESC)
    FROM public.rifa_creators c
    JOIN public.users u ON u.id = c.user_id
    LEFT JOIN public.users g ON g.id = c.granted_by
    LEFT JOIN public.users rv ON rv.id = c.revoked_by), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_admin_hide_v1(p_actor uuid, p_rifa uuid, p_hidden boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  IF NOT public.rifa_is_admin(p_actor) THEN PERFORM public.rifa_fail('ADMIN_REQUIRED', NULL, '42501'); END IF;
  r := public.rifa_lock(p_rifa);
  IF p_hidden THEN
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN PERFORM public.rifa_fail('REASON_REQUIRED', NULL, '22023'); END IF;
    UPDATE public.rifas SET hidden_at = now(), hidden_by = p_actor, hidden_reason = left(btrim(p_reason), 300) WHERE id = p_rifa;
  ELSE
    UPDATE public.rifas SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = p_rifa;
  END IF;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
  VALUES (p_rifa, p_actor, CASE WHEN p_hidden THEN 'oculta' ELSE 'visible' END,
          jsonb_build_object('reason', CASE WHEN p_hidden THEN left(btrim(p_reason), 300) END));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_admin_list_v1(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rifa_is_admin(p_actor) THEN PERFORM public.rifa_fail('ADMIN_REQUIRED', NULL, '42501'); END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'name', r.name, 'creator_name', u.display_name,
      'visibility', r.visibility, 'status', r.status, 'draw_at', r.draw_at,
      'hidden_at', r.hidden_at, 'hidden_reason', r.hidden_reason,
      'number_count', r.number_count,
      'paid', (SELECT count(*) FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.state = 'pagado'),
      'pending_proofs', (SELECT count(*) FROM public.rifa_proofs p WHERE p.rifa_id = r.id AND p.state = 'en_revision'),
      'reports', (SELECT count(*) FROM public.rifa_reports rp WHERE rp.rifa_id = r.id),
      'last_report', (SELECT rp.reason FROM public.rifa_reports rp WHERE rp.rifa_id = r.id ORDER BY rp.created_at DESC LIMIT 1))
      ORDER BY r.created_at DESC)
    FROM public.rifas r JOIN public.users u ON u.id = r.creator_id), '[]'::jsonb);
END $$;

-- Embudo por rifa: visitas sin sesión → cuentas nuevas → reservaron → pagaron
-- una rifa → entraron a una polla (cualquier participación viva de Casa creada
-- después de la cuenta).
CREATE OR REPLACE FUNCTION public.rifa_funnel_v1(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rifa_is_admin(p_actor) THEN PERFORM public.rifa_fail('ADMIN_REQUIRED', NULL, '42501'); END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY (row->>'anonymous_views')::int DESC, row->>'name')
    FROM (
      SELECT jsonb_build_object(
        'rifa_id', r.id, 'slug', r.slug, 'name', r.name,
        'anonymous_views', coalesce((SELECT sum(v.anonymous_views) FROM public.rifa_link_views v WHERE v.rifa_id = r.id), 0),
        'signups', (SELECT count(*) FROM public.rifa_signups s WHERE s.rifa_id = r.id),
        'signups_reserved', (SELECT count(*) FROM public.rifa_signups s WHERE s.rifa_id = r.id
            AND EXISTS (SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.buyer_id = s.user_id)),
        'signups_paid', (SELECT count(*) FROM public.rifa_signups s WHERE s.rifa_id = r.id
            AND EXISTS (SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.buyer_id = s.user_id AND t.state = 'pagado')),
        'signups_polla', (SELECT count(*) FROM public.rifa_signups s WHERE s.rifa_id = r.id
            AND EXISTS (SELECT 1 FROM public.casa_entries e WHERE e.user_id = s.user_id
              AND e.status IN ('pagada', 'pendiente') AND e.created_at >= s.recorded_at - interval '1 day'))) AS row
      FROM public.rifas r) f), '[]'::jsonb);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Creador: crear, foto, visibilidad
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rifa_create_v1(
  p_actor uuid, p_name text, p_prize_kind text, p_prize_cop bigint, p_prize_text text,
  p_number_count integer, p_price_cop integer, p_lottery_name text, p_digits_rule text,
  p_draw_at timestamptz, p_visibility text, p_payment_method text, p_payment_account text, p_payment_holder text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.rifa_settings;
  v_active integer;
  v_slug text;
  v_id uuid;
BEGIN
  IF NOT public.rifa_is_creator(p_actor) THEN PERFORM public.rifa_fail('CREATOR_REQUIRED', NULL, '42501'); END IF;
  SELECT * INTO s FROM public.rifa_settings;
  -- Serializa las creaciones de un mismo creador para que el tope no se pase
  -- con dos envíos simultáneos.
  PERFORM pg_advisory_xact_lock(hashtextextended('rifa_create:' || p_actor::text, 0));
  SELECT count(*) INTO v_active FROM public.rifas WHERE creator_id = p_actor AND status = 'abierta';
  IF v_active >= s.max_active_rifas_per_creator THEN
    PERFORM public.rifa_fail('MAX_ACTIVE_RIFAS',
      format('Puedes tener hasta %s rifas activas. Termina una antes de crear otra.', s.max_active_rifas_per_creator));
  END IF;
  IF p_draw_at IS NULL OR p_draw_at < now() + interval '10 minutes' OR p_draw_at > now() + interval '180 days' THEN
    PERFORM public.rifa_fail('INVALID_DRAW_AT', NULL, '22023');
  END IF;
  IF p_prize_kind NOT IN ('dinero', 'texto')
     OR (p_prize_kind = 'dinero' AND (p_prize_cop IS NULL OR p_prize_cop < 1000))
     OR (p_prize_kind = 'texto' AND (p_prize_text IS NULL OR char_length(btrim(p_prize_text)) < 3)) THEN
    PERFORM public.rifa_fail('INVALID_PRIZE', NULL, '22023');
  END IF;
  v_slug := public.rifa_new_slug();
  INSERT INTO public.rifas (slug, creator_id, name, prize_kind, prize_cop, prize_text, number_count, price_cop,
    lottery_name, digits_rule, draw_at, visibility, payment_method, payment_account, payment_holder)
  VALUES (v_slug, p_actor, btrim(p_name), p_prize_kind,
    CASE WHEN p_prize_kind = 'dinero' THEN p_prize_cop END,
    CASE WHEN p_prize_kind = 'texto' THEN btrim(p_prize_text) END,
    coalesce(p_number_count, 100), p_price_cop, btrim(p_lottery_name), coalesce(p_digits_rule, 'ultimas_dos'),
    p_draw_at, coalesce(p_visibility, 'privada'), p_payment_method, btrim(p_payment_account), btrim(p_payment_holder))
  RETURNING id INTO v_id;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
  VALUES (v_id, p_actor, 'rifa_creada', jsonb_build_object('visibility', coalesce(p_visibility, 'privada')));
  RETURN jsonb_build_object('id', v_id, 'slug', v_slug);
EXCEPTION
  WHEN check_violation THEN PERFORM public.rifa_fail('INVALID_RIFA', SQLERRM, '22023');
END $$;

CREATE OR REPLACE FUNCTION public.rifa_set_prize_image_v1(p_actor uuid, p_rifa uuid, p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  r := public.rifa_lock(p_rifa);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF p_path IS NOT NULL AND p_path NOT LIKE 'rifas/' || p_rifa::text || '/%' THEN
    PERFORM public.rifa_fail('INVALID_PATH', NULL, '22023');
  END IF;
  UPDATE public.rifas SET prize_image_path = p_path WHERE id = p_rifa;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_set_visibility_v1(p_actor uuid, p_rifa uuid, p_visibility text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  r := public.rifa_lock(p_rifa);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF p_visibility NOT IN ('privada', 'publica') THEN PERFORM public.rifa_fail('INVALID_VISIBILITY', NULL, '22023'); END IF;
  IF r.status <> 'abierta' THEN PERFORM public.rifa_fail('RIFA_FINISHED'); END IF;
  PERFORM public.rifa_sweep_expired(p_rifa);
  -- De Pública a Privada solo sin números de otras personas.
  IF p_visibility = 'privada' AND r.visibility = 'publica' AND EXISTS (
       SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = p_rifa AND t.state <> 'liberado') THEN
    PERFORM public.rifa_fail('VISIBILITY_LOCKED');
  END IF;
  IF p_visibility <> r.visibility THEN
    UPDATE public.rifas SET visibility = p_visibility WHERE id = p_rifa;
    INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
    VALUES (p_rifa, p_actor, 'visibilidad', jsonb_build_object('visibility', p_visibility));
  END IF;
  RETURN jsonb_build_object('ok', true, 'visibility', p_visibility);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Comprador: reservar, cancelar, comprobante
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rifa_reserve_v1(p_rifa uuid, p_buyer uuid, p_numbers integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r public.rifas;
  s public.rifa_settings;
  u public.users;
  v_numbers integer[];
  v_taken integer[];
  v_pending integer;
  v_expires timestamptz;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_buyer;
  IF NOT FOUND THEN PERFORM public.rifa_fail('USER_NOT_FOUND', NULL, 'P0002'); END IF;
  IF u.display_name IS NULL OR u.whatsapp_number IS NULL THEN PERFORM public.rifa_fail('PROFILE_INCOMPLETE'); END IF;
  SELECT array_agg(DISTINCT n ORDER BY n) INTO v_numbers FROM unnest(p_numbers) n;
  IF v_numbers IS NULL OR cardinality(v_numbers) = 0 THEN PERFORM public.rifa_fail('INVALID_NUMBER', NULL, '22023'); END IF;
  SELECT * INTO s FROM public.rifa_settings;

  r := public.rifa_lock(p_rifa);
  IF NOT public.rifa_can_view(r, p_buyer) THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  IF r.hidden_at IS NOT NULL THEN PERFORM public.rifa_fail('RIFA_HIDDEN'); END IF;
  IF r.status <> 'abierta' OR now() >= r.draw_at THEN PERFORM public.rifa_fail('RIFA_CLOSED'); END IF;
  IF r.creator_id = p_buyer THEN PERFORM public.rifa_fail('CREATOR_CANNOT_BUY'); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_numbers) n WHERE n < 0 OR n >= r.number_count) THEN
    PERFORM public.rifa_fail('INVALID_NUMBER', NULL, '22023');
  END IF;
  IF r.prize_kind = 'dinero' AND (u.default_payout_method IS NULL OR u.default_payout_account IS NULL) THEN
    PERFORM public.rifa_fail('PAYOUT_ACCOUNT_REQUIRED');
  END IF;

  PERFORM public.rifa_sweep_expired(p_rifa);

  SELECT array_agg(t.number ORDER BY t.number) INTO v_taken
    FROM public.rifa_tickets t WHERE t.rifa_id = p_rifa AND t.state <> 'liberado' AND t.number = ANY (v_numbers);
  IF v_taken IS NOT NULL THEN
    PERFORM public.rifa_fail('NUMBER_TAKEN',
      CASE WHEN cardinality(v_taken) = 1
        THEN format('El %s ya lo tomó otra persona. Elige otro número.', public.rifa_fmt(v_taken[1]))
        ELSE format('Estos números ya los tomó otra persona: %s. Elige otros.',
          (SELECT string_agg(public.rifa_fmt(n), ', ') FROM unnest(v_taken) n)) END);
  END IF;

  SELECT count(*) INTO v_pending FROM public.rifa_tickets t
   WHERE t.rifa_id = p_rifa AND t.buyer_id = p_buyer AND t.state IN ('reservado', 'en_revision');
  IF v_pending + cardinality(v_numbers) > s.max_pending_numbers_per_buyer THEN
    PERFORM public.rifa_fail('MAX_PENDING_NUMBERS',
      format('Puedes tener hasta %s números sin pago confirmado en esta rifa. Paga los que tienes o quita alguno.',
        s.max_pending_numbers_per_buyer));
  END IF;

  v_expires := now() + make_interval(mins => s.reservation_minutes);
  INSERT INTO public.rifa_tickets (rifa_id, number, state, origin, buyer_id, expires_at, created_by)
  SELECT p_rifa, n, 'reservado', 'app', p_buyer, v_expires, p_buyer FROM unnest(v_numbers) n;
  INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
  VALUES (p_rifa, p_buyer, p_buyer, 'reserva', jsonb_build_object('numbers', to_jsonb(v_numbers)));
  RETURN jsonb_build_object('numbers', to_jsonb(v_numbers), 'expires_at', v_expires,
    'amount_cop', r.price_cop::bigint * cardinality(v_numbers));
EXCEPTION
  WHEN unique_violation THEN
    PERFORM public.rifa_fail('NUMBER_TAKEN', 'Alguien tomó ese número al mismo tiempo. Elige otro número.');
END $$;

-- El comprador quita números reservados que todavía no tienen comprobante.
CREATE OR REPLACE FUNCTION public.rifa_cancel_reservation_v1(p_rifa uuid, p_buyer uuid, p_numbers integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; v_freed integer[];
BEGIN
  r := public.rifa_lock(p_rifa);
  PERFORM public.rifa_sweep_expired(p_rifa);
  WITH freed AS (
    UPDATE public.rifa_tickets t SET state = 'liberado', released_at = now(), release_reason = 'cancelada', proof_id = NULL
     WHERE t.rifa_id = p_rifa AND t.buyer_id = p_buyer AND t.state = 'reservado' AND t.number = ANY (p_numbers)
       AND (t.proof_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.rifa_proofs p WHERE p.id = t.proof_id AND p.state = 'subiendo'))
    RETURNING t.number)
  SELECT array_agg(number ORDER BY number) INTO v_freed FROM freed;
  IF v_freed IS NOT NULL THEN
    INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
    VALUES (p_rifa, p_buyer, p_buyer, 'reserva_cancelada', jsonb_build_object('numbers', to_jsonb(v_freed)));
  END IF;
  RETURN jsonb_build_object('numbers', coalesce(to_jsonb(v_freed), '[]'::jsonb));
END $$;

-- Un comprobante cubre TODOS los números reservados del comprador en esa
-- rifa que aún no tienen comprobante confirmado: una sola transferencia.
CREATE OR REPLACE FUNCTION public.rifa_begin_proof_v1(
  p_rifa uuid, p_buyer uuid, p_request_id uuid, p_sha256 text, p_content_type text, p_bytes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r public.rifas;
  s public.rifa_settings;
  p public.rifa_proofs;
  v_numbers integer[];
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_expires timestamptz;
  v_cap timestamptz;
BEGIN
  SELECT * INTO p FROM public.rifa_proofs WHERE buyer_id = p_buyer AND request_id = p_request_id;
  IF FOUND THEN
    IF p.rifa_id <> p_rifa OR p.content_sha256 <> p_sha256 OR p.content_bytes <> p_bytes OR p.content_type <> p_content_type THEN
      PERFORM public.rifa_fail('REQUEST_CONFLICT');
    END IF;
    RETURN jsonb_build_object('proof_id', p.id, 'path', p.path, 'state', p.state, 'numbers', to_jsonb(p.numbers),
      'amount_cop', p.amount_cop, 'expires_at', p.expires_at, 'resumed', true);
  END IF;
  IF p_sha256 !~ '^[a-f0-9]{64}$' OR p_content_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
     OR p_bytes IS NULL OR p_bytes < 1 OR p_bytes > 8388608 THEN
    PERFORM public.rifa_fail('INVALID_UPLOAD', NULL, '22023');
  END IF;
  SELECT * INTO s FROM public.rifa_settings;
  r := public.rifa_lock(p_rifa);
  IF NOT public.rifa_can_view(r, p_buyer) THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  -- Después del sorteo no se empieza un comprobante nuevo: evita pagar solo si ganó.
  IF r.status <> 'abierta' OR now() >= r.draw_at THEN PERFORM public.rifa_fail('RIFA_CLOSED'); END IF;
  PERFORM public.rifa_sweep_expired(p_rifa);

  IF EXISTS (SELECT 1 FROM public.rifa_proofs x WHERE x.rifa_id = p_rifa AND x.buyer_id = p_buyer
               AND x.content_sha256 = p_sha256 AND x.state IN ('en_revision', 'aprobado')) THEN
    PERFORM public.rifa_fail('DUPLICATE_PROOF');
  END IF;

  -- Una carga nueva reemplaza la que haya quedado a medias.
  UPDATE public.rifa_proofs SET state = 'fallido'
   WHERE rifa_id = p_rifa AND buyer_id = p_buyer AND state = 'subiendo';

  SELECT array_agg(t.number ORDER BY t.number),
         min(t.reserved_at) + make_interval(mins => s.reservation_minutes + s.upload_minutes)
    INTO v_numbers, v_cap
    FROM public.rifa_tickets t
   WHERE t.rifa_id = p_rifa AND t.buyer_id = p_buyer AND t.state = 'reservado' AND t.origin = 'app';
  IF v_numbers IS NULL THEN PERFORM public.rifa_fail('NO_RESERVED_NUMBERS'); END IF;

  v_ext := CASE p_content_type WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE 'jpg' END;
  -- Tope: reintentar la carga no retiene el número indefinidamente. Como
  -- máximo reserva + ventana de carga desde la primera reserva del grupo.
  v_expires := least(now() + make_interval(mins => s.upload_minutes), v_cap);
  IF v_expires <= now() + interval '1 minute' THEN
    PERFORM public.rifa_fail('RESERVATION_EXPIRING');
  END IF;
  INSERT INTO public.rifa_proofs (id, rifa_id, buyer_id, request_id, numbers, amount_cop, path,
    content_sha256, content_type, content_bytes, expires_at)
  VALUES (v_id, p_rifa, p_buyer, p_request_id, v_numbers, r.price_cop::bigint * cardinality(v_numbers),
    format('rifas/%s/%s.%s', p_rifa, v_id, v_ext), p_sha256, p_content_type, p_bytes, v_expires)
  RETURNING * INTO p;
  -- La reserva no vence mientras se sube el archivo.
  UPDATE public.rifa_tickets SET proof_id = v_id, expires_at = greatest(expires_at, v_expires)
   WHERE rifa_id = p_rifa AND buyer_id = p_buyer AND state = 'reservado' AND origin = 'app';
  RETURN jsonb_build_object('proof_id', p.id, 'path', p.path, 'state', p.state, 'numbers', to_jsonb(p.numbers),
    'amount_cop', p.amount_cop, 'expires_at', p.expires_at, 'resumed', false);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_confirm_proof_v1(p_proof uuid, p_buyer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; p public.rifa_proofs;
BEGIN
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof AND buyer_id = p_buyer;
  IF NOT FOUND THEN PERFORM public.rifa_fail('ATTEMPT_NOT_FOUND', NULL, 'P0002'); END IF;
  r := public.rifa_lock(p.rifa_id);
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof FOR UPDATE;
  IF p.state = 'en_revision' THEN
    RETURN jsonb_build_object('proof_id', p.id, 'state', p.state, 'numbers', to_jsonb(p.numbers), 'already', true);
  END IF;
  IF p.state = 'fallido' THEN PERFORM public.rifa_fail('ATTEMPT_REPLACED'); END IF;
  IF p.state <> 'subiendo' THEN PERFORM public.rifa_fail('ALREADY_REVIEWED'); END IF;
  IF p.expires_at <= now() THEN
    PERFORM public.rifa_sweep_expired(p.rifa_id);
    PERFORM public.rifa_fail('UPLOAD_EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'rifa-proofs' AND o.name = p.path) THEN
    PERFORM public.rifa_fail('PROOF_NOT_UPLOADED');
  END IF;
  UPDATE public.rifa_proofs SET state = 'en_revision', submitted_at = now() WHERE id = p_proof;
  UPDATE public.rifa_tickets SET state = 'en_revision', expires_at = NULL
   WHERE proof_id = p_proof AND state = 'reservado';
  INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
  VALUES (p.rifa_id, p_buyer, p_buyer, 'comprobante_enviado',
          jsonb_build_object('proof_id', p_proof, 'numbers', to_jsonb(p.numbers)));
  RETURN jsonb_build_object('proof_id', p.id, 'state', 'en_revision', 'numbers', to_jsonb(p.numbers),
    'creator_id', r.creator_id, 'rifa_name', r.name, 'already', false);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_fail_proof_v1(p_proof uuid, p_buyer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.rifa_proofs;
BEGIN
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof AND buyer_id = p_buyer;
  IF NOT FOUND THEN PERFORM public.rifa_fail('ATTEMPT_NOT_FOUND', NULL, 'P0002'); END IF;
  PERFORM public.rifa_lock(p.rifa_id);
  UPDATE public.rifa_proofs SET state = 'fallido' WHERE id = p_proof AND state = 'subiendo';
  UPDATE public.rifa_tickets SET proof_id = NULL WHERE proof_id = p_proof AND state = 'reservado';
  RETURN jsonb_build_object('ok', true);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Creador: revisar, revertir, venta por fuera, liberar, resultado
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rifa_review_proof_v1(p_actor uuid, p_proof uuid, p_decision text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; p public.rifa_proofs;
BEGIN
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof;
  IF NOT FOUND THEN PERFORM public.rifa_fail('ATTEMPT_NOT_FOUND', NULL, 'P0002'); END IF;
  r := public.rifa_lock(p.rifa_id);
  PERFORM public.rifa_require_owner(r, p_actor);
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof FOR UPDATE;
  IF p.state <> 'en_revision' THEN PERFORM public.rifa_fail('ALREADY_REVIEWED'); END IF;
  IF p_decision = 'aprobar' THEN
    UPDATE public.rifa_proofs SET state = 'aprobado', reviewed_at = now(), reviewed_by = p_actor WHERE id = p_proof;
    UPDATE public.rifa_tickets SET state = 'pagado', paid_at = now(), paid_by = p_actor
     WHERE proof_id = p_proof AND state = 'en_revision';
  ELSIF p_decision = 'rechazar' THEN
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN PERFORM public.rifa_fail('REASON_REQUIRED', NULL, '22023'); END IF;
    UPDATE public.rifa_proofs SET state = 'rechazado', reviewed_at = now(), reviewed_by = p_actor,
      reject_reason = left(btrim(p_reason), 200) WHERE id = p_proof;
    UPDATE public.rifa_tickets SET state = 'liberado', released_at = now(), release_reason = 'rechazada'
     WHERE proof_id = p_proof AND state = 'en_revision';
  ELSE
    PERFORM public.rifa_fail('INVALID_DECISION', NULL, '22023');
  END IF;
  INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
  VALUES (p.rifa_id, p_actor, p.buyer_id, CASE WHEN p_decision = 'aprobar' THEN 'pago_aprobado' ELSE 'pago_rechazado' END,
          jsonb_build_object('proof_id', p_proof, 'numbers', to_jsonb(p.numbers),
            'reason', CASE WHEN p_decision = 'rechazar' THEN left(btrim(p_reason), 200) END));
  RETURN jsonb_build_object('ok', true, 'buyer_id', p.buyer_id, 'numbers', to_jsonb(p.numbers),
    'rifa_name', r.name, 'rifa_slug', r.slug, 'decision', p_decision);
END $$;

-- Revertir una aprobación: vuelve a revisión y deja el motivo en la auditoría.
CREATE OR REPLACE FUNCTION public.rifa_unpay_proof_v1(p_actor uuid, p_proof uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; p public.rifa_proofs;
BEGIN
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof;
  IF NOT FOUND THEN PERFORM public.rifa_fail('ATTEMPT_NOT_FOUND', NULL, 'P0002'); END IF;
  r := public.rifa_lock(p.rifa_id);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF r.status <> 'abierta' THEN PERFORM public.rifa_fail('RIFA_FINISHED'); END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN PERFORM public.rifa_fail('REASON_REQUIRED', NULL, '22023'); END IF;
  SELECT * INTO p FROM public.rifa_proofs WHERE id = p_proof FOR UPDATE;
  IF p.state <> 'aprobado' THEN PERFORM public.rifa_fail('NOT_APPROVED'); END IF;
  UPDATE public.rifa_proofs SET state = 'en_revision', reviewed_at = NULL, reviewed_by = NULL WHERE id = p_proof;
  UPDATE public.rifa_tickets SET state = 'en_revision', paid_at = NULL, paid_by = NULL
   WHERE proof_id = p_proof AND state = 'pagado';
  INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
  VALUES (p.rifa_id, p_actor, p.buyer_id, 'aprobacion_revertida',
          jsonb_build_object('proof_id', p_proof, 'numbers', to_jsonb(p.numbers), 'reason', left(btrim(p_reason), 200)));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_offline_sale_v1(
  p_actor uuid, p_rifa uuid, p_number integer, p_name text, p_phone text, p_paid boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; v_id uuid;
BEGIN
  r := public.rifa_lock(p_rifa);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF r.status <> 'abierta' OR now() >= r.draw_at THEN PERFORM public.rifa_fail('RIFA_CLOSED'); END IF;
  IF p_number IS NULL OR p_number < 0 OR p_number >= r.number_count THEN PERFORM public.rifa_fail('INVALID_NUMBER', NULL, '22023'); END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) < 2 THEN PERFORM public.rifa_fail('BUYER_NAME_REQUIRED', NULL, '22023'); END IF;
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN PERFORM public.rifa_fail('INVALID_PHONE', NULL, '22023'); END IF;
  PERFORM public.rifa_sweep_expired(p_rifa);
  IF EXISTS (SELECT 1 FROM public.rifa_tickets WHERE rifa_id = p_rifa AND number = p_number AND state <> 'liberado') THEN
    PERFORM public.rifa_fail('NUMBER_TAKEN', format('El %s ya está tomado.', public.rifa_fmt(p_number)));
  END IF;
  INSERT INTO public.rifa_tickets (rifa_id, number, state, origin, buyer_name, buyer_phone, paid_at, paid_by, created_by)
  VALUES (p_rifa, p_number, CASE WHEN p_paid THEN 'pagado' ELSE 'reservado' END, 'fuera',
          left(btrim(p_name), 80), p_phone,
          CASE WHEN p_paid THEN now() END, CASE WHEN p_paid THEN p_actor END, p_actor)
  RETURNING id INTO v_id;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
  VALUES (p_rifa, p_actor, 'venta_por_fuera',
          jsonb_build_object('ticket_id', v_id, 'number', p_number, 'paid', coalesce(p_paid, false)));
  RETURN jsonb_build_object('ticket_id', v_id);
EXCEPTION
  WHEN unique_violation THEN PERFORM public.rifa_fail('NUMBER_TAKEN', format('El %s ya está tomado.', public.rifa_fmt(p_number)));
END $$;

CREATE OR REPLACE FUNCTION public.rifa_mark_offline_paid_v1(p_actor uuid, p_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; t public.rifa_tickets;
BEGIN
  SELECT * INTO t FROM public.rifa_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN PERFORM public.rifa_fail('TICKET_NOT_FOUND', NULL, 'P0002'); END IF;
  r := public.rifa_lock(t.rifa_id);
  PERFORM public.rifa_require_owner(r, p_actor);
  SELECT * INTO t FROM public.rifa_tickets WHERE id = p_ticket FOR UPDATE;
  IF t.origin <> 'fuera' OR t.state <> 'reservado' THEN PERFORM public.rifa_fail('INVALID_TICKET_STATE'); END IF;
  UPDATE public.rifa_tickets SET state = 'pagado', paid_at = now(), paid_by = p_actor WHERE id = p_ticket;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
  VALUES (t.rifa_id, p_actor, 'venta_por_fuera_pagada', jsonb_build_object('ticket_id', p_ticket, 'number', t.number));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Liberar a mano: reservas (de la app o por fuera) y ventas por fuera. Un
-- número con comprobante en revisión se rechaza; uno pagado en la app se revierte.
CREATE OR REPLACE FUNCTION public.rifa_release_ticket_v1(p_actor uuid, p_ticket uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; t public.rifa_tickets;
BEGIN
  SELECT * INTO t FROM public.rifa_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN PERFORM public.rifa_fail('TICKET_NOT_FOUND', NULL, 'P0002'); END IF;
  r := public.rifa_lock(t.rifa_id);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF r.status <> 'abierta' THEN PERFORM public.rifa_fail('RIFA_FINISHED'); END IF;
  SELECT * INTO t FROM public.rifa_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT (t.state = 'reservado' OR (t.origin = 'fuera' AND t.state = 'pagado')) THEN
    PERFORM public.rifa_fail('INVALID_TICKET_STATE');
  END IF;
  IF t.state = 'reservado' AND t.proof_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.rifa_proofs p WHERE p.id = t.proof_id AND p.state = 'subiendo') THEN
    UPDATE public.rifa_proofs SET state = 'fallido' WHERE id = t.proof_id;
  END IF;
  UPDATE public.rifa_tickets SET state = 'liberado', released_at = now(), release_reason = 'liberada',
    paid_at = NULL, paid_by = NULL, proof_id = NULL WHERE id = p_ticket;
  INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
  VALUES (t.rifa_id, p_actor, t.buyer_id, 'numero_liberado',
          jsonb_build_object('ticket_id', p_ticket, 'number', t.number, 'previous_state', t.state,
            'reason', nullif(left(btrim(coalesce(p_reason, '')), 200), '')));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_set_result_v1(
  p_actor uuid, p_rifa uuid, p_number integer, p_unsold_action text, p_new_draw_at timestamptz, p_new_lottery text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; t public.rifa_tickets;
BEGIN
  r := public.rifa_lock(p_rifa);
  PERFORM public.rifa_require_owner(r, p_actor);
  IF r.status <> 'abierta' THEN PERFORM public.rifa_fail('RIFA_FINISHED'); END IF;
  IF now() < r.draw_at THEN PERFORM public.rifa_fail('TOO_EARLY'); END IF;
  IF p_number IS NULL OR p_number < 0 OR p_number > 99 THEN PERFORM public.rifa_fail('INVALID_NUMBER', NULL, '22023'); END IF;
  PERFORM public.rifa_sweep_expired(p_rifa);
  SELECT * INTO t FROM public.rifa_tickets WHERE rifa_id = p_rifa AND number = p_number AND state <> 'liberado';
  IF FOUND AND t.state = 'pagado' THEN
    UPDATE public.rifas SET status = 'resuelta', winning_number = p_number, winner_ticket_id = t.id, resolved_at = now()
     WHERE id = p_rifa;
    INSERT INTO public.rifa_draws (rifa_id, number, lottery_name, draw_at, outcome, ticket_id, created_by)
    VALUES (p_rifa, p_number, r.lottery_name, r.draw_at, 'ganador', t.id, p_actor);
    INSERT INTO public.rifa_events (rifa_id, actor_id, subject_user_id, kind, detail)
    VALUES (p_rifa, p_actor, t.buyer_id, 'resultado', jsonb_build_object('number', p_number, 'outcome', 'ganador'));
    RETURN jsonb_build_object('outcome', 'ganador', 'number', p_number, 'ticket_id', t.id);
  END IF;
  IF FOUND THEN
    PERFORM public.rifa_fail('PENDING_WINNER', CASE WHEN t.state = 'en_revision'
      THEN format('El %s tiene un comprobante sin revisar. Apruébalo o recházalo primero.', public.rifa_fmt(p_number))
      ELSE format('El %s está reservado sin pago confirmado. Márcalo como pagado o libéralo primero.', public.rifa_fmt(p_number)) END);
  END IF;
  -- El número no se vendió: nunca queda en silencio. El creador elige.
  IF p_unsold_action = 'desierta' THEN
    UPDATE public.rifas SET status = 'desierta', winning_number = p_number, resolved_at = now() WHERE id = p_rifa;
    INSERT INTO public.rifa_draws (rifa_id, number, lottery_name, draw_at, outcome, created_by)
    VALUES (p_rifa, p_number, r.lottery_name, r.draw_at, 'desierta', p_actor);
  ELSIF p_unsold_action = 'volver_a_jugar' THEN
    IF p_new_draw_at IS NULL OR p_new_draw_at < now() + interval '10 minutes' OR p_new_draw_at > now() + interval '180 days' THEN
      PERFORM public.rifa_fail('INVALID_DRAW_AT', NULL, '22023');
    END IF;
    INSERT INTO public.rifa_draws (rifa_id, number, lottery_name, draw_at, outcome, created_by)
    VALUES (p_rifa, p_number, r.lottery_name, r.draw_at, 'volver_a_jugar', p_actor);
    UPDATE public.rifas SET draw_at = p_new_draw_at,
      lottery_name = coalesce(nullif(btrim(coalesce(p_new_lottery, '')), ''), lottery_name)
     WHERE id = p_rifa;
  ELSE
    PERFORM public.rifa_fail('UNSOLD_CHOICE_REQUIRED',
      format('El %s no se vendió. Elige si se vuelve a jugar con otro sorteo o si la rifa queda desierta.', public.rifa_fmt(p_number)));
  END IF;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
  VALUES (p_rifa, p_actor, 'resultado', jsonb_build_object('number', p_number, 'outcome', p_unsold_action));
  RETURN jsonb_build_object('outcome', p_unsold_action, 'number', p_number);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Reporte, visitas y embudo
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rifa_report_v1(p_user uuid, p_rifa uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; s public.rifa_settings;
BEGIN
  SELECT * INTO r FROM public.rifas WHERE id = p_rifa;
  IF NOT FOUND OR NOT public.rifa_can_view(r, p_user) THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN PERFORM public.rifa_fail('REASON_REQUIRED', NULL, '22023'); END IF;
  SELECT * INTO s FROM public.rifa_settings;
  IF (SELECT count(*) FROM public.rifa_reports WHERE reporter_id = p_user AND created_at > now() - interval '1 day')
     >= s.max_reports_per_user_day THEN
    PERFORM public.rifa_fail('RATE_LIMITED');
  END IF;
  INSERT INTO public.rifa_reports (rifa_id, reporter_id, reason) VALUES (p_rifa, p_user, left(btrim(p_reason), 500))
  ON CONFLICT (rifa_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now();
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind) VALUES (p_rifa, p_user, 'reporte');
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.rifa_track_view_v1(p_rifa uuid, p_viewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_viewer IS NULL THEN
    INSERT INTO public.rifa_link_views (rifa_id, day, anonymous_views)
    VALUES (p_rifa, (now() AT TIME ZONE 'America/Bogota')::date, 1)
    ON CONFLICT (rifa_id, day) DO UPDATE SET anonymous_views = public.rifa_link_views.anonymous_views + 1;
  ELSE
    INSERT INTO public.rifa_visits (user_id, rifa_id) VALUES (p_viewer, p_rifa)
    ON CONFLICT (user_id, rifa_id) DO UPDATE SET last_seen_at = now();
  END IF;
END $$;

-- Atribuye la cuenta a la rifa solo si se creó después de abrir el enlace sin
-- sesión (auth.users, no public.users: su dueño puede editar public.users).
CREATE OR REPLACE FUNCTION public.rifa_record_signup_v1(p_user uuid, p_rifa uuid, p_first_seen_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_created timestamptz;
BEGIN
  SELECT created_at INTO v_created FROM auth.users WHERE id = p_user;
  IF v_created IS NULL OR p_first_seen_at IS NULL OR p_first_seen_at > now() + interval '5 minutes'
     OR v_created < p_first_seen_at - interval '2 minutes' OR v_created < now() - interval '30 days' THEN
    RETURN false;
  END IF;
  INSERT INTO public.rifa_signups (user_id, rifa_id, first_seen_at) VALUES (p_user, p_rifa, p_first_seen_at)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN FOUND;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Lecturas
-- ═══════════════════════════════════════════════════════════════════════════

-- Vista pública/comprador. Nunca incluye nombres ni celulares de compradores.
CREATE OR REPLACE FUNCTION public.rifa_public_view_v1(p_slug text, p_viewer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r public.rifas;
  s public.rifa_settings;
  v_is_creator boolean;
  v_is_admin boolean;
  v_board jsonb;
  v_mine jsonb;
  v_proofs jsonb;
  v_draws jsonb;
  v_has_live boolean;
  v_phone text;
BEGIN
  SELECT * INTO r FROM public.rifas WHERE slug = p_slug;
  IF NOT FOUND OR NOT public.rifa_can_view(r, p_viewer) THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  SELECT * INTO s FROM public.rifa_settings;
  v_is_creator := p_viewer IS NOT NULL AND p_viewer = r.creator_id;
  v_is_admin := p_viewer IS NOT NULL AND public.rifa_is_admin(p_viewer);
  v_phone := CASE WHEN p_viewer IS NOT NULL THEN public.rifa_user_phone(p_viewer) END;

  SELECT jsonb_agg(jsonb_build_object('n', g.n,
           's', CASE WHEN t.id IS NULL THEN 'libre' WHEN t.state = 'pagado' THEN 'pagado' ELSE 'reservado' END,
           'm', p_viewer IS NOT NULL AND t.id IS NOT NULL AND (t.buyer_id = p_viewer
                 OR (t.origin = 'fuera' AND v_phone IS NOT NULL AND t.buyer_phone = v_phone)))
         ORDER BY g.n)
    INTO v_board
    FROM generate_series(0, r.number_count - 1) AS g(n)
    LEFT JOIN public.rifa_tickets t ON t.rifa_id = r.id AND t.number = g.n
      AND public.rifa_ticket_live(t.state, t.origin, t.expires_at);

  IF p_viewer IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object('number', t.number, 'state', t.state, 'origin', t.origin,
             'expires_at', CASE WHEN t.state = 'reservado' AND t.origin = 'app' THEN t.expires_at END,
             'proof_id', t.proof_id) ORDER BY t.number)
      INTO v_mine
      FROM public.rifa_tickets t
     WHERE t.rifa_id = r.id AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)
       AND (t.buyer_id = p_viewer OR (t.origin = 'fuera' AND v_phone IS NOT NULL AND t.buyer_phone = v_phone));
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'state', p.state, 'numbers', to_jsonb(p.numbers),
             'amount_cop', p.amount_cop, 'reject_reason', p.reject_reason, 'created_at', p.created_at,
             'expires_at', p.expires_at, 'content_sha256', p.content_sha256)
             ORDER BY p.created_at DESC)
      INTO v_proofs
      FROM (SELECT * FROM public.rifa_proofs x WHERE x.rifa_id = r.id AND x.buyer_id = p_viewer
              AND x.state IN ('subiendo', 'en_revision', 'aprobado', 'rechazado')
              AND NOT (x.state = 'subiendo' AND x.expires_at <= now())
            ORDER BY x.created_at DESC LIMIT 10) p;
  END IF;
  v_has_live := v_mine IS NOT NULL;

  SELECT jsonb_agg(jsonb_build_object('number', d.number, 'lottery_name', d.lottery_name, 'draw_at', d.draw_at,
           'outcome', d.outcome, 'mine', d.ticket_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.rifa_tickets t WHERE t.id = d.ticket_id AND (t.buyer_id = p_viewer
               OR (t.origin = 'fuera' AND v_phone IS NOT NULL AND t.buyer_phone = v_phone))))
         ORDER BY d.created_at)
    INTO v_draws FROM public.rifa_draws d WHERE d.rifa_id = r.id;

  RETURN jsonb_build_object(
    'id', r.id, 'slug', r.slug, 'name', r.name, 'creator_name', (SELECT display_name FROM public.users WHERE id = r.creator_id),
    'prize_kind', r.prize_kind, 'prize_cop', r.prize_cop, 'prize_text', r.prize_text,
    'has_prize_image', r.prize_image_path IS NOT NULL,
    'number_count', r.number_count, 'price_cop', r.price_cop, 'lottery_name', r.lottery_name,
    'digits_rule', r.digits_rule, 'draw_at', r.draw_at, 'visibility', r.visibility, 'status', r.status,
    'winning_number', r.winning_number, 'hidden', r.hidden_at IS NOT NULL,
    'hidden_reason', CASE WHEN v_is_creator OR v_is_admin THEN r.hidden_reason END,
    'closed', r.status <> 'abierta' OR now() >= r.draw_at,
    'reservation_minutes', s.reservation_minutes,
    'board', v_board,
    'counts', jsonb_build_object(
      'pagado', (SELECT count(*) FROM jsonb_array_elements(v_board) b WHERE b->>'s' = 'pagado'),
      'reservado', (SELECT count(*) FROM jsonb_array_elements(v_board) b WHERE b->>'s' = 'reservado')),
    'draws', coalesce(v_draws, '[]'::jsonb),
    'viewer', jsonb_build_object(
      'signed_in', p_viewer IS NOT NULL, 'is_creator', v_is_creator, 'is_admin', v_is_admin,
      'can_reserve', p_viewer IS NOT NULL AND NOT v_is_creator AND r.status = 'abierta' AND now() < r.draw_at AND r.hidden_at IS NULL,
      'tickets', coalesce(v_mine, '[]'::jsonb), 'proofs', coalesce(v_proofs, '[]'::jsonb),
      -- Lo que falta transferir por las reservas sin comprobante: SQL, no el cliente.
      'pending_amount_cop', CASE WHEN p_viewer IS NULL THEN 0 ELSE r.price_cop::bigint * (
        SELECT count(*) FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.buyer_id = p_viewer
          AND t.state = 'reservado' AND t.origin = 'app' AND t.expires_at > now()) END,
      'has_payout_account', p_viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_viewer
        AND u.default_payout_method IS NOT NULL AND u.default_payout_account IS NOT NULL),
      'reported', p_viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.rifa_reports rp WHERE rp.rifa_id = r.id AND rp.reporter_id = p_viewer)),
    -- La cuenta de pago solo se entrega a quien tiene números por pagar.
    'payment', CASE WHEN v_has_live OR v_is_creator THEN jsonb_build_object(
      'method', r.payment_method, 'account', r.payment_account, 'holder', r.payment_holder) END);
END $$;

-- Panel del creador. SOLO el creador: acá están nombres y celulares.
CREATE OR REPLACE FUNCTION public.rifa_creator_view_v1(p_actor uuid, p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas; v_winner jsonb;
BEGIN
  SELECT * INTO r FROM public.rifas WHERE slug = p_slug;
  IF NOT FOUND THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  PERFORM public.rifa_require_owner(r, p_actor);
  IF r.winner_ticket_id IS NOT NULL THEN
    SELECT jsonb_build_object('number', t.number, 'origin', t.origin,
             'name', coalesce(t.buyer_name, u.display_name), 'phone', coalesce(t.buyer_phone, u.whatsapp_number),
             'payout_method', u.default_payout_method, 'payout_account', u.default_payout_account,
             'payout_account_name', u.default_payout_account_name, 'payout_account_type', u.default_payout_account_type)
      INTO v_winner
      FROM public.rifa_tickets t LEFT JOIN public.users u ON u.id = t.buyer_id WHERE t.id = r.winner_ticket_id;
  END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'slug', r.slug, 'name', r.name, 'prize_kind', r.prize_kind, 'prize_cop', r.prize_cop,
    'prize_text', r.prize_text, 'has_prize_image', r.prize_image_path IS NOT NULL,
    'number_count', r.number_count, 'price_cop', r.price_cop,
    'lottery_name', r.lottery_name, 'digits_rule', r.digits_rule, 'draw_at', r.draw_at, 'visibility', r.visibility,
    'status', r.status, 'winning_number', r.winning_number, 'hidden', r.hidden_at IS NOT NULL,
    'hidden_reason', r.hidden_reason, 'closed', r.status <> 'abierta' OR now() >= r.draw_at,
    'payment', jsonb_build_object('method', r.payment_method, 'account', r.payment_account, 'holder', r.payment_holder),
    'tickets', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'state', t.state, 'origin', t.origin,
               'name', coalesce(t.buyer_name, u.display_name), 'phone', coalesce(t.buyer_phone, u.whatsapp_number),
               'expires_at', CASE WHEN t.state = 'reservado' AND t.origin = 'app' THEN t.expires_at END,
               'proof_id', t.proof_id, 'paid_at', t.paid_at) ORDER BY t.number)
        FROM public.rifa_tickets t LEFT JOIN public.users u ON u.id = t.buyer_id
       WHERE t.rifa_id = r.id AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)), '[]'::jsonb),
    'proofs', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'state', p.state, 'numbers', to_jsonb(p.numbers),
               'amount_cop', p.amount_cop, 'submitted_at', p.submitted_at, 'reviewed_at', p.reviewed_at,
               'reject_reason', p.reject_reason, 'buyer_name', u.display_name, 'buyer_phone', u.whatsapp_number)
               ORDER BY p.submitted_at DESC NULLS LAST)
        FROM public.rifa_proofs p JOIN public.users u ON u.id = p.buyer_id
       WHERE p.rifa_id = r.id AND p.state IN ('en_revision', 'aprobado', 'rechazado')), '[]'::jsonb),
    'summary', jsonb_build_object(
      'pagado', (SELECT count(*) FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.state = 'pagado'),
      'reservado', (SELECT count(*) FROM public.rifa_tickets t WHERE t.rifa_id = r.id
                      AND t.state IN ('reservado', 'en_revision') AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)),
      'pending_proofs', (SELECT count(*) FROM public.rifa_proofs p WHERE p.rifa_id = r.id AND p.state = 'en_revision'),
      'collected_cop', r.price_cop::bigint * (SELECT count(*) FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.state = 'pagado')),
    'draws', coalesce((SELECT jsonb_agg(jsonb_build_object('number', d.number, 'lottery_name', d.lottery_name,
               'draw_at', d.draw_at, 'outcome', d.outcome) ORDER BY d.created_at)
        FROM public.rifa_draws d WHERE d.rifa_id = r.id), '[]'::jsonb),
    'winner', v_winner,
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'created_at', e.created_at)
               ORDER BY e.created_at DESC)
        FROM (SELECT * FROM public.rifa_events e WHERE e.rifa_id = r.id ORDER BY e.created_at DESC LIMIT 40) e), '[]'::jsonb));
END $$;

-- Pestaña RIFAS y «Mis rifas» de Perfil: creadas, compradas (también ventas
-- por fuera a mi celular) y abiertas por enlace (visitadas y todavía visibles).
CREATE OR REPLACE FUNCTION public.rifa_my_list_v1(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_phone text; s public.rifa_settings;
BEGIN
  v_phone := public.rifa_user_phone(p_user);
  SELECT * INTO s FROM public.rifa_settings;
  RETURN jsonb_build_object(
    'can_create', public.rifa_is_creator(p_user),
    'created', coalesce((SELECT jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'status', r.status,
        'visibility', r.visibility, 'draw_at', r.draw_at, 'hidden', r.hidden_at IS NOT NULL,
        'number_count', r.number_count,
        'paid', (SELECT count(*) FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND t.state = 'pagado'),
        'pending_proofs', (SELECT count(*) FROM public.rifa_proofs p WHERE p.rifa_id = r.id AND p.state = 'en_revision'))
        ORDER BY (r.status <> 'abierta'), r.draw_at)
      FROM public.rifas r WHERE r.creator_id = p_user), '[]'::jsonb),
    'bought', coalesce((SELECT jsonb_agg(x.obj ORDER BY x.open DESC, x.draw_at) FROM (
      SELECT r.status = 'abierta' AS open, r.draw_at, jsonb_build_object('slug', r.slug, 'name', r.name, 'status', r.status,
        'draw_at', r.draw_at, 'winning_number', r.winning_number,
        'numbers', (SELECT jsonb_agg(jsonb_build_object('number', t.number, 'state', t.state) ORDER BY t.number)
           FROM public.rifa_tickets t WHERE t.rifa_id = r.id AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)
            AND (t.buyer_id = p_user OR (t.origin = 'fuera' AND v_phone IS NOT NULL AND t.buyer_phone = v_phone)))) AS obj
      FROM public.rifas r
      WHERE r.creator_id <> p_user AND EXISTS (SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = r.id
        AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)
        AND (t.buyer_id = p_user OR (t.origin = 'fuera' AND v_phone IS NOT NULL AND t.buyer_phone = v_phone)))) x), '[]'::jsonb),
    'visited', coalesce((SELECT jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'status', r.status,
        'draw_at', r.draw_at, 'price_cop', r.price_cop) ORDER BY v.last_seen_at DESC)
      FROM public.rifa_visits v JOIN public.rifas r ON r.id = v.rifa_id
      WHERE v.user_id = p_user AND r.creator_id <> p_user AND r.status = 'abierta' AND public.rifa_can_view(r, p_user)
        AND NOT EXISTS (SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id = r.id
          AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)
          AND (t.buyer_id = p_user OR (t.origin = 'fuera' AND v_phone IS NOT NULL AND t.buyer_phone = v_phone)))), '[]'::jsonb),
    -- Solo con listing_mode='publico' (hoy 'enlace': no hay vitrina de rifas de terceros).
    'listed', CASE WHEN s.listing_mode = 'publico' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('slug', r.slug,
        'name', r.name, 'status', r.status, 'draw_at', r.draw_at, 'price_cop', r.price_cop) ORDER BY r.draw_at)
      FROM public.rifas r WHERE r.visibility = 'publica' AND r.hidden_at IS NULL AND r.status = 'abierta'
        AND r.draw_at > now() AND r.creator_id <> p_user), '[]'::jsonb) ELSE '[]'::jsonb END);
END $$;

-- Datos para la imagen de historia: estados sin personas.
CREATE OR REPLACE FUNCTION public.rifa_story_data_v1(p_actor uuid, p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rifas;
BEGIN
  SELECT * INTO r FROM public.rifas WHERE slug = p_slug;
  IF NOT FOUND THEN PERFORM public.rifa_fail('RIFA_NOT_FOUND', NULL, 'P0002'); END IF;
  PERFORM public.rifa_require_owner(r, p_actor);
  RETURN jsonb_build_object('slug', r.slug, 'name', r.name, 'prize_kind', r.prize_kind, 'prize_cop', r.prize_cop,
    'prize_text', r.prize_text, 'number_count', r.number_count, 'price_cop', r.price_cop,
    'lottery_name', r.lottery_name, 'draw_at', r.draw_at, 'status', r.status, 'winning_number', r.winning_number,
    'taken', coalesce((SELECT jsonb_agg(t.number ORDER BY t.number) FROM public.rifa_tickets t
      WHERE t.rifa_id = r.id AND public.rifa_ticket_live(t.state, t.origin, t.expires_at)), '[]'::jsonb));
END $$;

-- ─── Permisos de ejecución: solo el servidor ────────────────────────────────
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'rifa\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

COMMIT;
