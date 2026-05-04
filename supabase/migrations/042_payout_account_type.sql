-- 042_payout_account_type — Distinción ahorros vs corriente para
-- Bancolombia (y "otro"). Pedido por usuarios mayores que necesitan
-- ese dato para hacer la transferencia desde su app de banco.
--
-- Solo aplica a method=bancolombia y "otro". Para nequi queda NULL
-- (Nequi es billetera, no tiene ahorros/corriente).
--
-- Aplica tanto al default global del user (users.default_payout_*)
-- como al override por polla:
--   - pollas.admin_payout_account_type → la cuenta del organizador
--   - polla_participants.payout_account_type → cuenta del ganador

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_payout_account_type text;

COMMENT ON COLUMN public.users.default_payout_account_type IS
  'Tipo de cuenta del default del user: ahorros | corriente. NULL para Nequi.';

ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS admin_payout_account_type text;

COMMENT ON COLUMN public.pollas.admin_payout_account_type IS
  'Tipo de cuenta del organizador para esta polla: ahorros | corriente. NULL para Nequi.';

ALTER TABLE public.polla_participants
  ADD COLUMN IF NOT EXISTS payout_account_type text;

COMMENT ON COLUMN public.polla_participants.payout_account_type IS
  'Override por polla del tipo de cuenta del ganador. NULL para Nequi.';
