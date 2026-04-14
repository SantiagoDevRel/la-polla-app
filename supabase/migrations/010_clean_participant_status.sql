-- 010_clean_participant_status.sql
-- A user is either OUT (no row) or IN (status='approved').
-- 'pending' is retired. 'rejected' stays as a banned flag.

-- 1. Remove everyone currently sitting in pending — they're effectively out.
DELETE FROM polla_participants WHERE status = 'pending';

-- 2. Tighten the CHECK so nothing can write 'pending' again.
ALTER TABLE polla_participants DROP CONSTRAINT IF EXISTS polla_participants_status_check;
ALTER TABLE polla_participants
  ADD CONSTRAINT polla_participants_status_check
  CHECK (status IN ('approved', 'rejected'));
