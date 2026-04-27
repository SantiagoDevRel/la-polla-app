-- 026_find_auth_user_by_phone.sql
--
-- Authoritative lookup helper for the dual SMS+WhatsApp login flow.
-- Resolves any reasonable phone format to a single auth.users.id,
-- so signing in via SMS and via WhatsApp magic link always reaches
-- the SAME row — never a duplicate account.
--
-- Why a SECURITY DEFINER function:
--   The auth schema isn't exposed via PostgREST, so a service-role
--   client can't `from("auth.users")` directly. Wrapping the SELECT
--   in a function keeps the cross-schema query inside Postgres and
--   exposes only the resulting id, gated to service_role.
--
-- Match strategy: strip the input to digits, then try three storage
-- shapes Supabase or our trigger can produce:
--   • phone = "351934255581"          (Supabase strips the +)
--   • phone = "+351934255581"         (defensive — if Supabase ever
--                                      stores E.164 with the +)
--   • email = "351934255581@wa.lapolla.app"
--                                     (set by /api/auth/wa-magic when
--                                      it mints sessions for SMS-only
--                                      accounts)
--
-- The unique indexes on auth.users.phone and auth.users.email already
-- prevent storage-level dupes; this just makes our reads find the row
-- before we try to create a new one.

CREATE OR REPLACE FUNCTION public.find_auth_user_id_by_phone(p_phone text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  WITH normalized AS (
    SELECT REGEXP_REPLACE(COALESCE(p_phone, ''), '\D', '', 'g') AS digits
  )
  SELECT id
    FROM auth.users, normalized
   WHERE digits <> ''
     AND (
          phone = digits
       OR phone = '+' || digits
       OR email = digits || '@wa.lapolla.app'
     )
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.find_auth_user_id_by_phone(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_id_by_phone(text) TO service_role;

COMMENT ON FUNCTION public.find_auth_user_id_by_phone(text) IS
  'Service-role only. Resolves a phone (any reasonable format) to its
   auth.users.id, matching whether the phone was registered via SMS
   (auth.users.phone) or WhatsApp magic link (auth.users.email
   pattern). Used by /api/auth/wa-magic to dedupe across channels.';
