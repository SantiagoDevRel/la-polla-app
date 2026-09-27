-- Owner confirmed on 2026-09-27 that registration terms include marketing
-- consent. This records that attestation, not an invented individual ALTA.
-- Existing decisions (especially BAJA) always win. No campaigns are enabled.
CREATE FUNCTION public.wa_import_registration_consent(p_phone text, p_verified boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g'); v_count integer;
BEGIN
  IF p_verified IS DISTINCT FROM true OR v_phone IS NULL OR v_phone !~ '^573[0-9]{9}$' THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-consent:' || v_phone, 0));
  INSERT INTO public.wa_marketing_preferences(phone, enabled, source, changed_at, last_event_id)
  SELECT v_phone, true, 'legacy', clock_timestamp(), 'terms-owner-confirmed:20260927:' || v_phone
  WHERE NOT EXISTS (SELECT 1 FROM public.wa_avisos_opt_out WHERE phone = v_phone)
  ON CONFLICT (phone) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_import_registration_consent(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_import_registration_consent(text,boolean) TO service_role;

CREATE FUNCTION public.wa_registration_consent_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- A client-editable profile phone is not proof of ownership. Check Auth too.
  IF NEW.whatsapp_verified IS TRUE AND EXISTS (
    SELECT 1 FROM auth.users a WHERE a.id = NEW.id AND a.phone_confirmed_at IS NOT NULL
      AND regexp_replace(a.phone, '[^0-9]', '', 'g') = regexp_replace(NEW.whatsapp_number, '[^0-9]', '', 'g')
  ) THEN
    PERFORM public.wa_import_registration_consent(NEW.whatsapp_number, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_registration_consent_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_registration_consent_trigger() TO service_role;
CREATE TRIGGER wa_registration_consent
AFTER INSERT OR UPDATE OF whatsapp_number, whatsapp_verified ON public.users
FOR EACH ROW EXECUTE FUNCTION public.wa_registration_consent_trigger();

-- Import existing verified Colombian mobiles; never overwrite an explicit choice.
SELECT public.wa_import_registration_consent(whatsapp_number, whatsapp_verified)
FROM public.users
WHERE whatsapp_verified IS TRUE
  AND regexp_replace(whatsapp_number, '[^0-9]', '', 'g') ~ '^573[0-9]{9}$';
