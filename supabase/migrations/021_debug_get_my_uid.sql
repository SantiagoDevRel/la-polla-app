-- 021_debug_get_my_uid.sql — Helper for the auth.uid() diagnostic.
-- Returns auth.uid() as resolved inside Postgres for the calling session.
-- Used by /api/_debug/auth-uid. Safe to keep in prod; harmless if removed
-- after the bug is fixed.
CREATE OR REPLACE FUNCTION public.get_my_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$ SELECT auth.uid() $$;

GRANT EXECUTE ON FUNCTION public.get_my_uid() TO anon, authenticated;
