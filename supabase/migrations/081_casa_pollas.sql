-- 081_casa_pollas.sql
-- ============================================================================
-- LA POLLA CENTRALIZADA ("la casa")
-- ----------------------------------------------------------------------------
-- Modelo nuevo: SOLO el admin (Tama) crea pollas. La gente se une pagando y
-- mandando el pantallazo; el admin aprueba desde el bot de Telegram.
-- El pozo arranca en 0 y crece con el 70% de cada inscripcion pagada; el 30%
-- se queda la casa.
--
-- Convive con el modelo viejo P2P (`pollas`, `polla_participants`,
-- `predictions`) sin tocarlo: todo lo nuevo va con prefijo `casa_`.
-- Reusa `public.users` (telefono, display_name, avatar_url, is_admin) y
-- `public.matches` (fixtures ya sincronizados de ESPN/football-data).
--
-- Puntaje (Regla #4 del repo): se usa SIEMPRE el marcador de los 90 minutos,
-- o sea `matches.home_score/away_score` una vez `final_verified_at IS NOT NULL`.
-- El alargue y los penales NO cuentan.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE casa_polla_kind AS ENUM ('partidos', 'manual', 'rifa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE casa_scoring_mode AS ENUM ('1x2', 'marcador');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE casa_polla_status AS ENUM ('borrador', 'abierta', 'cerrada', 'resuelta', 'anulada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE casa_entry_status AS ENUM ('pendiente', 'pagada', 'rechazada', 'anulada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- casa_pollas — la polla que crea el admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.casa_pollas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text UNIQUE NOT NULL,
  name              text NOT NULL,
  kind              casa_polla_kind NOT NULL,
  tournament        text,                       -- slug de lib/tournaments.ts (kind='partidos')
  scoring_mode      casa_scoring_mode,          -- kind='partidos'
  description       text,

  -- plata
  entry_price_cop   integer NOT NULL CHECK (entry_price_cop >= 0),
  house_cut_pct     smallint NOT NULL DEFAULT 30 CHECK (house_cut_pct BETWEEN 0 AND 100),
  prize_object      text,                       -- premio en objeto, opcional

  -- puntaje configurable (defaults = lo que pidio el owner)
  points_exact      smallint NOT NULL DEFAULT 3,  -- marcador exacto
  points_one_team   smallint NOT NULL DEFAULT 1,  -- acertar los goles de UN equipo
  points_result     smallint NOT NULL DEFAULT 3,  -- acertar local/empate/visitante

  status            casa_polla_status NOT NULL DEFAULT 'borrador',
  opens_at          timestamptz NOT NULL DEFAULT now(),
  closes_at         timestamptz NOT NULL,       -- lock de pronosticos e inscripciones

  -- rifa
  ticket_count      integer CHECK (ticket_count > 0),
  draw_method       text,                       -- "los 2 ultimos de la Loteria de Medellin del sabado"
  drawn_number      integer,

  settled_at        timestamptz,
  settle_notes      text,

  created_by        uuid NOT NULL REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT casa_pollas_partidos_needs_mode
    CHECK (kind <> 'partidos' OR (scoring_mode IS NOT NULL AND tournament IS NOT NULL)),
  CONSTRAINT casa_pollas_rifa_needs_tickets
    CHECK (kind <> 'rifa' OR (ticket_count IS NOT NULL AND draw_method IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS casa_pollas_status_idx  ON public.casa_pollas(status, closes_at DESC);
CREATE INDEX IF NOT EXISTS casa_pollas_kind_idx    ON public.casa_pollas(kind);

-- ---------------------------------------------------------------------------
-- casa_polla_matches — que partidos entran en la polla (kind='partidos')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.casa_polla_matches (
  polla_id     uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  match_id     uuid NOT NULL REFERENCES public.matches(id),
  order_index  smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (polla_id, match_id)
);

CREATE INDEX IF NOT EXISTS casa_polla_matches_match_idx ON public.casa_polla_matches(match_id);

-- ---------------------------------------------------------------------------
-- casa_questions / casa_options — pollas manuales (ej. "primer goleador")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.casa_questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id           uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  prompt             text NOT NULL,
  order_index        smallint NOT NULL DEFAULT 0,
  points             smallint NOT NULL DEFAULT 3,
  input_kind         text NOT NULL DEFAULT 'opciones'
                       CHECK (input_kind IN ('opciones', 'texto')),
  resolved_option_id uuid,
  resolved_text      text,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS casa_questions_polla_idx ON public.casa_questions(polla_id, order_index);

CREATE TABLE IF NOT EXISTS public.casa_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES public.casa_questions(id) ON DELETE CASCADE,
  label        text NOT NULL,
  order_index  smallint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS casa_options_question_idx ON public.casa_options(question_id, order_index);

DO $$ BEGIN
  ALTER TABLE public.casa_questions
    ADD CONSTRAINT casa_questions_resolved_option_fk
    FOREIGN KEY (resolved_option_id) REFERENCES public.casa_options(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- casa_entries — inscripcion de un usuario (y su pago)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.casa_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id           uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status             casa_entry_status NOT NULL DEFAULT 'pendiente',
  amount_cop         integer NOT NULL CHECK (amount_cop >= 0),

  proof_path         text,                      -- objeto en el bucket privado `comprobantes`
  proof_uploaded_at  timestamptz,

  reviewed_by        uuid REFERENCES public.users(id),
  reviewed_at        timestamptz,
  reject_reason      text,

  ticket_number      integer,                   -- solo rifa

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Una inscripcion por persona por polla... salvo en rifa, donde cada boleta
-- es su propia fila y lo unico unico es el numero.
CREATE UNIQUE INDEX IF NOT EXISTS casa_entries_one_per_user
  ON public.casa_entries(polla_id, user_id) WHERE ticket_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS casa_entries_ticket_unique
  ON public.casa_entries(polla_id, ticket_number) WHERE ticket_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS casa_entries_polla_status_idx ON public.casa_entries(polla_id, status);
CREATE INDEX IF NOT EXISTS casa_entries_user_idx         ON public.casa_entries(user_id, created_at DESC);
-- La cola del bot: lo pendiente con pantallazo ya subido.
CREATE INDEX IF NOT EXISTS casa_entries_pending_idx
  ON public.casa_entries(created_at) WHERE status = 'pendiente' AND proof_path IS NOT NULL;

-- ---------------------------------------------------------------------------
-- casa_picks — los pronosticos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.casa_picks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id       uuid NOT NULL REFERENCES public.casa_entries(id) ON DELETE CASCADE,
  polla_id       uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  match_id       uuid REFERENCES public.matches(id),
  question_id    uuid REFERENCES public.casa_questions(id) ON DELETE CASCADE,

  pick_1x2       char(1) CHECK (pick_1x2 IN ('L', 'E', 'V')),
  home_score     smallint CHECK (home_score BETWEEN 0 AND 30),
  away_score     smallint CHECK (away_score BETWEEN 0 AND 30),
  option_id      uuid REFERENCES public.casa_options(id) ON DELETE SET NULL,
  free_text      text,

  points_earned  smallint NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- apunta exactamente a un partido O a una pregunta, nunca a los dos
  CONSTRAINT casa_picks_target CHECK (num_nonnulls(match_id, question_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS casa_picks_match_unique
  ON public.casa_picks(entry_id, match_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS casa_picks_question_unique
  ON public.casa_picks(entry_id, question_id) WHERE question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS casa_picks_polla_idx ON public.casa_picks(polla_id);
-- Para los porcentajes ("cuantos pusieron 2-1"): agregacion por partido.
CREATE INDEX IF NOT EXISTS casa_picks_match_idx ON public.casa_picks(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS casa_picks_question_idx ON public.casa_picks(question_id) WHERE question_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- casa_payouts — a quien le toco cuanto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.casa_payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id    uuid NOT NULL REFERENCES public.casa_pollas(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id),
  place       smallint NOT NULL DEFAULT 1,
  points      smallint,
  amount_cop  integer NOT NULL CHECK (amount_cop >= 0),
  paid_at     timestamptz,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (polla_id, user_id)
);

CREATE INDEX IF NOT EXISTS casa_payouts_polla_idx ON public.casa_payouts(polla_id, place);

-- ---------------------------------------------------------------------------
-- telegram_admins — chats vinculados al panel (se vinculan con el codigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_admins (
  chat_id      bigint PRIMARY KEY,
  username     text,
  first_name   text,
  user_id      uuid REFERENCES public.users(id),
  active       boolean NOT NULL DEFAULT true,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

-- Auditoria + dedupe de lo que manda el bot.
CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  ref_id      uuid,
  chat_id     bigint NOT NULL,
  message_id  bigint,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_outbox_ref_idx ON public.telegram_outbox(kind, ref_id);

-- Rate limit / anti-fuerza-bruta del codigo de acceso del bot.
CREATE TABLE IF NOT EXISTS public.telegram_auth_attempts (
  chat_id     bigint NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_auth_attempts_idx
  ON public.telegram_auth_attempts(chat_id, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers
--
-- Ojo (Regla #5 del repo): `public.set_updated_at()` esta referenciada en 3
-- migraciones viejas pero NO existe en prod — otro caso de drift de schema por
-- hot-patch. La creamos aca con CREATE OR REPLACE para que quede en git y las
-- migraciones viejas dejen de mentir. Es aditivo: si algun dia aparece la
-- version original, esta hace exactamente lo mismo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;

DO $$ BEGIN
  CREATE TRIGGER set_casa_pollas_updated_at BEFORE UPDATE ON public.casa_pollas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_casa_entries_updated_at BEFORE UPDATE ON public.casa_entries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_casa_picks_updated_at BEFORE UPDATE ON public.casa_picks
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- RLS — todo prendido. La app lee/escribe con service_role + filtro explicito
-- por user_id (mismo patron que el resto del repo, ver TODO auth.uid() en
-- CLAUDE.md). Las policies de `authenticated` son defense-in-depth: si algun
-- dia auth.uid() propaga bien, ya estan puestas y fallan cerradas mientras no.
-- ---------------------------------------------------------------------------
ALTER TABLE public.casa_pollas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_polla_matches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_options           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_entries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_picks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_payouts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_outbox        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_auth_attempts ENABLE ROW LEVEL SECURITY;

-- Catalogo publico: una polla abierta la puede ver cualquiera logueado.
DROP POLICY IF EXISTS casa_pollas_read ON public.casa_pollas;
CREATE POLICY casa_pollas_read ON public.casa_pollas
  FOR SELECT TO authenticated
  USING (status <> 'borrador');

DROP POLICY IF EXISTS casa_polla_matches_read ON public.casa_polla_matches;
CREATE POLICY casa_polla_matches_read ON public.casa_polla_matches
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS casa_questions_read ON public.casa_questions;
CREATE POLICY casa_questions_read ON public.casa_questions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS casa_options_read ON public.casa_options;
CREATE POLICY casa_options_read ON public.casa_options
  FOR SELECT TO authenticated USING (true);

-- Plata y pronosticos: solo lo tuyo.
DROP POLICY IF EXISTS casa_entries_own ON public.casa_entries;
CREATE POLICY casa_entries_own ON public.casa_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS casa_picks_own ON public.casa_picks;
CREATE POLICY casa_picks_own ON public.casa_picks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS casa_payouts_own ON public.casa_payouts;
CREATE POLICY casa_payouts_own ON public.casa_payouts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- telegram_*: service_role y nadie mas. Sin policies = deny-all para el resto.

-- ---------------------------------------------------------------------------
-- GRANTs explicitos (boilerplate obligatorio del repo — deadline Supabase
-- 30-oct-2026: sin esto, PostgREST devuelve 42501 en tablas nuevas).
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.casa_pollas, public.casa_polla_matches,
                public.casa_questions, public.casa_options,
                public.casa_entries, public.casa_picks, public.casa_payouts
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.casa_pollas, public.casa_polla_matches, public.casa_questions,
  public.casa_options, public.casa_entries, public.casa_picks,
  public.casa_payouts, public.telegram_admins, public.telegram_outbox,
  public.telegram_auth_attempts
  TO service_role;

-- anon: nada. Todo pide sesion.
