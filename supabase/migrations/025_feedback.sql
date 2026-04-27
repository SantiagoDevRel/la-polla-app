-- 025_feedback.sql
-- User-submitted feedback / bug reports. The "Reportar problema" bubble
-- in BrandHeader writes here, and the route also fans out a copy to the
-- admin via WhatsApp + email so we hear about issues fast without
-- polling the table.
--
-- RLS:
--   • users  → INSERT and SELECT own rows.
--   • admins → SELECT all (via users.is_admin).
--   • UPDATE/DELETE → service role only (we mark resolved server-side).

CREATE TABLE IF NOT EXISTS public.feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL,
  page_url     TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  CONSTRAINT feedback_message_length CHECK (char_length(message) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id_created
  ON public.feedback (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_unresolved
  ON public.feedback (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_insert_own_feedback" ON public.feedback;
CREATE POLICY "users_insert_own_feedback"
  ON public.feedback FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users_select_own_feedback" ON public.feedback;
CREATE POLICY "users_select_own_feedback"
  ON public.feedback FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "admins_select_all_feedback" ON public.feedback;
CREATE POLICY "admins_select_all_feedback"
  ON public.feedback FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
       WHERE u.id = auth.uid()
         AND u.is_admin = true
    )
  );

COMMENT ON TABLE public.feedback IS
  'User-submitted feedback / bug reports. Created via "Reportar problema" header bubble. Server route also fans out to admin email + WhatsApp.';
