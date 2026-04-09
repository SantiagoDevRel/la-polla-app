-- ============================================================
-- LA POLLA - Schema SQL completo para Supabase
-- App de pollas mundialistas colombiana
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. TABLAS
-- ============================================================

-- USUARIOS
-- Login siempre requiere WhatsApp. Email es opcional pero si existe,
-- igual debe tener whatsapp_number verificado.
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number   varchar(20) UNIQUE NOT NULL,
  whatsapp_verified boolean DEFAULT false,
  email             varchar UNIQUE,
  display_name      varchar(100) NOT NULL,
  avatar_url        text,
  created_at        timestamptz DEFAULT now()
);

-- PARTIDOS (fuente de verdad de resultados, alimentada por API-Football)
CREATE TABLE matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     varchar(50) UNIQUE,           -- ID de API-Football
  tournament      varchar(50) NOT NULL,          -- 'worldcup_2026', 'liga_betplay', etc
  match_day       int,
  phase           varchar(30),                   -- 'group_a', 'round_of_32', 'final'
  home_team       varchar(60) NOT NULL,
  away_team       varchar(60) NOT NULL,
  home_team_flag  text,
  away_team_flag  text,
  scheduled_at    timestamptz NOT NULL,
  venue           varchar(100),
  home_score      int,                           -- null hasta que termine
  away_score      int,
  status          varchar(20) DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','live','finished','cancelled')),
  created_at      timestamptz DEFAULT now()
);

-- POLLAS
CREATE TABLE pollas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              varchar(50) UNIQUE NOT NULL,  -- URL: /p/mundial-oficina
  name              varchar(100) NOT NULL,
  description       text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  type              varchar(20) DEFAULT 'closed'
                    CHECK (type IN ('open','closed')),
  status            varchar(20) DEFAULT 'active'
                    CHECK (status IN ('active','finished','cancelled')),
  tournament        varchar(50) NOT NULL,
  scope             varchar(30) NOT NULL
                    CHECK (scope IN ('full','group_stage','knockouts','custom')),
  match_ids         uuid[],                       -- solo si scope = 'custom'
  buy_in_amount     numeric(12,2) DEFAULT 0,
  currency          varchar(10) DEFAULT 'COP',
  platform_fee_pct  numeric(5,2) DEFAULT 0.00,   -- arranca en 0, alterable en el futuro
  prize_pool        numeric(12,2) DEFAULT 0,      -- (participantes * buy_in) * (1 - fee%)
  points_exact      int DEFAULT 5,                -- puntos por marcador exacto
  points_winner     int DEFAULT 2,                -- puntos por resultado correcto
  points_one_team   int DEFAULT 1,                -- puntos por goles de un equipo exactos
  payment_mode      varchar(20) DEFAULT 'honor'
                    CHECK (payment_mode IN ('honor','admin_collects','digital_pool')),
                    -- 'honor': sin pago upfront, cada uno le paga al ganador al final
                    -- 'admin_collects': el admin recoge y distribuye, plataforma solo trackea
                    -- 'digital_pool': el admin declara monto total, plataforma muestra a quién pagarle
  created_at        timestamptz DEFAULT now(),
  starts_at         timestamptz,
  ends_at           timestamptz
);

-- PARTICIPANTES DE UNA POLLA
CREATE TABLE polla_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id        uuid REFERENCES pollas(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  role            varchar(20) DEFAULT 'player'
                  CHECK (role IN ('admin','player')),
  status          varchar(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  paid            boolean DEFAULT false,
  paid_at         timestamptz,
  paid_amount     numeric(12,2),
  payment_note    text,                           -- "pagó por Nequi ref #123"
  payment_proof_url text,                         -- URL del comprobante en Supabase Storage
  payment_mode_note text,                         -- instrucciones de pago para este grupo
                                                  -- ej: "Pagar a Nequi 3001234567 antes del 11 de junio"
  total_points    int DEFAULT 0,                  -- cache recalculado después de cada partido
  rank            int,
  joined_at       timestamptz DEFAULT now(),
  UNIQUE(polla_id, user_id)
);

-- PRONOSTICOS
CREATE TABLE predictions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id        uuid REFERENCES pollas(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  match_id        uuid REFERENCES matches(id) ON DELETE CASCADE,
  predicted_home  int NOT NULL CHECK (predicted_home >= 0),
  predicted_away  int NOT NULL CHECK (predicted_away >= 0),
  submitted_at    timestamptz DEFAULT now(),
  locked          boolean DEFAULT false,          -- true cuando faltan <5min para el partido
  visible         boolean DEFAULT false,          -- true cuando el partido pasa a 'live'
  points_earned   int DEFAULT 0,                  -- calculado al terminar el partido
  UNIQUE(polla_id, user_id, match_id)
);

-- INVITACIONES (para pollas cerradas)
CREATE TABLE polla_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id        uuid REFERENCES pollas(id) ON DELETE CASCADE,
  invited_by      uuid REFERENCES users(id),
  whatsapp_number varchar(20),
  email           varchar,
  token           varchar(64) UNIQUE NOT NULL,    -- token único de URL de invitación
  status          varchar(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','expired')),
  expires_at      timestamptz DEFAULT now() + interval '7 days',
  created_at      timestamptz DEFAULT now()
);

-- LOG DE MENSAJES WHATSAPP
CREATE TABLE whatsapp_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id),
  direction       varchar(10) CHECK (direction IN ('inbound','outbound')),
  message_type    varchar(30),                    -- 'otp','reminder','result','payment_proof','approval'
  content         text,
  media_url       text,                           -- si el mensaje tiene imagen/documento
  wa_message_id   varchar(100),                   -- ID de Meta para tracking
  status          varchar(20) DEFAULT 'sent'
                  CHECK (status IN ('sent','delivered','read','failed')),
  created_at      timestamptz DEFAULT now()
);

-- ============================================================
-- 2. ÍNDICES
-- ============================================================

CREATE INDEX idx_predictions_polla_user ON predictions(polla_id, user_id);
CREATE INDEX idx_predictions_match ON predictions(match_id);
CREATE INDEX idx_participants_polla ON polla_participants(polla_id);
CREATE INDEX idx_participants_user ON polla_participants(user_id);
CREATE INDEX idx_matches_tournament ON matches(tournament);
CREATE INDEX idx_matches_scheduled ON matches(scheduled_at);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_pollas_slug ON pollas(slug);

-- ============================================================
-- 3. FUNCIONES Y TRIGGERS
-- ============================================================

-- 3.1 Función que calcula puntos para una predicción dado el resultado final
CREATE OR REPLACE FUNCTION calculate_prediction_points(
  p_predicted_home int,
  p_predicted_away int,
  p_actual_home int,
  p_actual_away int,
  p_points_exact int,
  p_points_winner int,
  p_points_one_team int
) RETURNS int AS $$
DECLARE
  points int := 0;
  predicted_result varchar;
  actual_result varchar;
BEGIN
  -- Marcador exacto
  IF p_predicted_home = p_actual_home AND p_predicted_away = p_actual_away THEN
    RETURN p_points_exact;
  END IF;

  -- Resultado correcto (ganador o empate)
  predicted_result := CASE
    WHEN p_predicted_home > p_predicted_away THEN 'home'
    WHEN p_predicted_home < p_predicted_away THEN 'away'
    ELSE 'draw' END;
  actual_result := CASE
    WHEN p_actual_home > p_actual_away THEN 'home'
    WHEN p_actual_home < p_actual_away THEN 'away'
    ELSE 'draw' END;

  IF predicted_result = actual_result THEN
    points := points + p_points_winner;
  END IF;

  -- Goles de al menos un equipo exactos
  IF p_predicted_home = p_actual_home OR p_predicted_away = p_actual_away THEN
    points := points + p_points_one_team;
  END IF;

  RETURN points;
END;
$$ LANGUAGE plpgsql;

-- 3.2 Trigger: cuando un partido termina, calcula puntos de todos los pronósticos
CREATE OR REPLACE FUNCTION on_match_finished() RETURNS trigger AS $$
BEGIN
  -- Solo actuar cuando el status cambia a 'finished'
  IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
    -- Calcular puntos para cada predicción de este partido
    UPDATE predictions p
    SET points_earned = calculate_prediction_points(
      p.predicted_home,
      p.predicted_away,
      NEW.home_score,
      NEW.away_score,
      pol.points_exact,
      pol.points_winner,
      pol.points_one_team
    )
    FROM pollas pol
    WHERE p.match_id = NEW.id
      AND p.polla_id = pol.id;

    -- Recalcular total de puntos por participante en cada polla afectada
    UPDATE polla_participants pp
    SET total_points = (
      SELECT COALESCE(SUM(pred.points_earned), 0)
      FROM predictions pred
      WHERE pred.polla_id = pp.polla_id
        AND pred.user_id = pp.user_id
    )
    WHERE pp.polla_id IN (
      SELECT DISTINCT polla_id FROM predictions WHERE match_id = NEW.id
    );

    -- Actualizar ranks dentro de cada polla afectada
    WITH ranked AS (
      SELECT id,
             RANK() OVER (PARTITION BY polla_id ORDER BY total_points DESC) as new_rank
      FROM polla_participants
      WHERE polla_id IN (
        SELECT DISTINCT polla_id FROM predictions WHERE match_id = NEW.id
      )
    )
    UPDATE polla_participants pp
    SET rank = r.new_rank
    FROM ranked r
    WHERE pp.id = r.id;
  END IF;

  -- Cuando el partido pasa a 'live', hacer visibles todos los pronósticos
  IF NEW.status = 'live' AND OLD.status != 'live' THEN
    UPDATE predictions
    SET visible = true, locked = true
    WHERE match_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_match_status_change
  AFTER UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION on_match_finished();

-- 3.3 Función que bloquea predicciones si faltan menos de 5 minutos
CREATE OR REPLACE FUNCTION check_prediction_lock() RETURNS trigger AS $$
DECLARE
  match_time timestamptz;
BEGIN
  SELECT scheduled_at INTO match_time FROM matches WHERE id = NEW.match_id;

  IF match_time - now() < interval '5 minutes' THEN
    RAISE EXCEPTION 'No se pueden modificar pronósticos a menos de 5 minutos del partido';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_lock_predictions
  BEFORE INSERT OR UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION check_prediction_lock();

-- ============================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pollas ENABLE ROW LEVEL SECURITY;
ALTER TABLE polla_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE polla_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Users: solo puedes ver y editar tu propio perfil
CREATE POLICY "users_select_own" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid() = id);

-- Matches: todos pueden ver, solo service role puede escribir
CREATE POLICY "matches_select_all" ON matches FOR SELECT USING (true);

-- Pollas: todos pueden ver pollas activas
CREATE POLICY "pollas_select_active" ON pollas FOR SELECT USING (status = 'active');
CREATE POLICY "pollas_insert_auth" ON pollas FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "pollas_update_admin" ON pollas FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM polla_participants
    WHERE polla_id = id AND user_id = auth.uid() AND role = 'admin'
  )
);

-- Participantes: puedes ver participantes de pollas en las que estás
CREATE POLICY "participants_select" ON polla_participants FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM polla_participants pp2
    WHERE pp2.polla_id = polla_participants.polla_id AND pp2.user_id = auth.uid()
  )
);
CREATE POLICY "participants_insert_self" ON polla_participants FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Predicciones:
-- Solo puedes ver TUS pronósticos mientras el partido no ha empezado
-- Puedes ver TODOS cuando visible = true (partido en vivo o terminado)
CREATE POLICY "predictions_select" ON predictions FOR SELECT USING (
  user_id = auth.uid() OR visible = true
);
CREATE POLICY "predictions_insert" ON predictions FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "predictions_update_own" ON predictions FOR UPDATE
  USING (user_id = auth.uid() AND locked = false);

-- Invitaciones: solo el creador y el invitado pueden ver
CREATE POLICY "invites_select" ON polla_invites FOR SELECT USING (
  invited_by = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND whatsapp_number = polla_invites.whatsapp_number)
);

-- WhatsApp messages: solo puedes ver tus propios mensajes
CREATE POLICY "wa_messages_select_own" ON whatsapp_messages FOR SELECT USING (
  user_id = auth.uid()
);
