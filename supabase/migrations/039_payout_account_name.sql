-- 039_payout_account_name — Para que Sonnet pueda verificar el nombre
-- del beneficiario contra el screenshot (en Bancolombia/Otro), guardar
-- el nombre completo "como aparece en la cuenta" además del método y
-- número.
--
-- Aplica tanto al default global del user (users.default_payout_*)
-- como al override por polla (polla_participants.payout_*).
--
-- Para Nequi NO pedimos nombre (solo celular). El campo queda NULL.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_payout_account_name text;

COMMENT ON COLUMN public.users.default_payout_account_name IS
  'Nombre completo del titular como aparece en la cuenta. NULL para Nequi (solo se identifica por celular). Usado por la verificación AI de screenshots.';

ALTER TABLE public.polla_participants
  ADD COLUMN IF NOT EXISTS payout_account_name text;

COMMENT ON COLUMN public.polla_participants.payout_account_name IS
  'Override por polla del nombre del titular. NULL para Nequi.';
