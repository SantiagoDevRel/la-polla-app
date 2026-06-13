-- 067_bracket_predictions.sql — Camino pronosticado de la bracket "Road to
-- World Cup" por usuario, persistido en DB para sobrevivir cambio de
-- dispositivo / limpieza de browser (antes vivía SOLO en localStorage).
--
-- Una fila por (user_id, tournament) con el camino serializado en JSONB:
--   { "assignments": { "<slotKey>": "<teamId>", ... },
--     "winners":     { "<matchDay>": "<teamId>", ... } }
--
-- Es una predicción LIBRE de cruces que NO suma puntos (las pollas se
-- puntúan aparte, por `predictions`), así que esta tabla no referencia
-- matches/predictions ni dispara scoring. Solo persiste el dibujo del
-- usuario. Barata: ~1 fila por usuario, unos pocos KB de JSONB.

CREATE TABLE public.bracket_predictions (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament text NOT NULL DEFAULT 'worldcup_2026',
  path       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tournament)
);

-- RLS ON (regla de seguridad #1, siempre).
ALTER TABLE public.bracket_predictions ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: cada usuario solo ve/escribe su propia fila. El server
-- además filtra por user_id explícito (auth.uid() devuelve NULL en el
-- contexto PostgREST — ver TODO auth.uid() en CLAUDE.md — por eso usa admin
-- client; estas policies son el último colchón si algún día se llamara la
-- Data API directo).
CREATE POLICY bracket_predictions_own ON public.bracket_predictions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- GRANTs explícitos (Supabase corta los auto-grants desde 30-oct-2026).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bracket_predictions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bracket_predictions TO service_role;

-- Least-privilege: hasta 30-oct-2026 Supabase AÚN auto-grantea anon en tablas
-- nuevas. RLS sin policy para anon ya lo bloquea, pero lo revocamos explícito
-- (como la tabla 066). Aplicado a prod 2026-06-12 + advisor security limpio.
REVOKE ALL ON public.bracket_predictions FROM anon;
