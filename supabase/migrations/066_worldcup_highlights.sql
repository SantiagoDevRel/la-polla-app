-- 066_worldcup_highlights.sql — Pila persistente de highlights/goles/
-- resúmenes del Mundial para el strip "Lo último del Mundial" en /inicio.
--
-- Por qué una tabla: el RSS de un canal de YouTube devuelve SOLO los 15
-- uploads más recientes (no se pagina sin API key, que descartamos). Gol
-- Caracol sube mucho (previas, análisis, entrenamientos), así que los
-- resúmenes se caen de esa ventana de 15 en pocas horas. Acumulamos acá
-- los gol/resumen a medida que aparecen y mostramos los últimos 5-6 (más
-- nuevo a la izquierda) — así no dependemos de que el RSS los retenga.
--
-- Tabla service-role-only: /api/highlights (auth-gated) lee/escribe con el
-- admin client. RLS ON + deny-all para authenticated; service_role bypassa.

CREATE TABLE public.worldcup_highlights (
  video_id     text PRIMARY KEY,
  title        text NOT NULL,
  channel      text NOT NULL,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worldcup_highlights ENABLE ROW LEVEL SECURITY;

-- Deny-all explícito (silencia el Security Advisor; service_role bypassa RLS).
CREATE POLICY no_direct_access ON public.worldcup_highlights
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- GRANT solo a service_role — la Data API de authenticated/anon no toca esta
-- tabla (la pobla y lee únicamente el server).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worldcup_highlights TO service_role;

-- Orden del strip: más reciente primero.
CREATE INDEX worldcup_highlights_published_idx
  ON public.worldcup_highlights (published_at DESC NULLS LAST);
