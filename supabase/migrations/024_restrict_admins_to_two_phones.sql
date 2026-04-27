-- 024_restrict_admins_to_two_phones.sql
-- Lock down admin access to exactly two phone numbers:
--   +57 311 731 2391  → 573117312391
--   +351 934 255 581  → 351934255581
-- Anyone else flagged as admin gets demoted. Idempotent — safe to re-run.
-- Run after 005_add_is_admin (which created the column and seeded the
-- same two numbers).

UPDATE public.users
   SET is_admin = true
 WHERE whatsapp_number IN ('573117312391', '351934255581')
   AND is_admin IS DISTINCT FROM true;

UPDATE public.users
   SET is_admin = false
 WHERE whatsapp_number NOT IN ('573117312391', '351934255581')
   AND is_admin IS DISTINCT FROM false;
