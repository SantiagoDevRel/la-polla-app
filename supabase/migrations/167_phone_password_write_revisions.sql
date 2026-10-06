-- Append metadata only. Existing PIN salts/hashes and sessions remain intact.
ALTER TABLE public.phone_password_credentials
  ADD COLUMN credential_revision bigint NOT NULL DEFAULT 0 CHECK(credential_revision>=0),
  ADD COLUMN last_request_id uuid,
  ADD COLUMN last_expected_revision bigint;

CREATE FUNCTION public.phone_password_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_value text:=nullif(current_setting('app.phone_password_request',true),'');
  expected_value text:=nullif(current_setting('app.phone_password_expected',true),'');
BEGIN
  IF request_value IS NULL AND expected_value IS NULL THEN
    -- Narrow rolling-deploy compatibility: an unfenced old route can operate
    -- only until this owner has their first versioned write. Every old write
    -- still advances the revision, so a new stale request cannot overwrite it.
    IF TG_OP='UPDATE' AND OLD.last_request_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PASSWORD_VERSION_REQUIRED';
    END IF;
    NEW.last_request_id:=NULL;
    NEW.last_expected_revision:=NULL;
  ELSIF request_value IS NULL OR expected_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PASSWORD_VERSION_REQUIRED';
  ELSE
    NEW.last_request_id:=request_value::uuid;
    NEW.last_expected_revision:=expected_value::bigint;
  END IF;
  NEW.credential_revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.credential_revision+1 END;
  RETURN NEW;
END $$;
CREATE TRIGGER phone_password_revision BEFORE INSERT OR UPDATE ON public.phone_password_credentials
  FOR EACH ROW EXECUTE FUNCTION public.phone_password_revision_guard();
REVOKE ALL ON FUNCTION public.phone_password_revision_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phone_password_revision_guard() TO service_role;

CREATE FUNCTION public.phone_password_save_v1(p_user_id uuid,p_phone_number text,
  p_request_id uuid,p_expected_revision bigint,p_salt text,p_password_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
SET lock_timeout='2s' SET statement_timeout='10s' AS $$
DECLARE stored record; current_revision bigint:=0;
  prior_request text; prior_expected text;
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL
    OR p_expected_revision<0 OR p_expected_revision>9007199254740991
    OR p_phone_number IS NULL OR p_phone_number !~ '^[1-9][0-9]{7,14}$'
    OR p_salt IS NULL OR p_salt !~ '^[a-f0-9]{32}$'
    OR p_password_hash IS NULL OR p_password_hash !~ '^[a-f0-9]{128}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PASSWORD_REQUEST';
  END IF;
  -- Serialize missing-row creation as well as updates for this verified owner.
  PERFORM pg_advisory_xact_lock(hashtextextended('phone-password:'||p_user_id::text,0));
  -- Recheck identity inside the transaction: Auth may have changed the phone
  -- after the route validated the session. Lock prevents a concurrent change.
  PERFORM 1 FROM auth.users WHERE id=p_user_id AND phone_confirmed_at IS NOT NULL
    AND regexp_replace(phone,'[^0-9]','','g')=p_phone_number FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PASSWORD_OWNER_CHANGED';
  END IF;
  SELECT phone_number,salt,password_hash,credential_revision,last_request_id,last_expected_revision
    INTO stored FROM public.phone_password_credentials WHERE user_id=p_user_id FOR UPDATE;
  IF FOUND THEN
    current_revision:=stored.credential_revision;
    IF stored.last_request_id=p_request_id THEN
      IF stored.phone_number IS DISTINCT FROM p_phone_number OR stored.salt IS DISTINCT FROM p_salt
        OR stored.password_hash IS DISTINCT FROM p_password_hash
        OR stored.last_expected_revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PASSWORD_REQUEST_REUSED';
      END IF;
      RETURN jsonb_build_object('ok',true,'user_id',p_user_id,'request_id',p_request_id,'revision',current_revision);
    END IF;
  END IF;
  IF current_revision<>p_expected_revision THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'revision',current_revision);
  END IF;
  prior_request:=current_setting('app.phone_password_request',true);
  prior_expected:=current_setting('app.phone_password_expected',true);
  PERFORM set_config('app.phone_password_request',p_request_id::text,true);
  PERFORM set_config('app.phone_password_expected',p_expected_revision::text,true);
  INSERT INTO public.phone_password_credentials(user_id,phone_number,salt,password_hash,updated_at)
    VALUES(p_user_id,p_phone_number,p_salt,p_password_hash,clock_timestamp())
    ON CONFLICT(user_id) DO UPDATE SET phone_number=EXCLUDED.phone_number,salt=EXCLUDED.salt,
      password_hash=EXCLUDED.password_hash,updated_at=EXCLUDED.updated_at;
  SELECT credential_revision INTO current_revision FROM public.phone_password_credentials WHERE user_id=p_user_id;
  PERFORM set_config('app.phone_password_request',coalesce(prior_request,''),true);
  PERFORM set_config('app.phone_password_expected',coalesce(prior_expected,''),true);
  RETURN jsonb_build_object('ok',true,'user_id',p_user_id,'request_id',p_request_id,'revision',current_revision);
END $$;
REVOKE ALL ON FUNCTION public.phone_password_save_v1(uuid,text,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phone_password_save_v1(uuid,text,uuid,bigint,text,text) TO service_role;
