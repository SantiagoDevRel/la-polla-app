-- LOCAL ONLY. `notifications` and its enum were created from the Supabase
-- dashboard before the repo tracked migrations; 017 only adds a value.
DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM ('match_result','prediction_reminder','polla_invite','payment','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title text,
  body text,
  polla_id uuid,
  match_id uuid,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
