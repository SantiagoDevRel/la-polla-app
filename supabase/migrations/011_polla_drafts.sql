-- 011_polla_drafts.sql
-- Holds the form data for digital_pool pollas while we wait for the Wompi
-- payment webhook. Once transaction.status=APPROVED lands, the webhook
-- materializes the real polla from polla_data and stamps
-- completed_polla_slug so the payment-success page can redirect.

CREATE TABLE IF NOT EXISTS polla_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             varchar(100) UNIQUE NOT NULL,
  creator_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  polla_data            jsonb NOT NULL,
  wompi_checkout_url    text NOT NULL,
  completed_polla_slug  varchar(50),
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '2 hours'
);

CREATE INDEX IF NOT EXISTS idx_polla_drafts_reference ON polla_drafts(reference);
CREATE INDEX IF NOT EXISTS idx_polla_drafts_expires  ON polla_drafts(expires_at);
CREATE INDEX IF NOT EXISTS idx_polla_drafts_creator  ON polla_drafts(creator_id);

ALTER TABLE polla_drafts ENABLE ROW LEVEL SECURITY;

-- Creator can read their own drafts (so the polling page works under RLS).
DROP POLICY IF EXISTS polla_drafts_select_own ON polla_drafts;
CREATE POLICY polla_drafts_select_own ON polla_drafts
  FOR SELECT USING (creator_id = auth.uid());
