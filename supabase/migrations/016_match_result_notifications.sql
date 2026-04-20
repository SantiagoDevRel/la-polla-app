-- 016_match_result_notifications.sql
-- Dedup table for notifyMatchFinished WhatsApp sends. Primary key
-- enforces at-most-once notification per (user, match, polla). The
-- send path inserts first, then sends, skipping silently on conflict.
-- Kept per-polla (not per-user-match) so the current one-ping-per-polla
-- UX stays intact. Consolidation is a separate future batch.

CREATE TABLE IF NOT EXISTS public.match_result_notifications (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  polla_id UUID NOT NULL REFERENCES public.pollas(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_id, polla_id)
);

CREATE INDEX IF NOT EXISTS idx_mrn_match_id ON public.match_result_notifications (match_id);

ALTER TABLE public.match_result_notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.match_result_notifications IS
  'Dedup log for notifyMatchFinished WhatsApp sends. Service-role only. Insert-then-send pattern: attempt insert, only send if insert created the row.';
