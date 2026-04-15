-- 012_polla_invite_token.sql — Open shareable invite link per polla.
-- One token per polla, multi-use, regeneratable by the admin.
ALTER TABLE pollas
  ADD COLUMN IF NOT EXISTS invite_token VARCHAR(32) UNIQUE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_pollas_invite_token ON pollas(invite_token);
