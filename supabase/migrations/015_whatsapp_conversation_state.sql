-- 015_whatsapp_conversation_state.sql
--
-- Creates public.whatsapp_conversation_state, the persistence layer for the
-- multi-step WhatsApp bot flows. Replaces the in-memory Map in
-- lib/whatsapp/state.ts, which was wiped on every Vercel Lambda cold start
-- and caused users to lose their place mid-prediction or mid-join.
--
-- Keyed by phone (E.164 without a leading plus, as Meta delivers). One row
-- per active conversation. Rows expire 10 minutes after the last write; the
-- expiry is enforced lazily by the read path (no pg_cron, no trigger, no
-- background worker). Stale rows remain harmless until they are either
-- overwritten by a new conversation turn or cleaned up in a later phase.
--
-- RLS is enabled with no policies, which matches migration 006_otp_rate_limits
-- and means only the service role can touch the table. End users never need
-- to read this scratch data.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_state (
  phone varchar PRIMARY KEY,
  action varchar(40) NOT NULL,
  polla_id uuid,
  match_id uuid,
  match_index smallint,
  total_matches smallint,
  page smallint,
  predicted_home smallint CHECK (predicted_home IS NULL OR predicted_home BETWEEN 0 AND 20),
  predicted_away smallint CHECK (predicted_away IS NULL OR predicted_away BETWEEN 0 AND 20),
  join_code varchar(6),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Cleanup queries filter by expires_at. Partial index kept small so the main
-- PK-by-phone read path stays cache-friendly.
CREATE INDEX IF NOT EXISTS idx_wa_conv_state_expires
  ON public.whatsapp_conversation_state (expires_at);

COMMENT ON TABLE public.whatsapp_conversation_state IS
  'Conversation state for the WhatsApp bot multi-step flows. Survives Lambda
   cold starts. TTL enforced lazily: readers filter expires_at > now().';

COMMENT ON COLUMN public.whatsapp_conversation_state.phone IS
  'Meta-delivered phone string, E.164 without a leading plus (for example
   573146167334). Natural key, one row per active conversation.';

-- RLS: service role only. No policies for authenticated or anon roles, which
-- mirrors otp_rate_limits (migration 006). Service role bypasses RLS for the
-- bot writes, and end users never need to read this scratch data.
ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;
