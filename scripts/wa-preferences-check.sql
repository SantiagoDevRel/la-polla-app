-- Run in a transaction and ROLLBACK. Does not send messages or touch users.
DO $$
DECLARE p text := '999999999999999'; t timestamptz := now() - interval '1 hour'; result jsonb;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.wa_marketing_preferences WHERE phone=p), 'Test identity must be unused';
  result := public.wa_set_marketing_preference(p, true, 'whatsapp', 'test-wa-1', t);
  ASSERT (result->>'enabled')::boolean;
  result := public.wa_set_marketing_preference(p, false, 'whatsapp', 'test-wa-2', t + interval '1 minute');
  ASSERT NOT (result->>'enabled')::boolean;
  -- Retrying the original ALTA cannot undo a newer BAJA.
  result := public.wa_set_marketing_preference(p, true, 'whatsapp', 'test-wa-1', t + interval '2 minutes');
  ASSERT NOT (result->>'enabled')::boolean;
  ASSERT NOT (result->>'current')::boolean;
  -- Distinct out-of-order ALTA also cannot undo BAJA.
  result := public.wa_set_marketing_preference(p, true, 'whatsapp', 'test-wa-3', t);
  ASSERT NOT (result->>'enabled')::boolean;
  -- WhatsApp timestamps have seconds precision: ties fail safe to BAJA.
  result := public.wa_set_marketing_preference(p, true, 'whatsapp', 'test-wa-4', t + interval '1 minute');
  ASSERT NOT (result->>'enabled')::boolean;
  result := public.wa_set_marketing_preference(p, true, 'profile', 'test-wa-5');
  ASSERT (result->>'enabled')::boolean;
  result := public.wa_set_marketing_preference(p, false, 'profile', 'test-wa-6');
  ASSERT NOT (result->>'enabled')::boolean;
  ASSERT (SELECT count(*) FROM public.wa_marketing_events WHERE phone=p) = 6;
  ASSERT NOT has_function_privilege('anon', 'public.wa_set_marketing_preference(text,boolean,text,text,timestamptz)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.wa_set_marketing_preference(text,boolean,text,text,timestamptz)', 'EXECUTE');
  ASSERT NOT has_table_privilege('anon', 'public.wa_marketing_preferences', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.wa_marketing_preferences', 'UPDATE');
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.wa_marketing_preferences'::regclass);
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.wa_marketing_events'::regclass);
END $$;
