-- 145_login_facebook_identity.sql — Una cuenta puede nacer SIN teléfono.
--
-- ⚠️ 2026-09-20: el login con Facebook se RETIRÓ el mismo día (decisión del
-- dueño). Esta migración NO se revierte y el archivo se queda: ya está
-- aplicada en producción, y borrarlo dejaría el repo mintiendo sobre el
-- estado real de la base. Devolver la columna a NOT NULL sería un cambio
-- destructivo de esquema y no se hace sin una orden explícita.
--
-- Lo que deja vivo: `users.whatsapp_number` acepta NULL y el trigger ya no
-- mete el correo en esa columna. Ninguna cuenta actual quedó sin número.
--
-- Hasta hoy la identidad de La Polla era el teléfono, sin excepción: 440
-- cuentas, ninguna sin número. `users.whatsapp_number` es NOT NULL UNIQUE y
-- el trigger `handle_new_auth_user` (migración 058) rellenaba esa columna con
-- COALESCE(NEW.email, '') cuando `auth.users.phone` venía vacío.
--
-- Eso hace IMPOSIBLE el alta por un proveedor externo (Facebook), y falla de
-- la peor manera — en la base, no en el código:
--   • un correo real (p. ej. 33 caracteres) no cabe en varchar(20) → 22001,
--     el trigger revienta y el INSERT en auth.users se cae con él;
--   • y si cupiera, la segunda cuenta sin teléfono chocaría contra el UNIQUE
--     porque ambas escribirían la misma cadena vacía.
--
-- Esta migración deja que la columna sea NULL («esta persona todavía no dio
-- su número») y saca el correo de ahí. Postgres admite varios NULL bajo un
-- UNIQUE, así que el índice sigue protegiendo los números de verdad.
--
-- Lo que NO hace, a propósito:
--   • no toca una sola fila existente (las 440 conservan su número);
--   • no fusiona cuentas. Si alguien entra por Facebook y además tiene cuenta
--     por SMS, quedan DOS cuentas del mismo humano. Con plata de por medio esa
--     fusión se decide aparte, no se adivina acá;
--   • no afecta el cruce de comprobantes: quien no tiene número sigue sin
--     tenerlo, y el panel lo muestra vacío en vez de inventarlo.

-- 1) El número deja de ser obligatorio. Relajar un NOT NULL no reescribe la
--    tabla ni pierde datos; el UNIQUE se mantiene igual.
ALTER TABLE public.users ALTER COLUMN whatsapp_number DROP NOT NULL;

-- 2) El trigger: sin teléfono ahora escribe NULL (nunca el correo). El nombre
--    visible también acepta lo que mandan los proveedores OAuth
--    (`full_name` / `name`), así quien entra por Facebook ya llega con su
--    nombre y el onboarding solo le pide el pollito.
--
--    Verificado contra producción antes de reemplazar: md5(prosrc) de la
--    función viva == la definición de la migración 058 (sin drift).
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
    -- Forma canónica: solo dígitos (igual que normalizePhone() en
    -- lib/auth/phone.ts). Sin teléfono → NULL, nunca el correo.
    CASE
      WHEN NEW.phone IS NOT NULL THEN regexp_replace(NEW.phone, '\D', '', 'g')
      ELSE NULL
    END,
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END,
    NULLIF(
      btrim(
        COALESCE(
          NEW.raw_user_meta_data->>'display_name',
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          ''
        )
      ),
      ''
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    whatsapp_verified = CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END;
  RETURN NEW;
END;
$function$;
