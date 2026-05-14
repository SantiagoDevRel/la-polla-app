-- 058_normalize_whatsapp_number — guardar whatsapp_number en forma canónica
-- (solo dígitos, sin '+').
--
-- Bug: handle_new_auth_user() rellenaba whatsapp_number con
-- COALESCE(NEW.phone, ...). Para usuarios que se registran por SMS-OTP en la
-- web, NEW.phone llega como '+573117312391' (con el '+'). Pero el bot de
-- WhatsApp busca al usuario por whatsapp_number usando el wa_id que entrega
-- Meta, que viene SIN '+'. Resultado: esos usuarios nunca se encontraban,
-- el bot los trataba como desconocidos y los dejaba atrapados en el loop de
-- "escríbeme tu nombre".
--
-- lib/auth/phone.ts ya define la forma canónica (normalizePhone → solo
-- dígitos). El trigger ahora la respeta, y hacemos backfill de las filas
-- existentes que todavía tengan caracteres no numéricos.

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
    -- Forma canónica: solo dígitos (sin '+', espacios ni guiones), igual que
    -- normalizePhone() en lib/auth/phone.ts. Para usuarios email-only que no
    -- tienen phone, dejamos el email tal cual.
    CASE
      WHEN NEW.phone IS NOT NULL THEN regexp_replace(NEW.phone, '\D', '', 'g')
      ELSE COALESCE(NEW.email, '')
    END,
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    whatsapp_verified = CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END;
  RETURN NEW;
END;
$function$;

-- Backfill: normalizar filas existentes con '+' u otros caracteres no
-- numéricos. Solo tocamos las que son claramente un teléfono (8-15 dígitos)
-- y solo si la forma normalizada no choca con otra fila (la columna tiene
-- UNIQUE) — defense-in-depth aunque hoy no haya colisiones.
UPDATE public.users u
SET whatsapp_number = regexp_replace(u.whatsapp_number, '\D', '', 'g')
WHERE u.whatsapp_number ~ '[^0-9]'
  AND u.whatsapp_number ~ '^\+?[0-9]{8,15}$'
  AND NOT EXISTS (
    SELECT 1 FROM public.users u2
    WHERE u2.id <> u.id
      AND u2.whatsapp_number = regexp_replace(u.whatsapp_number, '\D', '', 'g')
  );
