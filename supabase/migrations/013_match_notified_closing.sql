-- 013_match_notified_closing.sql — Track which matches already triggered the
-- "predictions closing in 10 min" WhatsApp blast. Single-shot per match.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS notified_closing BOOLEAN NOT NULL DEFAULT false;
