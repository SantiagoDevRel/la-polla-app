-- 047_user_name_required — Forzar que todos los users tengan un nombre
-- real (no su numero de telefono).
--
-- Antes el trigger handle_new_auth_user() rellenaba display_name con
-- el phone si no venia metadata. Como el bot crea users via
-- supabase.auth.admin.createUser SIN pasar metadata.display_name (porque
-- el nombre lo pide despues por chat), esos usuarios quedaban con
-- display_name="573114685089" y aparecian asi en pollas y leaderboards.
--
-- Fix: trigger ya no fallback al phone — si no viene metadata, deja
-- display_name=NULL. El layout (app)/layout.tsx detecta NULL via
-- needsName() y redirige a /onboarding antes de mostrar cualquier UI
-- autenticada. El bot ya hacia este gate via userNeedsOnboarding.
--
-- Backfill: usuarios actuales con nombre que es phone → NULL para que
-- entren al onboarding la proxima vez que abran la app.

ALTER TABLE public.users ALTER COLUMN display_name DROP NOT NULL;

UPDATE users
SET display_name = NULL
WHERE display_name IS NOT NULL
  AND (
    display_name = whatsapp_number
    OR display_name = '+' || whatsapp_number
    OR display_name ~ '^\+?\d{8,15}$'
  );

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.users (id, whatsapp_number, whatsapp_verified, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, NEW.email, ''),
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    whatsapp_verified = CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END;
  RETURN NEW;
END;
$function$;
