-- 026_restore_whatsapp_conversation_state.sql
--
-- Restores public.whatsapp_conversation_state, dropped in migration 023
-- when the conversational bot was retired. The bot is back (commit
-- restoring lib/whatsapp/flows.ts), so the state-machine table is needed
-- again.
--
-- Schema mirrors the original 015 plus three new columns that the
-- predict-by-group flow always needed but never persisted (the original
-- state.ts declared them in the TS type and dropped them on the floor —
-- that was a latent bug that made multi-message predict-group flows
-- unreliable). The new columns are nullable so they don't break the
-- single-message paths.
--
-- Keyed by phone (E.164 without a leading plus, as Meta delivers). One
-- row per active conversation. TTL is 10 min, enforced lazily by the
-- read path (no cron, no trigger). Stale rows are overwritten by the
-- next turn or simply ignored by readers.
--
-- RLS enabled with no policies — service role only. End users never
-- read this scratch data.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_state (
  phone varchar PRIMARY KEY,
  action varchar(40) NOT NULL,
  polla_id uuid,
  match_id uuid,
  match_index smallint,
  total_matches smallint,
  page smallint,
  predicted_home smallint
    CHECK (predicted_home IS NULL OR predicted_home BETWEEN 0 AND 20),
  predicted_away smallint
    CHECK (predicted_away IS NULL OR predicted_away BETWEEN 0 AND 20),
  join_code varchar(6),
  predict_group_mode varchar(8)
    CHECK (predict_group_mode IS NULL
           OR predict_group_mode IN ('phase', 'date')),
  predict_group_key varchar(80),
  predict_group_page smallint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_state_expires
  ON public.whatsapp_conversation_state (expires_at);

COMMENT ON TABLE public.whatsapp_conversation_state IS
  'Conversation state for the WhatsApp bot multi-step flows. Survives
   Lambda cold starts. TTL enforced lazily: readers filter
   expires_at > now(). Restored in migration 026 after being dropped in
   023.';

COMMENT ON COLUMN public.whatsapp_conversation_state.phone IS
  'Meta-delivered phone string, E.164 without a leading plus (for
   example 573146167334). Natural key, one row per active conversation.';

COMMENT ON COLUMN public.whatsapp_conversation_state.predict_group_mode IS
  'When the predict flow groups by phase or by date, this records the
   active grouping mode so paging/selection survives across messages.';

COMMENT ON COLUMN public.whatsapp_conversation_state.predict_group_key IS
  'The currently selected group key (phase slug or yyyy-mm-dd) inside
   predict_group_mode. Null while the user is still picking a group.';

COMMENT ON COLUMN public.whatsapp_conversation_state.predict_group_page IS
  'Pagination cursor for the group-list message itself when there are
   more groups than fit in a single 10-row WhatsApp list.';

ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;
