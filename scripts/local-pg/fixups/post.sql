-- LOCAL ONLY. Columns production has but no migration records, applied after
-- the whole chain. lib/auth/admin.ts selects users.avatar_emoji (legacy
-- emoji avatar, before pollitos); without it PostgREST answers 400 and every
-- admin page redirects locally.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_emoji text;
