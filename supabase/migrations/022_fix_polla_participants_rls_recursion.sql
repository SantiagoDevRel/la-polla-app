-- Fix infinite recursion in polla_participants RLS.
-- The original participants_select policy queried polla_participants from
-- within its own USING clause, causing each SELECT to retrigger the policy.
-- Extracting the check to a SECURITY DEFINER function bypasses RLS for the
-- internal lookup while preserving the original authorization semantics:
-- a user sees rows for pollas where they themselves are an approved participant.

CREATE OR REPLACE FUNCTION public.is_approved_participant(p_polla_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM polla_participants
    WHERE polla_id = p_polla_id
      AND user_id = auth.uid()
      AND status = 'approved'
  )
$$;

REVOKE ALL ON FUNCTION public.is_approved_participant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_approved_participant(uuid) TO authenticated;

DROP POLICY IF EXISTS participants_select ON public.polla_participants;

CREATE POLICY participants_select
ON public.polla_participants
FOR SELECT
TO public
USING (
  user_id = auth.uid()
  OR public.is_approved_participant(polla_id)
);
