-- 007_invite_rls.sql — Complete RLS policies for polla_invites
-- Drop existing SELECT-only policy and recreate with full CRUD

DROP POLICY IF EXISTS "invites_select" ON polla_invites;

-- SELECT: can see invites you sent OR invites addressed to your whatsapp number
CREATE POLICY "invites_select" ON polla_invites FOR SELECT USING (
  invited_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND whatsapp_number = polla_invites.whatsapp_number
  )
);

-- INSERT: only the inviter (must be yourself)
CREATE POLICY "invites_insert" ON polla_invites FOR INSERT
  WITH CHECK (invited_by = auth.uid());

-- UPDATE: inviter can cancel, invited user can accept
CREATE POLICY "invites_update" ON polla_invites FOR UPDATE USING (
  invited_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND whatsapp_number = polla_invites.whatsapp_number
  )
);
