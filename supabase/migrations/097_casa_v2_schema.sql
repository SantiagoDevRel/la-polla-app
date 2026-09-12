-- Expand only. Apply 097-100 before publishing the v2 consumers. No activation,
-- historical rescore, deletion, or movement of money occurs in this migration.
ALTER TABLE public.casa_pollas
  ADD COLUMN IF NOT EXISTS settlement_outcome text
    CHECK (settlement_outcome IN ('money_awarded','object_awarded','house_retained_zero_points')),
  ADD COLUMN IF NOT EXISTS settlement_prize_cop bigint,
  ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS settled_chat_id bigint REFERENCES public.telegram_admins(chat_id);

ALTER TABLE public.casa_payouts
  ADD COLUMN IF NOT EXISTS prize_kind text NOT NULL DEFAULT 'pozo'
    CHECK (prize_kind IN ('pozo','objeto')),
  ADD COLUMN IF NOT EXISTS prize_object text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delivery_reference text;
ALTER TABLE public.casa_payouts ADD CONSTRAINT casa_payout_physical_consistency CHECK (
  (prize_kind = 'pozo' AND delivered_at IS NULL) OR
  (prize_kind = 'objeto' AND amount_cop = 0 AND paid_at IS NULL
    AND length(btrim(prize_object)) > 0 AND prize_object IS NOT NULL)
);

CREATE TABLE public.casa_operation_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','paused','v2')),
  object_draws_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.casa_operation_control(singleton) VALUES (true);

CREATE TABLE public.casa_entry_proof_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.casa_entries(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  request_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading','confirmed','failed','expired')),
  proof_path text NOT NULL UNIQUE,
  content_sha256 text CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_type text,
  content_bytes integer CHECK (content_bytes > 0 AND content_bytes <= 8388608),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
  confirmed_at timestamptz,
  failure_reason text,
  reviewed_at timestamptz,
  decision text CHECK (decision IN ('pagada','rechazada')),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_chat_id bigint REFERENCES public.telegram_admins(chat_id),
  review_reason text,
  UNIQUE(user_id, request_id),
  UNIQUE(entry_id,id),
  CHECK (state <> 'confirmed' OR confirmed_at IS NOT NULL),
  CHECK (decision IS NULL OR (state='confirmed' AND reviewed_at IS NOT NULL))
);
CREATE INDEX casa_proof_attempt_entry_idx ON public.casa_entry_proof_attempts(entry_id);
ALTER TABLE public.casa_entries ADD COLUMN IF NOT EXISTS current_proof_attempt_id uuid;
ALTER TABLE public.casa_entries ADD CONSTRAINT casa_entry_current_proof_fk
  FOREIGN KEY(id,current_proof_attempt_id) REFERENCES public.casa_entry_proof_attempts(entry_id,id);

CREATE TABLE public.casa_object_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  polla_id uuid NOT NULL UNIQUE REFERENCES public.casa_pollas(id),
  prize_object text NOT NULL CHECK(length(btrim(prize_object)) > 0),
  top_points integer NOT NULL CHECK(top_points > 0),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  winner_id uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id),
  resolved_chat_id bigint REFERENCES public.telegram_admins(chat_id),
  confirmation_id uuid,
  CHECK ((state='pending' AND winner_id IS NULL AND resolved_at IS NULL)
    OR (state='resolved' AND winner_id IS NOT NULL AND resolved_at IS NOT NULL AND confirmation_id IS NOT NULL))
);
CREATE TABLE public.casa_object_draw_candidates (
  draw_id uuid NOT NULL REFERENCES public.casa_object_draws(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  points integer NOT NULL CHECK(points > 0),
  ticket integer NOT NULL CHECK(ticket > 0),
  PRIMARY KEY(draw_id,user_id),
  UNIQUE(draw_id,ticket)
);
ALTER TABLE public.casa_object_draws ADD CONSTRAINT casa_draw_winner_candidate_fk
  FOREIGN KEY(id,winner_id) REFERENCES public.casa_object_draw_candidates(draw_id,user_id);

CREATE TABLE public.casa_draw_confirmation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES public.casa_object_draws(id),
  request_id uuid NOT NULL,
  superseded_by uuid REFERENCES public.casa_draw_confirmation_attempts(id) DEFERRABLE INITIALLY DEFERRED,
  winner_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','confirmed')),
  evidence_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK(content_type IN ('video/mp4','video/webm','video/quicktime')),
  content_bytes bigint NOT NULL CHECK(content_bytes > 0 AND content_bytes <= 52428800),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  UNIQUE(draw_id,id),
  FOREIGN KEY(draw_id,winner_id) REFERENCES public.casa_object_draw_candidates(draw_id,user_id)
);
CREATE UNIQUE INDEX casa_draw_request_current ON public.casa_draw_confirmation_attempts(request_id) WHERE superseded_by IS NULL;
ALTER TABLE public.casa_object_draws ADD CONSTRAINT casa_draw_confirmation_fk
  FOREIGN KEY(id,confirmation_id) REFERENCES public.casa_draw_confirmation_attempts(draw_id,id);

-- Server access only. auth.uid() NULL denies direct Data API reads; the
-- service_role endpoints must authenticate and enforce their own audience.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['casa_operation_control','casa_entry_proof_attempts',
    'casa_object_draws','casa_object_draw_candidates','casa_draw_confirmation_attempts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t || '_deny', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Evidence is private. Nothing is uploaded or made public by this migration.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('casa-draw-evidence','casa-draw-evidence',false,52428800,
  ARRAY['video/mp4','video/webm','video/quicktime']) ON CONFLICT(id) DO NOTHING;

CREATE FUNCTION public.casa_v2_context(p_contract integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m text;
BEGIN
  IF p_contract IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='UPDATE_REQUIRED', DETAIL='Actualiza la app antes de continuar.';
  END IF;
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton FOR SHARE;
  IF m IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='OPERATIONS_PAUSED', DETAIL='Estamos actualizando la app. Tu comprobante no quedó registrado; no repitas la transferencia.';
  END IF;
  PERFORM set_config('app.casa_contract','2',true);
END $$;

CREATE FUNCTION public.casa_v2_admin(p_actor_id uuid, p_chat_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (p_actor_id IS NULL) = (p_chat_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ADMIN_REQUIRED';
  END IF;
  IF p_actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=p_actor_id AND is_admin
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ADMIN_REQUIRED'; END IF;
  IF p_chat_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.telegram_admins WHERE chat_id=p_chat_id AND active
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ADMIN_REQUIRED'; END IF;
END $$;

CREATE FUNCTION public.casa_v2_lock_polla(p_polla_id uuid, p_allow_draw boolean DEFAULT false)
RETURNS public.casa_pollas LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POLLA_NOT_FOUND'; END IF;
  IF p.archived_at IS NOT NULL OR p.status IN ('resuelta','anulada') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POLLA_FINAL', DETAIL='Esta polla ya finalizó o se archivó.';
  END IF;
  IF NOT p_allow_draw AND EXISTS (SELECT 1 FROM public.casa_object_draws WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DRAW_PENDING', DETAIL='Los participantes del desempate ya están definidos.';
  END IF;
  RETURN p;
END $$;

CREATE FUNCTION public.casa_transition_mode(p_expected text,p_next text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m text;
BEGIN
  IF p_next NOT IN ('legacy','paused','v2') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
  PERFORM set_config('lock_timeout','3s',true);
  SELECT mode INTO m FROM public.casa_operation_control WHERE singleton FOR UPDATE;
  IF m=p_next THEN RETURN m; END IF;
  IF m IS DISTINCT FROM p_expected OR (m='v2' AND p_next='legacy') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MODE_CHANGED';
  END IF;
  IF p_next='legacy' AND EXISTS (SELECT 1 FROM public.casa_pollas WHERE settlement_outcome IS NOT NULL
    UNION ALL SELECT 1 FROM public.casa_object_draws) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='V2_ALREADY_USED';
  END IF;
  UPDATE public.casa_operation_control SET mode=p_next,updated_at=clock_timestamp() WHERE singleton;
  RETURN p_next;
END $$;

REVOKE ALL ON FUNCTION public.casa_v2_context(integer), public.casa_v2_admin(uuid,bigint),
  public.casa_v2_lock_polla(uuid,boolean), public.casa_transition_mode(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_v2_context(integer), public.casa_v2_admin(uuid,bigint),
  public.casa_v2_lock_polla(uuid,boolean), public.casa_transition_mode(text,text) TO service_role;
