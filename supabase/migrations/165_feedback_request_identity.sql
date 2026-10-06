-- Preserve existing reports. New clients can safely repeat an insert using the
-- same per-user identity; retries never update somebody's report or its status.
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_user_request_identity
  ON public.feedback (user_id, request_id) WHERE request_id IS NOT NULL;
COMMENT ON COLUMN public.feedback.request_id IS
  'Client request identity, scoped to the authenticated author. NULL keeps legacy reports compatible.';
