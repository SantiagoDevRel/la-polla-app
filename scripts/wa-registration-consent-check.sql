-- Run within BEGIN/ROLLBACK. Synthetic identities only; no users are changed.
DO $$
DECLARE p text; other text := '999999999999998'; result jsonb;
BEGIN
  SELECT (573999990000 + n)::text INTO p FROM generate_series(0,99) n
  WHERE NOT EXISTS (SELECT 1 FROM public.wa_marketing_preferences WHERE phone=(573999990000+n)::text)
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE regexp_replace(whatsapp_number,'[^0-9]','','g')=(573999990000+n)::text)
  LIMIT 1;
  ASSERT p IS NOT NULL;
  ASSERT NOT EXISTS (SELECT 1 FROM public.wa_marketing_preferences WHERE phone IN (p,other)), 'Test phones must be unused';
  ASSERT NOT public.wa_import_registration_consent(other, true), 'Non-Colombian phones stay unchanged';
  ASSERT NOT public.wa_import_registration_consent(p, false), 'Unverified phone cannot subscribe';
  ASSERT NOT public.wa_import_registration_consent(NULL, true);
  ASSERT NOT public.wa_import_registration_consent('571234', true);
  ASSERT public.wa_import_registration_consent('+' || p, true);
  ASSERT (SELECT enabled AND source='legacy' AND last_event_id LIKE 'terms-owner-confirmed:%' FROM public.wa_marketing_preferences WHERE phone=p);
  ASSERT NOT public.wa_import_registration_consent(p, true), 'Import is idempotent';
  result := public.wa_set_marketing_preference(p, false, 'profile', 'test-registration-baja');
  ASSERT NOT (result->>'enabled')::boolean;
  ASSERT NOT public.wa_import_registration_consent(p, true), 'Login/import cannot reactivate BAJA';
  ASSERT NOT (SELECT enabled FROM public.wa_marketing_preferences WHERE phone=p);
  ASSERT NOT EXISTS (SELECT 1 FROM public.wa_marketing_preferences WHERE phone=other);
  ASSERT NOT has_function_privilege('anon','public.wa_import_registration_consent(text,boolean)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.wa_import_registration_consent(text,boolean)','EXECUTE');
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='wa_registration_consent' AND tgenabled='O');
END $$;
