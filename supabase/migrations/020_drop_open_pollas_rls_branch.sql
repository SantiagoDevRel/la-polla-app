-- 020_drop_open_pollas_rls_branch.sql
-- Public pollas (type='open') no longer ship in the product. The
-- type='open' allow-clause in pollas_select_active is dead code; this
-- migration replaces the policy with the closed-only form so RLS reads
-- match the application's actual model.
--
-- The CHECK constraint on pollas.type is left allowing both values for
-- safety (no rows with type='open' exist after the prior truncate; if
-- one ever appears via direct DB write it just becomes invisible to the
-- API). Tightening the CHECK can come later in a separate migration if
-- we want to enforce at the schema level.

DROP POLICY IF EXISTS "pollas_select_active" ON pollas;
CREATE POLICY "pollas_select_active" ON pollas FOR SELECT USING (
  status IN ('active', 'ended')
  AND (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM polla_participants pp
      WHERE pp.polla_id = pollas.id
        AND pp.user_id = auth.uid()
    )
  )
);
