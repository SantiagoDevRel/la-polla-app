-- 019_tighten_rls_predictions_and_pollas.sql
-- Two leaks fixed:
--
-- 1) predictions_select previously allowed any authenticated user to read
--    visible=true rows from any polla. After this migration the read is
--    gated to the polla's own participants, so even after kickoff a non-
--    member cannot enumerate predictions of other pollas.
--
-- 2) pollas_select_active previously exposed every active or ended polla
--    to every authenticated user. With private (type='closed') pollas
--    being the only mode shipped to the MVP this means anyone could fetch
--    a polla by guessing slugs. We restrict closed pollas to the creator
--    and approved participants. Open pollas remain readable since they
--    are intended to be discoverable.
--
-- Both policies still rely on auth.uid(); the API uses the admin client
-- for server-rendered reads (auth.uid() NULL workaround) so the practical
-- effect today is on direct PostgREST traffic from the browser supabase
-- client. When auth.uid() propagation is fixed the gates become primary.

-- 1. predictions_select tightening.
DROP POLICY IF EXISTS "predictions_select" ON predictions;
CREATE POLICY "predictions_select" ON predictions FOR SELECT USING (
  user_id = auth.uid()
  OR (
    visible = true
    AND EXISTS (
      SELECT 1 FROM polla_participants pp
      WHERE pp.polla_id = predictions.polla_id
        AND pp.user_id = auth.uid()
    )
  )
);

-- 2. pollas_select_active tightening. Closed pollas only readable by
-- creator OR approved participant. Open pollas (type='open') stay public
-- to keep the discoverability semantics the schema was designed for.
DROP POLICY IF EXISTS "pollas_select_active" ON pollas;
CREATE POLICY "pollas_select_active" ON pollas FOR SELECT USING (
  status IN ('active', 'ended')
  AND (
    type = 'open'
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM polla_participants pp
      WHERE pp.polla_id = pollas.id
        AND pp.user_id = auth.uid()
    )
  )
);
