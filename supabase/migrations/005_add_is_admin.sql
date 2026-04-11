-- 005_add_is_admin.sql — Add is_admin flag for role-based access control
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Set the two known admin users
UPDATE public.users
  SET is_admin = true
  WHERE whatsapp_number IN ('573117312391', '351934255581');
