-- Backfill: insertar en public.users todos los usuarios que ya existen
-- en auth.users pero no tienen fila en public.users
-- Ejecutar UNA SOLA VEZ después de aplicar el trigger 003_auth_user_sync.sql

INSERT INTO public.users (id, whatsapp_number, whatsapp_verified, display_name)
SELECT
  au.id,
  COALESCE(au.phone, au.email, ''),
  CASE WHEN au.phone IS NOT NULL THEN true ELSE false END,
  COALESCE(
    au.raw_user_meta_data->>'display_name',
    REPLACE(COALESCE(au.phone, au.email, 'Usuario'), '+', '')
  )
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL;
