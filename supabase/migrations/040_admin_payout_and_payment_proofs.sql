-- 040_admin_payout_and_payment_proofs — Foundation para AI-assist
-- screenshot en pollas modo admin_collects.
--
-- 1. pollas.admin_payout_* — la cuenta destino estructurada del
--    organizador. Necesario para que Sonnet pueda comparar
--    (monto + cuenta + nombre) contra el screenshot del user.
--    El campo viejo `admin_payment_instructions` (texto libre)
--    queda como fallback descriptivo.
--
-- 2. payment_proofs — el log de cada screenshot subido + el
--    veredicto AI + decisión final del admin. Storage 7 días
--    (file en Supabase Storage bucket separado), después auto-delete.

ALTER TABLE public.pollas
  ADD COLUMN IF NOT EXISTS admin_payout_method  text,
  ADD COLUMN IF NOT EXISTS admin_payout_account text,
  ADD COLUMN IF NOT EXISTS admin_payout_account_name text;

COMMENT ON COLUMN public.pollas.admin_payout_method IS
  'Método de pago del admin (nequi/bancolombia/otro) — solo aplica para payment_mode=admin_collects. Se usa para que la AI verifique screenshots.';
COMMENT ON COLUMN public.pollas.admin_payout_account IS
  'Cuenta del admin (celular para nequi, número para bancolombia). NULL para pay_winner.';
COMMENT ON COLUMN public.pollas.admin_payout_account_name IS
  'Nombre del titular como aparece en la cuenta. NULL para nequi.';

CREATE TABLE IF NOT EXISTS public.payment_proofs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id          uuid NOT NULL REFERENCES public.pollas(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Path en bucket payment-proofs. Pattern:
  --   pollas/{polla_id}/{user_id}/{uuid}.jpg
  -- Se borra automáticamente a los 7 días vía pg_cron.
  storage_path      text NOT NULL,
  -- Resultado del verifier AI (Sonnet 4.6).
  ai_source_type    text,
  ai_valid          boolean,
  ai_confidence     text,
  ai_detected_amount numeric(12, 2),
  ai_detected_account text,
  ai_detected_recipient_name text,
  ai_detected_date  date,
  ai_rejection_reason text,
  ai_evidence       text,
  ai_tokens_in      int NOT NULL DEFAULT 0,
  ai_tokens_out     int NOT NULL DEFAULT 0,
  ai_cost_usd       numeric(10, 6) NOT NULL DEFAULT 0,
  -- Decisión final del admin. NULL = aún no revisado.
  -- true = admin confirmó (mantiene paid=true). false = admin
  -- revocó (revierte paid a false).
  admin_decision    boolean,
  admin_reviewed_at timestamptz,
  admin_reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  admin_notes       text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  expires_at        timestamptz NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS payment_proofs_polla_idx
  ON public.payment_proofs(polla_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_proofs_user_idx
  ON public.payment_proofs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_proofs_pending_review_idx
  ON public.payment_proofs(polla_id) WHERE admin_decision IS NULL;
CREATE INDEX IF NOT EXISTS payment_proofs_expires_idx
  ON public.payment_proofs(expires_at);

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_proofs_service_role ON public.payment_proofs;
CREATE POLICY payment_proofs_service_role ON public.payment_proofs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS payment_proofs_uploader_read ON public.payment_proofs;
CREATE POLICY payment_proofs_uploader_read ON public.payment_proofs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS payment_proofs_admin_read ON public.payment_proofs;
CREATE POLICY payment_proofs_admin_read ON public.payment_proofs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pollas p
       WHERE p.id = payment_proofs.polla_id
         AND p.created_by = auth.uid()
    )
  );

COMMENT ON TABLE public.payment_proofs IS
  'AI-assist screenshot proofs para admin_collects. Cada row = una upload. storage_path se auto-elimina a los 7 días via pg_cron (storage file + row).';
