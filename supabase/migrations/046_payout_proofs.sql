-- 046_payout_proofs — Screenshots peer-to-peer (loser → ganador).
--
-- Cuando un loser le paga al ganador en pollas pay_winner (o cuando
-- el admin paga a los winners en admin_collects), opcionalmente puede
-- subir un screenshot del comprobante. El ganador lo ve como soporte
-- visual, sin verificación / dispute. Buena fe.
--
-- Auto-cleanup a 7 días via cron: tanto el archivo en storage como
-- las columnas se nullifican.

-- 1. Columnas en polla_payouts.
ALTER TABLE public.polla_payouts
  ADD COLUMN IF NOT EXISTS proof_storage_path text,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz;

COMMENT ON COLUMN public.polla_payouts.proof_storage_path IS
  'Path en bucket payout-proofs. NULL si el loser no subió comprobante. Auto-borrado a los 7 días.';
COMMENT ON COLUMN public.polla_payouts.proof_uploaded_at IS
  'Timestamp del upload — sirve al cron de cleanup. NULL si no hay proof.';

-- Index parcial para el cron (solo rows con proof activo).
CREATE INDEX IF NOT EXISTS idx_polla_payouts_proof_uploaded_at
  ON public.polla_payouts(proof_uploaded_at)
  WHERE proof_uploaded_at IS NOT NULL;

-- 2. Bucket de storage privado, service-role only (mismo patrón que
-- payment-proofs).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payout-proofs',
  'payout-proofs',
  false,
  10 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS payout_proofs_service_only ON storage.objects;
CREATE POLICY payout_proofs_service_only ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'payout-proofs')
  WITH CHECK (bucket_id = 'payout-proofs');
