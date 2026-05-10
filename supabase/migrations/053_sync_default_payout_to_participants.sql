-- 053_sync_default_payout_to_participants.sql
--
-- Decisión 2026-05-09: la cuenta de cobro vive en el PERFIL del user
-- (users.default_payout_*), no por-polla. Si un user cambia su cuenta
-- en perfil, debe verse en TODAS las pollas donde participa,
-- automáticamente. Si gana una nueva polla, también debe pre-llenar.
--
-- En vez de tocar 5+ endpoints lectores, hacemos un trigger DB que
-- mantiene polla_participants.payout_* sincronizado con
-- users.default_payout_*. Las columnas por-polla se quedan como mirror
-- read-only del perfil — los lectores existentes siguen funcionando
-- sin cambios y leen el valor correcto.
--
-- Triggers:
-- 1. AFTER UPDATE ON users — cuando default_payout_* cambia, replicar
--    a polla_participants del user.
-- 2. BEFORE INSERT ON polla_participants — pre-llenar payout_* desde
--    users.default_payout_* si están vacíos en el row entrante.

-- Trigger 1: user actualiza su perfil → propagar a todos sus participants.
CREATE OR REPLACE FUNCTION public.sync_user_default_payout_to_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.default_payout_method IS DISTINCT FROM OLD.default_payout_method
     OR NEW.default_payout_account IS DISTINCT FROM OLD.default_payout_account
     OR NEW.default_payout_account_name IS DISTINCT FROM OLD.default_payout_account_name THEN
    UPDATE polla_participants
    SET payout_method = NEW.default_payout_method,
        payout_account = NEW.default_payout_account,
        payout_account_name = NEW.default_payout_account_name,
        payout_set_at = COALESCE(payout_set_at, NEW.default_payout_set_at, now())
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_default_payout ON users;
CREATE TRIGGER trg_sync_user_default_payout
  AFTER UPDATE OF
    default_payout_method,
    default_payout_account,
    default_payout_account_name
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_default_payout_to_participants();

-- Trigger 2: nuevo participant → pre-llenar desde users.default_payout_*.
CREATE OR REPLACE FUNCTION public.fill_participant_payout_from_user_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
BEGIN
  IF NEW.payout_account IS NULL THEN
    SELECT default_payout_method,
           default_payout_account,
           default_payout_account_name,
           default_payout_set_at
    INTO v_user
    FROM users
    WHERE id = NEW.user_id;
    IF FOUND AND v_user.default_payout_account IS NOT NULL THEN
      NEW.payout_method := v_user.default_payout_method;
      NEW.payout_account := v_user.default_payout_account;
      NEW.payout_account_name := v_user.default_payout_account_name;
      NEW.payout_set_at := COALESCE(NEW.payout_set_at, v_user.default_payout_set_at);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_participant_payout ON polla_participants;
CREATE TRIGGER trg_fill_participant_payout
  BEFORE INSERT ON polla_participants
  FOR EACH ROW
  EXECUTE FUNCTION fill_participant_payout_from_user_default();
