-- Quentro destination supplied by the participant, separate from login/profile.
-- This migration creates storage only. It does not enroll users or award prizes.
CREATE TABLE public.casa_prize_contacts (
  polla_id uuid NOT NULL REFERENCES public.casa_pollas(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email !~ '[[:space:]]' AND email ~ '^[^@]+@[^@]+\.[^@]+$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (polla_id, user_id)
);
ALTER TABLE public.casa_prize_contacts ENABLE ROW LEVEL SECURITY;
-- Supabase installations may have default grants; close all inherited access.
REVOKE ALL ON public.casa_prize_contacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.casa_prize_contacts TO authenticated, service_role;
CREATE POLICY casa_prize_contacts_own_read ON public.casa_prize_contacts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.casa_save_prize_contact(
  p_polla_id uuid, p_user_id uuid, p_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.casa_pollas; e text := btrim(p_email); award public.casa_payouts;
BEGIN
  -- The service-only caller must derive p_user_id from the validated session.
  IF p_polla_id IS DISTINCT FROM '85b88f91-7680-4241-9bf5-b37614cb520b'::uuid THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PRIZE_CONTACT_NOT_AVAILABLE';
  END IF;
  IF e IS NULL OR char_length(e) NOT BETWEEN 3 AND 254 OR e ~ '[[:space:]]'
    OR e !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='INVALID_PRIZE_EMAIL';
  END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR SHARE;
  IF NOT FOUND OR p.prize_kind<>'objeto' OR p.status NOT IN ('abierta','cerrada','resuelta')
    OR p.archived_at IS NOT NULL OR p.publication_mode='oculta' OR p.opens_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='PRIZE_CONTACT_NOT_AVAILABLE';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.casa_entries
    WHERE polla_id=p_polla_id AND user_id=p_user_id AND status='pagada') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='PRIZE_PARTICIPANT_REQUIRED';
  END IF;
  SELECT * INTO award FROM public.casa_payouts
    WHERE polla_id=p_polla_id AND user_id=p_user_id AND prize_kind='objeto' FOR SHARE;
  IF p.status='resuelta' AND award.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='PRIZE_WINNER_REQUIRED';
  END IF;
  IF award.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='PRIZE_ALREADY_DELIVERED';
  END IF;
  INSERT INTO public.casa_prize_contacts(polla_id,user_id,email)
    VALUES(p_polla_id,p_user_id,e)
    ON CONFLICT(polla_id,user_id) DO UPDATE SET email=EXCLUDED.email,updated_at=clock_timestamp();
  RETURN jsonb_build_object('email',e,'winner',award.id IS NOT NULL,'editable',true);
END $$;
REVOKE ALL ON FUNCTION public.casa_save_prize_contact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_save_prize_contact(uuid,uuid,text) TO service_role;
COMMENT ON TABLE public.casa_prize_contacts IS
  'Participant-supplied Quentro delivery email. Private; never publish with standings or public payouts. Not a verified login address.';
