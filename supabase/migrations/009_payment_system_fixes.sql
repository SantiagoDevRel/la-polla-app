-- 009_payment_system_fixes.sql
-- 1. Widen CHECK on pollas.payment_mode to include 'pay_winner'.
-- 2. Widen CHECK on pollas.status to include 'ended' (consumed by migration 008 trigger).
-- 3. Add payment_status to polla_participants so we can gate digital_pool saves
--    without overloading the existing status column (which is used for admin approval).

-- payment_mode: keep 'honor' for back-compat with existing rows; add 'pay_winner'.
ALTER TABLE pollas DROP CONSTRAINT IF EXISTS pollas_payment_mode_check;
ALTER TABLE pollas
  ADD CONSTRAINT pollas_payment_mode_check
  CHECK (payment_mode IN ('honor', 'admin_collects', 'digital_pool', 'pay_winner'));

-- status: keep 'finished'/'cancelled' for back-compat; add 'ended'.
ALTER TABLE pollas DROP CONSTRAINT IF EXISTS pollas_status_check;
ALTER TABLE pollas
  ADD CONSTRAINT pollas_status_check
  CHECK (status IN ('active', 'finished', 'ended', 'cancelled'));

-- payment_status tracks whether a participant has paid the buy_in for digital_pool pollas.
-- Default 'approved' so every existing row and every non-digital_pool flow is unblocked.
-- Only the digital_pool checkout path flips it to 'pending'; the Wompi webhook flips back to 'approved'.
ALTER TABLE polla_participants
  ADD COLUMN IF NOT EXISTS payment_status varchar(20) NOT NULL DEFAULT 'approved'
  CHECK (payment_status IN ('pending', 'approved'));

CREATE INDEX IF NOT EXISTS idx_participants_payment_status
  ON polla_participants(polla_id, payment_status);
