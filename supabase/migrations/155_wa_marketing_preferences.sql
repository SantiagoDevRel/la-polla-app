-- Explicit consent, separate from login. No account/prediction data is changed.
CREATE TABLE public.wa_marketing_preferences (
  phone text PRIMARY KEY CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  enabled boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('whatsapp', 'profile', 'legacy')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  last_event_id text NOT NULL
);
CREATE TABLE public.wa_marketing_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 200),
  phone text NOT NULL CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  enabled boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('whatsapp', 'profile')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  reply_sent boolean NOT NULL DEFAULT false
);
ALTER TABLE public.wa_marketing_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_marketing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_marketing_preferences, public.wa_marketing_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wa_marketing_preferences, public.wa_marketing_events TO service_role;
CREATE POLICY wa_marketing_preferences_private ON public.wa_marketing_preferences FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY wa_marketing_events_private ON public.wa_marketing_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE INDEX wa_marketing_audience ON public.wa_marketing_preferences (enabled, changed_at DESC, phone);

-- Preserve existing opt-outs; absence is never consent. Keep the old table intact.
INSERT INTO public.wa_marketing_preferences (phone, enabled, source, changed_at, last_event_id)
SELECT phone, false, 'legacy', created_at, 'legacy:' || phone
FROM public.wa_avisos_opt_out WHERE phone ~ '^[1-9][0-9]{7,14}$';

CREATE FUNCTION public.wa_set_marketing_preference(
  p_phone text, p_enabled boolean, p_source text, p_event_id text,
  p_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_at timestamptz; v_event public.wa_marketing_events; v_current public.wa_marketing_preferences;
BEGIN
  IF p_phone !~ '^[1-9][0-9]{7,14}$' OR p_phone IS NULL OR p_enabled IS NULL
     OR p_source NOT IN ('whatsapp', 'profile') OR p_source IS NULL
     OR p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid preference input';
  END IF;
  v_at := CASE WHEN p_source = 'profile' THEN clock_timestamp() ELSE p_occurred_at END;
  IF v_at IS NULL OR v_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid event time';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-consent:' || p_phone, 0));
  INSERT INTO public.wa_marketing_events(event_id, phone, enabled, source, occurred_at)
  VALUES(p_event_id, p_phone, p_enabled, p_source, v_at) ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO v_event FROM public.wa_marketing_events WHERE event_id = p_event_id;
  IF v_event.phone <> p_phone OR v_event.enabled <> p_enabled OR v_event.source <> p_source THEN
    RAISE EXCEPTION 'Event identity conflict';
  END IF;
  -- Use the persisted time on retries, not the retry's arrival time.
  INSERT INTO public.wa_marketing_preferences(phone, enabled, source, changed_at, last_event_id)
  VALUES(p_phone, p_enabled, p_source, v_event.occurred_at, p_event_id)
  ON CONFLICT(phone) DO UPDATE SET enabled = EXCLUDED.enabled, source = EXCLUDED.source,
    changed_at = EXCLUDED.changed_at, last_event_id = EXCLUDED.last_event_id
  WHERE EXCLUDED.changed_at > wa_marketing_preferences.changed_at
    OR (EXCLUDED.changed_at = wa_marketing_preferences.changed_at
        AND NOT EXCLUDED.enabled AND wa_marketing_preferences.enabled);
  SELECT * INTO v_current FROM public.wa_marketing_preferences WHERE phone = p_phone;
  RETURN jsonb_build_object('enabled', v_current.enabled,
    'current', v_current.last_event_id = p_event_id, 'replySent', v_event.reply_sent);
END;
$$;
REVOKE ALL ON FUNCTION public.wa_set_marketing_preference(text,boolean,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_set_marketing_preference(text,boolean,text,text,timestamptz) TO service_role;
