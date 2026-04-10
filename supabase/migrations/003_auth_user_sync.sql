-- Trigger que crea automáticamente una fila en public.users
-- cada vez que un usuario nuevo se autentica vía Supabase Auth (WhatsApp OTP)
-- Esto sincroniza auth.users con public.users para mantener la FK válida

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, whatsapp_number, whatsapp_verified, display_name)
  VALUES (
    NEW.id,
    -- El phone viene como +573117312391, lo guardamos tal cual
    COALESCE(NEW.phone, NEW.email, ''),
    -- Si se autenticó por phone, whatsapp_verified = true
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END,
    -- display_name por defecto: el número sin el +, se puede cambiar después
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      REPLACE(COALESCE(NEW.phone, NEW.email, 'Usuario'), '+', '')
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    whatsapp_verified = CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger anterior si existe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Crear trigger que se ejecuta al insertar en auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
