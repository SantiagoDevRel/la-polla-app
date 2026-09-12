-- Payment attempts and reservations share the pool lock with settlement.
-- Failed tickets stay owned by their original entry; no NULL/release/delete.
CREATE FUNCTION public.casa_begin_entry_proof_v2(
  p_polla_id uuid,p_user_id uuid,p_request_id uuid,p_ticket integer,
  p_sha256 text,p_content_type text,p_bytes integer,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; e public.casa_entries; a public.casa_entry_proof_attempts;
  v_id uuid; v_ext text;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  p := public.casa_v2_lock_polla(p_polla_id);
  IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='USER_REQUIRED';
  END IF;
  IF p_request_id IS NULL OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
    OR p_content_type IS NULL OR p_content_type NOT IN ('image/jpeg','image/png','image/webp')
    OR p_bytes IS NULL OR p_bytes <= 0 OR p_bytes > 8388608 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PROOF';
  END IF;
  IF p.kind='rifa' AND (p_ticket IS NULL OR p_ticket<1 OR p_ticket>p.ticket_count) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_TICKET';
  ELSIF p.kind<>'rifa' AND p_ticket IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_TICKET';
  END IF;
  SELECT * INTO a FROM public.casa_entry_proof_attempts
    WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN
    SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id;
    IF e.polla_id<>p.id OR e.ticket_number IS DISTINCT FROM p_ticket
      OR a.content_sha256 IS DISTINCT FROM p_sha256 OR a.content_type IS DISTINCT FROM p_content_type
      OR a.content_bytes IS DISTINCT FROM p_bytes THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REQUEST_CONFLICT';
    END IF;
    IF e.current_proof_attempt_id IS DISTINCT FROM a.id THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED';
    END IF;
    IF a.state='confirmed' THEN
      RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','confirmed','entry_status',e.status,'proof_path',a.proof_path);
    END IF;
    IF a.state<>'uploading' OR a.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPLOAD_EXPIRED';
    END IF;
    RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','uploading','proof_path',a.proof_path,'expires_at',a.expires_at);
  END IF;
  SELECT * INTO e FROM public.casa_entries WHERE polla_id=p.id
    AND ((p.kind='rifa' AND ticket_number=p_ticket)
      OR (p.kind<>'rifa' AND user_id=p_user_id AND ticket_number IS NULL)) FOR UPDATE;
  IF FOUND THEN
    IF e.user_id<>p_user_id THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='TICKET_UNAVAILABLE'; END IF;
    IF e.current_proof_attempt_id IS NOT NULL AND e.status IN ('pendiente','pagada') THEN
      SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=e.current_proof_attempt_id;
      IF a.state='confirmed' AND a.proof_path=e.proof_path
        AND a.content_sha256=p_sha256 AND a.content_type=p_content_type AND a.content_bytes=p_bytes THEN
        RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','confirmed',
          'entry_status',e.status,'proof_path',a.proof_path);
      END IF;
    END IF;
    IF e.status='pagada' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_PAID'; END IF;
    IF e.status='pendiente' AND e.proof_path IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PROOF_IN_REVIEW';
    END IF;
    IF e.current_proof_attempt_id IS NULL AND e.proof_path IS NOT NULL THEN
      -- Preserve a legacy rejected/failed proof before resetting current fields.
      INSERT INTO public.casa_entry_proof_attempts(entry_id,user_id,request_id,state,proof_path,confirmed_at,
        decision,reviewed_at,reviewed_by,review_reason)
      VALUES(e.id,e.user_id,gen_random_uuid(),'confirmed',e.proof_path,coalesce(e.proof_uploaded_at,e.created_at),
        CASE WHEN e.status='rechazada' THEN 'rechazada' END,
        CASE WHEN e.status='rechazada' THEN coalesce(e.reviewed_at,e.created_at) END,e.reviewed_by,e.reject_reason);
    END IF;
    IF e.current_proof_attempt_id IS NOT NULL THEN
      SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=e.current_proof_attempt_id;
      IF a.state='uploading' AND a.expires_at>clock_timestamp() THEN
        -- Recover the same immutable upload from another tab/device. Ownership
        -- and all file metadata must match; no local request token is required.
        IF a.content_sha256=p_sha256 AND a.content_type=p_content_type AND a.content_bytes=p_bytes THEN
          RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','uploading',
            'proof_path',a.proof_path,'expires_at',a.expires_at);
        END IF;
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPLOAD_IN_PROGRESS';
      END IF;
      IF a.state='uploading' THEN
        UPDATE public.casa_entry_proof_attempts SET state='expired' WHERE id=a.id;
      END IF;
    END IF;
  ELSE
    IF p.status<>'abierta' OR p.closes_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED';
    END IF;
    -- The parent lock serializes reservations. A person may recover all their
    -- historical tickets, but must finish payment review before taking another.
    IF p.kind='rifa' AND EXISTS(SELECT 1 FROM public.casa_entries
      WHERE polla_id=p.id AND user_id=p_user_id AND status<>'pagada') THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREVIOUS_TICKET_PENDING';
    END IF;
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number)
      VALUES(p.id,p_user_id,'pendiente',p.entry_price_cop,p_ticket) RETURNING * INTO e;
  END IF;
  IF p.status<>'abierta' OR p.closes_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED';
  END IF;
  v_id := gen_random_uuid();
  v_ext := CASE p_content_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;
  INSERT INTO public.casa_entry_proof_attempts(id,entry_id,user_id,request_id,proof_path,content_sha256,content_type,content_bytes)
    VALUES(v_id,e.id,p_user_id,p_request_id,'casa/'||p.id||'/'||e.id||'/'||v_id||'.'||v_ext,p_sha256,p_content_type,p_bytes)
    RETURNING * INTO a;
  -- Old proof and review details remain on their attempt, never overwritten in storage.
  UPDATE public.casa_entries SET status='pendiente',proof_path=NULL,proof_uploaded_at=NULL,
    current_proof_attempt_id=a.id,reviewed_by=NULL,reviewed_at=NULL,reject_reason=NULL,
    amount_cop=p.entry_price_cop WHERE id=e.id;
  RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','uploading','proof_path',a.proof_path,'expires_at',a.expires_at);
END $$;

CREATE FUNCTION public.casa_confirm_entry_proof_v2(
  p_attempt_id uuid,p_user_id uuid,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; e public.casa_entries; a public.casa_entry_proof_attempts;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id AND user_id=p_user_id;
  -- A successful previous confirmation can be read again even after settlement.
  SELECT * INTO p FROM public.casa_pollas WHERE id=e.polla_id FOR UPDATE;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id FOR UPDATE;
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF e.current_proof_attempt_id IS DISTINCT FROM a.id THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED';
  END IF;
  IF a.state='confirmed' THEN
    RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','confirmed','changed',false,'entry_status',e.status);
  END IF;
  p := public.casa_v2_lock_polla(p.id);
  -- A reservation started while open gets its full upload window, even if
  -- the administrator closes meanwhile. Settlement waits for this attempt.
  IF p.status NOT IN ('abierta','cerrada') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED';
  END IF;
  IF a.state<>'uploading' OR a.expires_at<=clock_timestamp() OR e.status<>'pendiente' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPLOAD_EXPIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='payment-proofs' AND name=a.proof_path) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PROOF_NOT_UPLOADED';
  END IF;
  UPDATE public.casa_entry_proof_attempts SET state='confirmed',confirmed_at=clock_timestamp() WHERE id=a.id;
  UPDATE public.casa_entries SET proof_path=a.proof_path,proof_uploaded_at=clock_timestamp() WHERE id=e.id;
  RETURN jsonb_build_object('entry_id',e.id,'attempt_id',a.id,'state','confirmed','changed',true,'entry_status','pendiente');
END $$;

CREATE FUNCTION public.casa_fail_entry_proof_v2(p_attempt_id uuid,p_user_id uuid,p_contract integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries; a public.casa_entry_proof_attempts;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id;
  PERFORM public.casa_v2_lock_polla(e.polla_id);
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id FOR UPDATE;
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF e.current_proof_attempt_id IS DISTINCT FROM a.id OR a.state<>'uploading' OR e.status<>'pendiente' THEN RETURN false; END IF;
  UPDATE public.casa_entry_proof_attempts SET state='failed',failure_reason='No se pudo subir el comprobante' WHERE id=a.id;
  UPDATE public.casa_entries SET status='anulada',reject_reason='No se pudo subir el comprobante' WHERE id=e.id;
  RETURN true;
END $$;

CREATE FUNCTION public.casa_review_attempt_v2(
  p_attempt_id uuid,p_decision text,p_reason text,p_contract integer,
  p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries; a public.casa_entry_proof_attempts; p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  IF p_decision IS NULL OR p_decision NOT IN ('pagada','rechazada') OR length(coalesce(p_reason,''))>200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REVIEW';
  END IF;
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id;
  p := public.casa_v2_lock_polla(e.polla_id);
  IF p.status NOT IN ('abierta','cerrada') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_OPEN'; END IF;
  SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id FOR UPDATE;
  SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF e.current_proof_attempt_id IS DISTINCT FROM a.id OR a.state<>'confirmed' OR e.proof_path IS DISTINCT FROM a.proof_path THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED';
  END IF;
  IF a.decision=p_decision AND e.status::text=p_decision THEN
    RETURN jsonb_build_object('changed',false,'entry_id',e.id,'polla_id',e.polla_id,'status',e.status);
  END IF;
  IF a.decision IS NOT NULL OR e.status<>'pendiente' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_REVIEWED';
  END IF;
  UPDATE public.casa_entry_proof_attempts SET decision=p_decision,reviewed_at=clock_timestamp(),
    reviewed_by=p_actor_id,reviewed_chat_id=p_chat_id,review_reason=p_reason WHERE id=a.id;
  UPDATE public.casa_entries SET status=p_decision::public.casa_entry_status,reviewed_at=clock_timestamp(),
    reviewed_by=p_actor_id,reject_reason=CASE WHEN p_decision='rechazada' THEN coalesce(nullif(btrim(p_reason),''),'Comprobante rechazado') END
    WHERE id=e.id;
  RETURN jsonb_build_object('changed',true,'entry_id',e.id,'polla_id',e.polla_id,'status',p_decision);
END $$;

-- Legacy proof adaptation is explicit, idempotent and admin-only. It preserves
-- the existing path, upload date and any old decision instead of re-uploading.
CREATE FUNCTION public.casa_legacy_proof_attempt_v2(
  p_entry_id uuid,p_contract integer,p_actor_id uuid DEFAULT NULL,p_chat_id bigint DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.casa_entries; v_id uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  SELECT * INTO e FROM public.casa_entries WHERE id=p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ENTRY_NOT_FOUND'; END IF;
  PERFORM public.casa_v2_lock_polla(e.polla_id);
  SELECT * INTO e FROM public.casa_entries WHERE id=p_entry_id FOR UPDATE;
  IF e.current_proof_attempt_id IS NOT NULL THEN RETURN e.current_proof_attempt_id; END IF;
  IF e.proof_path IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PROOF_NOT_UPLOADED'; END IF;
  INSERT INTO public.casa_entry_proof_attempts(entry_id,user_id,request_id,state,proof_path,
    confirmed_at,decision,reviewed_at,reviewed_by,review_reason)
    VALUES(e.id,e.user_id,gen_random_uuid(),'confirmed',e.proof_path,coalesce(e.proof_uploaded_at,e.created_at),
      CASE WHEN e.status IN ('pagada','rechazada') THEN e.status::text END,
      CASE WHEN e.status IN ('pagada','rechazada') THEN coalesce(e.reviewed_at,e.created_at) END,e.reviewed_by,e.reject_reason)
    RETURNING id INTO v_id;
  UPDATE public.casa_entries SET current_proof_attempt_id=v_id WHERE id=e.id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.casa_ticket_availability_v2(p_polla_id uuid,p_user_id uuid,p_from integer,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; v_rows jsonb; v_reserved integer;
BEGIN
  IF p_user_id IS NULL OR p_from IS NULL OR p_limit IS NULL OR p_from<1 OR p_limit<1 OR p_limit>100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_RANGE';
  END IF;
  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id AND kind='rifa'
    AND archived_at IS NULL AND status NOT IN ('borrador','anulada');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_FOUND'; END IF;
  SELECT count(*) INTO v_reserved FROM public.casa_entries WHERE polla_id=p.id AND ticket_number IS NOT NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object('number',n,'state',
    CASE WHEN e.id IS NULL THEN 'available' WHEN e.user_id<>p_user_id THEN 'unavailable'
      WHEN e.status='pagada' THEN 'paid' WHEN e.status='pendiente' AND e.proof_path IS NOT NULL THEN 'review'
      WHEN a.state='uploading' AND a.expires_at>clock_timestamp() THEN 'uploading' ELSE 'resume' END) ORDER BY n),'[]') INTO v_rows
    FROM generate_series(p_from,least(p.ticket_count,p_from::bigint+p_limit-1)::integer) n
    LEFT JOIN public.casa_entries e ON e.polla_id=p.id AND e.ticket_number=n
    LEFT JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id;
  RETURN jsonb_build_object('tickets',v_rows,'total',p.ticket_count,'reserved',v_reserved,'available',p.ticket_count-v_reserved,
    'can_reserve',NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p.id AND user_id=p_user_id AND status<>'pagada'),
    'next',CASE WHEN p_from::bigint+p_limit<=p.ticket_count THEN p_from+p_limit ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer),
  public.casa_confirm_entry_proof_v2(uuid,uuid,integer),public.casa_fail_entry_proof_v2(uuid,uuid,integer),
  public.casa_review_attempt_v2(uuid,text,text,integer,uuid,bigint),public.casa_legacy_proof_attempt_v2(uuid,integer,uuid,bigint),
  public.casa_ticket_availability_v2(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer),
  public.casa_confirm_entry_proof_v2(uuid,uuid,integer),public.casa_fail_entry_proof_v2(uuid,uuid,integer),
  public.casa_review_attempt_v2(uuid,text,text,integer,uuid,bigint),public.casa_legacy_proof_attempt_v2(uuid,integer,uuid,bigint),
  public.casa_ticket_availability_v2(uuid,uuid,integer,integer) TO service_role;
