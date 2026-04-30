-- 037_claude_api_usage — Log de cada llamada al Anthropic API (Haiku
-- Vision para screenshots, futuras llamadas a Sonnet/Opus para chat
-- /admin si se construye). Permite trackear costo total + por user
-- y detectar abuso (un user que sube 20 screenshots/día es sospechoso).

CREATE TABLE IF NOT EXISTS public.claude_api_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  polla_id        uuid REFERENCES public.pollas(id) ON DELETE SET NULL,
  endpoint        text NOT NULL,
  model           text NOT NULL,
  tokens_in       int NOT NULL DEFAULT 0,
  tokens_out      int NOT NULL DEFAULT 0,
  image_bytes     int,
  cost_usd        numeric(10, 6) NOT NULL DEFAULT 0,
  success         boolean NOT NULL DEFAULT true,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS claude_api_usage_user_created_idx
  ON public.claude_api_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS claude_api_usage_created_idx
  ON public.claude_api_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS claude_api_usage_endpoint_idx
  ON public.claude_api_usage(endpoint, created_at DESC);

ALTER TABLE public.claude_api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claude_api_usage_service_role ON public.claude_api_usage;
CREATE POLICY claude_api_usage_service_role ON public.claude_api_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.claude_api_usage IS
  'Audit log de llamadas a Anthropic API. Service-role only — los users no leen esto. Usado por /admin para tracking de costo y detección de abuso.';
