-- Owner-only SMS campaigns. No writes to users, predictions or existing SMS/OTP tables.
CREATE TABLE public.sms_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  polla_id uuid NOT NULL REFERENCES public.casa_pollas(id),
  template text NOT NULL CHECK (template IN ('opening','closing')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 1500),
  scheduled_at timestamptz,
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','dispatching','scheduled','accepted','rejected','unknown')),
  subid text NOT NULL UNIQUE CHECK (length(subid) <= 20),
  fingerprint text NOT NULL,
  audience jsonb NOT NULL,
  recipient_count integer NOT NULL CHECK (recipient_count BETWEEN 1 AND 10000),
  segments integer NOT NULL CHECK (segments BETWEEN 1 AND 10),
  credits numeric NOT NULL CHECK (credits > 0),
  provider_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  dispatched_at timestamptz,
  acknowledged_at timestamptz
);
CREATE UNIQUE INDEX sms_campaigns_no_duplicate ON public.sms_campaigns(fingerprint)
  WHERE state IN ('dispatching','scheduled','accepted','unknown');
CREATE INDEX sms_campaigns_owner_history ON public.sms_campaigns(created_by,created_at DESC);

CREATE TABLE public.sms_campaign_recipients (
  campaign_id uuid NOT NULL REFERENCES public.sms_campaigns(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  phone text NOT NULL CHECK (phone ~ '^\+[0-9]{8,15}$'),
  country text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','failed')),
  acknowledged_at timestamptz,
  PRIMARY KEY(campaign_id,phone)
);
CREATE TABLE public.sms_marketing_suppressions (
  phone text PRIMARY KEY CHECK (phone ~ '^\+[0-9]{8,15}$'),
  reason text NOT NULL DEFAULT 'Solicitud de baja',
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_marketing_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_campaigns, public.sms_campaign_recipients, public.sms_marketing_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sms_campaigns, public.sms_campaign_recipients, public.sms_marketing_suppressions TO service_role;
CREATE POLICY sms_campaigns_deny_all ON public.sms_campaigns FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
CREATE POLICY sms_campaign_recipients_deny_all ON public.sms_campaign_recipients FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
CREATE POLICY sms_marketing_suppressions_deny_all ON public.sms_marketing_suppressions FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);

-- Claim BEFORE the external POST. A crash or timeout must NEVER cause a retry.
-- Serializes campaigns to protect login credit reserve from simultaneous sends.
CREATE OR REPLACE FUNCTION public.claim_sms_campaign(p_id uuid, p_owner uuid, p_balance numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE campaign public.sms_campaigns; reserved numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sms_campaign_dispatch'));
  SELECT * INTO campaign FROM public.sms_campaigns WHERE id=p_id AND created_by=p_owner FOR UPDATE;
  IF NOT FOUND OR campaign.state <> 'ready' OR campaign.expires_at < now() THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_owner AND is_admin) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.sms_campaign_recipients WHERE campaign_id=p_id) <> campaign.recipient_count THEN
    RAISE EXCEPTION 'La lista de destinatarios está incompleta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sms_campaign_recipients r JOIN public.sms_marketing_suppressions s ON s.phone=r.phone WHERE r.campaign_id=p_id) THEN
    RAISE EXCEPTION 'Hay nuevas bajas. Revisa los destinatarios nuevamente.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sms_campaigns WHERE state IN ('dispatching','unknown')) THEN
    RAISE EXCEPTION 'Hay un envío pendiente de conciliación. Revísalo antes de enviar otro.';
  END IF;
  SELECT COALESCE(sum(credits),0) INTO reserved FROM public.sms_campaigns WHERE state='scheduled' AND scheduled_at > now();
  IF p_balance IS NULL OR p_balance < campaign.credits + reserved + 10 THEN
    RAISE EXCEPTION 'Saldo insuficiente: se reservan créditos para programados y códigos de acceso.';
  END IF;
  UPDATE public.sms_campaigns SET state='dispatching',dispatched_at=now() WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_sms_campaign(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_campaign(uuid,uuid,numeric) TO service_role;

-- Campaign callbacks never enter the OTP watchdog. Delivered is terminal.
CREATE FUNCTION public.ack_sms_campaign(p_subid text,p_phone text,p_delivered boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE public.sms_campaign_recipients r
  SET state=CASE WHEN p_delivered THEN 'delivered' ELSE 'failed' END, acknowledged_at=now()
  FROM public.sms_campaigns c
  WHERE c.subid=p_subid AND r.campaign_id=c.id AND r.phone=p_phone
    AND r.state <> 'delivered';
$$;
REVOKE ALL ON FUNCTION public.ack_sms_campaign(text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ack_sms_campaign(text,text,boolean) TO service_role;

CREATE FUNCTION public.sms_campaign_history(p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(item) ORDER BY item.created_at DESC),'[]'::jsonb)
  FROM (
    SELECT c.id,c.message,c.state,c.scheduled_at,c.created_at,c.recipient_count,c.credits,c.subid,
      (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id=c.id AND r.state='delivered') AS delivered,
      (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id=c.id AND r.state='failed') AS failed
    FROM public.sms_campaigns c WHERE c.created_by=p_owner AND c.state<>'ready'
    ORDER BY c.created_at DESC LIMIT 20
  ) item;
$$;
REVOKE ALL ON FUNCTION public.sms_campaign_history(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_campaign_history(uuid) TO service_role;
