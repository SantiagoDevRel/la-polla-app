-- LOCAL ONLY. In production the 14-argument overload from 027 was dropped by
-- hand when 032 added the abbreviation parameters; without this, 045's
-- COMMENT ON FUNCTION upsert_match_safe is ambiguous.
DROP FUNCTION IF EXISTS public.upsert_match_safe(text,text,integer,text,text,text,text,text,timestamptz,text,integer,integer,text,integer);
