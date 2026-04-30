-- 036_user_default_payout — método/cuenta de cobro a nivel perfil del
-- user. Cuando ganan una polla, el WinnerPayoutModal pre-llena con
-- esto y solo confirman con un tap (sin re-tipear).
--
-- Per-polla payout_method/account en polla_participants sigue
-- existiendo y tiene precedencia (el user puede usar otra cuenta en
-- una polla específica si quiere).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_payout_method  text,
  ADD COLUMN IF NOT EXISTS default_payout_account text,
  ADD COLUMN IF NOT EXISTS default_payout_set_at  timestamptz;

COMMENT ON COLUMN public.users.default_payout_method IS
  'Método de cobro default (nequi/daviplata/bancolombia/transfiya/otro). Pre-llena polla_participants.payout_method al ganar.';
COMMENT ON COLUMN public.users.default_payout_account IS
  'Cuenta default. Solo se le muestra al parche de pollas donde ese user gana.';
COMMENT ON COLUMN public.users.default_payout_set_at IS
  'Timestamp del último update. NULL = nunca seteado, mostrar el prompt.';
