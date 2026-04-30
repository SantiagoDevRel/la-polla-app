-- 041_payment_proofs_storage — Supabase Storage bucket privado para
-- los screenshots de prueba de pago. Service-role solo (los uploads
-- y reads se hacen desde el server con createAdminClient).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,                                       -- privado
  10 * 1024 * 1024,                            -- 10 MB cap
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS para storage.objects bajo este bucket: service-role solo.
-- (Los crons + el endpoint de upload usan service-role.) El user
-- no descarga directo del bucket — el admin review pasa por un
-- signed URL emitido por el server.

DROP POLICY IF EXISTS payment_proofs_service_only ON storage.objects;
CREATE POLICY payment_proofs_service_only ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'payment-proofs')
  WITH CHECK (bucket_id = 'payment-proofs');
