-- A provider-confirmed cancellation releases its scheduled credit reservation.
-- Retain the campaign and recipient audit trail; never delete sent/scheduled history.
ALTER TABLE public.sms_campaigns DROP CONSTRAINT sms_campaigns_state_check;
ALTER TABLE public.sms_campaigns ADD CONSTRAINT sms_campaigns_state_check
  CHECK (state IN ('ready','dispatching','scheduled','accepted','rejected','unknown','cancelled'));
