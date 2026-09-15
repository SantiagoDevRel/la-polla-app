-- 131_casa_multiple_entries.sql — varias participaciones por persona en una polla.
--
-- Pedido del dueño (2026-09-15): en una polla de $20.000 alguien puede entrar,
-- por ejemplo, cinco veces. Cada participación es una opción más de ganar:
--   · tiene SU PROPIA transferencia y SU PROPIO comprobante (nunca un pago de
--     $100.000 por cinco cupos);
--   · el administrador aprueba o rechaza comprobante por comprobante;
--   · tiene sus propios pronósticos, que se pueden llenar desde que se envía el
--     comprobante, pero solo suman en la tabla y en el reparto cuando se aprueba.
--
-- Numeración: 125-129 quedan libres para ramas en curso (criterio de 130).
--
-- Qué cambia:
--   1. casa_pollas.max_entries_per_user (1..50, por defecto 10): tope por persona.
--   2. casa_entries.entry_number (1, 2, 3…) para pollas de partidos/preguntas. Las
--      rifas siguen igual: cada boleta ya era su propia inscripción.
--      El índice "una por persona" se reemplaza por (polla, persona, número).
--   3. casa_begin_entry_proof_v3: el llamador elige la participación (número) o
--      pide una nueva (NULL). casa_begin_entry_proof_v2 conserva su firma y su
--      comportamiento para clientes viejos y el bot: elige sola la participación.
--   4. casa_leaderboard agrega entry_number y user_entries (cuántas
--      participaciones aprobadas tiene esa persona) para distinguirlas en pantalla.
--   5. casa_settle_polla_v2: el pozo se divide por PARTICIPACIÓN ganadora y se
--      paga agrupado por persona (casa_payouts sigue siendo UNIQUE(polla, usuario)).
--      Un objeto con empate entre participaciones de UNA sola persona no abre
--      sorteo: esa persona gana. Si empatan varias personas, el sorteo tiene un
--      boleto por persona (casa_object_draw_candidates es por usuario).
--   6. casa_create_polla_v2, casa_set_max_entries_v2 y casa_polla_editor_v2 llevan
--      el tope al panel (crear y editar).
--
-- No se tocan predictions, pronósticos de Casa, pagos ni resultados existentes.
-- Las inscripciones actuales quedan como participación 1 (una por persona era la
-- regla hasta hoy); el backfill no dispara los guards ni cambia updated_at.
-- Todas las funciones siguen siendo SECURITY DEFINER, search_path fijo y EXECUTE
-- solo para service_role.

-- ── 1. Tope por persona ─────────────────────────────────────────────────────
ALTER TABLE public.casa_pollas
  ADD COLUMN IF NOT EXISTS max_entries_per_user smallint NOT NULL DEFAULT 10;
DO $$ BEGIN
  ALTER TABLE public.casa_pollas ADD CONSTRAINT casa_pollas_max_entries_per_user_check
    CHECK (max_entries_per_user BETWEEN 1 AND 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Número de participación ──────────────────────────────────────────────
ALTER TABLE public.casa_entries ADD COLUMN IF NOT EXISTS entry_number smallint;

-- Backfill sin guards: una inscripción pagada o de una polla finalizada no puede
-- cambiar por la API (con razón). Esto solo numera; no toca estado ni dinero.
ALTER TABLE public.casa_entries DISABLE TRIGGER casa_00_contract;
ALTER TABLE public.casa_entries DISABLE TRIGGER casa_entries_lifecycle_guard;
ALTER TABLE public.casa_entries DISABLE TRIGGER set_casa_entries_updated_at;
UPDATE public.casa_entries SET entry_number = 1
 WHERE ticket_number IS NULL AND entry_number IS NULL;
ALTER TABLE public.casa_entries ENABLE TRIGGER casa_00_contract;
ALTER TABLE public.casa_entries ENABLE TRIGGER casa_entries_lifecycle_guard;
ALTER TABLE public.casa_entries ENABLE TRIGGER set_casa_entries_updated_at;

DO $$ BEGIN
  ALTER TABLE public.casa_entries ADD CONSTRAINT casa_entries_entry_number_shape
    CHECK ((ticket_number IS NULL) = (entry_number IS NOT NULL) AND (entry_number IS NULL OR entry_number BETWEEN 1 AND 50));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS public.casa_entries_one_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS casa_entries_user_entry_number
  ON public.casa_entries(polla_id, user_id, entry_number) WHERE ticket_number IS NULL;

-- Any insert without a number (older tools, fixtures) gets the next one. The
-- proof RPC already chooses it under the pool lock; a concurrent direct insert
-- fails on the unique index instead of sharing a number.
CREATE OR REPLACE FUNCTION public.casa_assign_entry_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.ticket_number IS NULL AND NEW.entry_number IS NULL THEN
    SELECT coalesce(max(entry_number),0)+1 INTO NEW.entry_number FROM public.casa_entries
      WHERE polla_id=NEW.polla_id AND user_id=NEW.user_id AND ticket_number IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.casa_assign_entry_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_assign_entry_number() TO service_role;
DROP TRIGGER IF EXISTS casa_01_entry_number ON public.casa_entries;
CREATE TRIGGER casa_01_entry_number BEFORE INSERT ON public.casa_entries
  FOR EACH ROW EXECUTE FUNCTION public.casa_assign_entry_number();

-- ── 3. Comprobante por participación ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.casa_begin_entry_proof_v3(
  p_polla_id uuid,p_user_id uuid,p_request_id uuid,p_ticket integer,p_entry_number integer,
  p_sha256 text,p_content_type text,p_bytes integer,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; e public.casa_entries; a public.casa_entry_proof_attempts;
  v_id uuid; v_ext text; v_found boolean:=false; v_live integer; v_dup integer;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  p := public.casa_v2_lock_polla(p_polla_id);
  IF p.publication_mode='oculta' OR p.status='borrador' OR p.opens_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_PUBLISHED';
  END IF;
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
  IF p_entry_number IS NOT NULL AND (p.kind='rifa' OR p_entry_number<1 OR p_entry_number>50) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_ENTRY';
  END IF;

  -- The same request is idempotent, exactly as in v2.
  SELECT * INTO a FROM public.casa_entry_proof_attempts
    WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN
    SELECT * INTO e FROM public.casa_entries WHERE id=a.entry_id;
    IF e.polla_id<>p.id OR e.ticket_number IS DISTINCT FROM p_ticket
      OR (p_entry_number IS NOT NULL AND e.entry_number IS DISTINCT FROM p_entry_number)
      OR a.content_sha256 IS DISTINCT FROM p_sha256 OR a.content_type IS DISTINCT FROM p_content_type
      OR a.content_bytes IS DISTINCT FROM p_bytes THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REQUEST_CONFLICT';
    END IF;
    IF e.current_proof_attempt_id IS DISTINCT FROM a.id THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED';
    END IF;
    IF a.state='confirmed' THEN
      IF e.status NOT IN ('pendiente','pagada') THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ATTEMPT_REPLACED';
      END IF;
      RETURN jsonb_build_object('entry_id',e.id,'entry_number',e.entry_number,'attempt_id',a.id,'state','confirmed',
        'entry_status',e.status,'proof_path',a.proof_path);
    END IF;
    IF a.state<>'uploading' OR a.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UPLOAD_EXPIRED';
    END IF;
    RETURN jsonb_build_object('entry_id',e.id,'entry_number',e.entry_number,'attempt_id',a.id,'state','uploading',
      'proof_path',a.proof_path,'expires_at',a.expires_at);
  END IF;

  IF p.kind='rifa' THEN
    SELECT * INTO e FROM public.casa_entries WHERE polla_id=p.id AND ticket_number=p_ticket FOR UPDATE;
    v_found := FOUND;
  ELSIF p_entry_number IS NOT NULL THEN
    SELECT * INTO e FROM public.casa_entries
      WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL AND entry_number=p_entry_number FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ENTRY_NOT_FOUND',DETAIL='Ese cupo no existe.';
    END IF;
    v_found := true;
  ELSE
    -- New participation. First recover the very same upload in progress (another
    -- tab, or a response lost before the client stored its request).
    SELECT e1.* INTO e FROM public.casa_entries e1
      JOIN public.casa_entry_proof_attempts a1 ON a1.id=e1.current_proof_attempt_id AND a1.entry_id=e1.id
      WHERE e1.polla_id=p.id AND e1.user_id=p_user_id AND e1.ticket_number IS NULL
        AND e1.status='pendiente' AND e1.proof_path IS NULL
        AND a1.state='uploading' AND a1.expires_at>clock_timestamp()
        AND a1.content_sha256=p_sha256 AND a1.content_type=p_content_type AND a1.content_bytes=p_bytes
      ORDER BY e1.entry_number LIMIT 1 FOR UPDATE OF e1;
    v_found := FOUND;
    IF NOT v_found THEN
      -- A failed upload never became a participation: reuse its number.
      SELECT * INTO e FROM public.casa_entries
        WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL AND status='anulada'
        ORDER BY entry_number LIMIT 1 FOR UPDATE;
      v_found := FOUND;
    END IF;
  END IF;

  IF v_found THEN
    IF e.user_id<>p_user_id THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='TICKET_UNAVAILABLE'; END IF;
    IF e.current_proof_attempt_id IS NOT NULL AND e.status IN ('pendiente','pagada') THEN
      SELECT * INTO a FROM public.casa_entry_proof_attempts WHERE id=e.current_proof_attempt_id;
      IF a.state='confirmed' AND a.proof_path=e.proof_path
        AND a.content_sha256=p_sha256 AND a.content_type=p_content_type AND a.content_bytes=p_bytes THEN
        RETURN jsonb_build_object('entry_id',e.id,'entry_number',e.entry_number,'attempt_id',a.id,'state','confirmed',
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
        IF a.content_sha256=p_sha256 AND a.content_type=p_content_type AND a.content_bytes=p_bytes THEN
          RETURN jsonb_build_object('entry_id',e.id,'entry_number',e.entry_number,'attempt_id',a.id,'state','uploading',
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
    IF p.kind='rifa' AND EXISTS(SELECT 1 FROM public.casa_entries
      WHERE polla_id=p.id AND user_id=p_user_id AND status<>'pagada') THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREVIOUS_TICKET_PENDING';
    END IF;
  END IF;

  IF p.status<>'abierta' OR p.closes_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INSCRIPTIONS_CLOSED';
  END IF;

  IF p.kind<>'rifa' THEN
    -- Cap: every participation that is not a failed upload counts, rejected ones
    -- too (they are retried in place, not replaced). A reused/revived failed
    -- upload is the only way an existing row adds to the count.
    IF NOT v_found OR e.status='anulada' THEN
      SELECT count(*) INTO v_live FROM public.casa_entries
        WHERE polla_id=p.id AND user_id=p_user_id AND ticket_number IS NULL AND status<>'anulada'
          AND (NOT v_found OR id<>e.id);
      IF v_live>=p.max_entries_per_user THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MAX_ENTRIES',
          DETAIL=format('Puedes tener hasta %s cupos en esta polla.',p.max_entries_per_user);
      END IF;
    END IF;
    -- One transfer per participation: the same receipt image cannot back a
    -- second live participation. Best effort (same prepared bytes); the
    -- administrator still reviews every proof.
    SELECT e2.entry_number INTO v_dup FROM public.casa_entry_proof_attempts a2
      JOIN public.casa_entries e2 ON e2.id=a2.entry_id AND e2.current_proof_attempt_id=a2.id
      WHERE e2.polla_id=p.id AND e2.user_id=p_user_id AND e2.ticket_number IS NULL
        AND e2.status IN ('pendiente','pagada') AND a2.state='confirmed' AND a2.content_sha256=p_sha256
        AND (NOT v_found OR e2.id<>e.id)
      ORDER BY e2.entry_number LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DUPLICATE_PROOF',
        DETAIL=format('Ese comprobante ya lo enviaste para el cupo %s. Cada cupo necesita su propia transferencia.',v_dup);
    END IF;
  END IF;

  IF NOT v_found THEN
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number,entry_number)
      VALUES(p.id,p_user_id,'pendiente',p.entry_price_cop,p_ticket,
        CASE WHEN p.kind='rifa' THEN NULL ELSE (SELECT coalesce(max(x.entry_number),0)+1 FROM public.casa_entries x
          WHERE x.polla_id=p.id AND x.user_id=p_user_id AND x.ticket_number IS NULL) END)
      RETURNING * INTO e;
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
  RETURN jsonb_build_object('entry_id',e.id,'entry_number',e.entry_number,'attempt_id',a.id,'state','uploading',
    'proof_path',a.proof_path,'expires_at',a.expires_at);
END $$;

-- v2 keeps its signature for older clients and the Telegram bot. Without a
-- participation number it picks one the way a single-entry client expects:
-- the one this request already started, else one to retry, else one in review,
-- else a paid one (ALREADY_PAID, as before). With no entries it creates #1.
CREATE OR REPLACE FUNCTION public.casa_begin_entry_proof_v2(
  p_polla_id uuid,p_user_id uuid,p_request_id uuid,p_ticket integer,
  p_sha256 text,p_content_type text,p_bytes integer,p_contract integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_number integer;
BEGIN
  IF p_ticket IS NULL THEN
    SELECT e.entry_number INTO v_number FROM public.casa_entry_proof_attempts a
      JOIN public.casa_entries e ON e.id=a.entry_id
      WHERE a.user_id=p_user_id AND a.request_id=p_request_id AND e.polla_id=p_polla_id;
    IF v_number IS NULL THEN
      SELECT e.entry_number INTO v_number FROM public.casa_entries e
        WHERE e.polla_id=p_polla_id AND e.user_id=p_user_id AND e.ticket_number IS NULL
        ORDER BY CASE WHEN e.status IN ('rechazada','anulada') OR (e.status='pendiente' AND e.proof_path IS NULL) THEN 0
                      WHEN e.status='pendiente' THEN 1 ELSE 2 END, e.entry_number
        LIMIT 1;
    END IF;
  END IF;
  RETURN public.casa_begin_entry_proof_v3(p_polla_id,p_user_id,p_request_id,p_ticket,v_number,
    p_sha256,p_content_type,p_bytes,p_contract);
END $$;

CREATE OR REPLACE FUNCTION public.casa_my_entry_v2(p_polla_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('id',id,'polla_id',polla_id,'user_id',user_id,'status',status,
    'amount_cop',amount_cop,'proof_path',proof_path,'current_proof_attempt_id',current_proof_attempt_id,
    'proof_uploaded_at',proof_uploaded_at,'reviewed_at',reviewed_at,'reject_reason',reject_reason,
    'ticket_number',ticket_number,'entry_number',entry_number,'created_at',created_at)
  FROM public.casa_entries WHERE polla_id=p_polla_id AND user_id=p_user_id
  ORDER BY CASE status WHEN 'pagada' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'rechazada' THEN 2 ELSE 3 END,
    entry_number NULLS LAST,created_at DESC,id LIMIT 1;
$$;

-- ── 4. Tabla por participación ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.casa_leaderboard(uuid);
CREATE FUNCTION public.casa_leaderboard(p_polla_id uuid)
RETURNS TABLE(entry_id uuid, user_id uuid, display_name text, avatar_url text, points integer, aciertos integer,
  puesto integer, entry_number integer, user_entries integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT
    e.id,
    e.user_id,
    u.display_name,
    u.avatar_url,
    COALESCE(SUM(pk.points_earned), 0)::integer                       AS points,
    COALESCE(SUM((pk.points_earned > 0)::integer), 0)::integer        AS aciertos,
    RANK() OVER (ORDER BY COALESCE(SUM(pk.points_earned), 0) DESC)::integer AS puesto,
    e.entry_number::integer,
    (COUNT(*) OVER (PARTITION BY e.user_id))::integer                 AS user_entries
  FROM public.casa_entries e
  JOIN public.users u ON u.id = e.user_id
  LEFT JOIN public.casa_picks pk ON pk.entry_id = e.id AND NOT EXISTS(SELECT 1 FROM public.casa_polla_matches voided
    WHERE voided.polla_id=e.polla_id AND voided.match_id=pk.match_id AND voided.voided_at IS NOT NULL)
  WHERE e.polla_id = p_polla_id AND e.status = 'pagada'
  GROUP BY e.id, e.user_id, u.display_name, u.avatar_url, e.entry_number
  ORDER BY points DESC, u.display_name ASC, e.user_id, e.entry_number NULLS LAST;
$$;

-- ── 5. Reparto por participación, pagado por persona ───────────────────────
CREATE OR REPLACE FUNCTION public.casa_settle_polla_v2(p_polla_id uuid, p_contract integer, p_actor_id uuid DEFAULT NULL::uuid, p_chat_id bigint DEFAULT NULL::bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas; d public.casa_object_draws; v_prize bigint; v_paid integer;
  v_top integer; v_winners integer; v_shares integer; v_each bigint:=0; v_remainder bigint:=0; v_outcome text; v_user uuid;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,p_chat_id);
  PERFORM public.casa_sweep_match_issues();
  p := public.casa_v2_lock_polla(p_polla_id,true);
  IF p.status<>'cerrada' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CLOSE_FIRST'; END IF;
  SELECT * INTO d FROM public.casa_object_draws WHERE polla_id=p.id;
  IF FOUND THEN
    IF d.state<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED'; END IF;
    RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
      'draw_id',d.id,'prize_cop',0,'winners',0,'each_cop',0,'top_points',d.top_points);
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ALREADY_SETTLED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_match_issues mi JOIN public.casa_polla_matches pm ON pm.match_id=mi.match_id
    WHERE pm.polla_id=p.id AND pm.voided_at IS NULL AND mi.decision IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OPEN_MATCH_ISSUES',DETAIL='Hay partidos con novedades sin decidir.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.casa_entries e LEFT JOIN public.casa_entry_proof_attempts a ON a.id=e.current_proof_attempt_id
    WHERE e.polla_id=p.id AND e.status='pendiente' AND
      (e.proof_path IS NOT NULL OR (a.state='uploading' AND a.expires_at>clock_timestamp()))) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PENDING_PROOFS',DETAIL='Revisa los comprobantes pendientes y espera las cargas en curso.';
  END IF;
  SELECT paid_entries,prize_cop INTO v_paid,v_prize FROM public.casa_pot_summaries_v2(ARRAY[p.id]);
  IF v_paid=0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES',DETAIL='Esta polla no tiene inscripciones pagadas.'; END IF;
  IF p.kind='partidos' AND EXISTS(SELECT 1 FROM public.casa_polla_matches pm JOIN public.matches m ON m.id=pm.match_id
    WHERE pm.polla_id=p.id AND m.final_verified_at IS NULL AND pm.voided_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNVERIFIED_MATCHES',DETAIL='Faltan partidos por verificar.';
  END IF;
  IF p.kind='manual' AND EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=p.id AND resolved_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNRESOLVED_QUESTIONS',DETAIL='Faltan preguntas por resolver.';
  END IF;
  IF p.prize_kind='objeto' AND nullif(btrim(p.prize_object),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='OBJECT_REQUIRED';
  END IF;
  IF p.kind='rifa' THEN
    IF p.drawn_number IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_NUMBER_REQUIRED'; END IF;
    SELECT user_id INTO v_user FROM public.casa_entries WHERE polla_id=p.id AND status='pagada' AND ticket_number=p.drawn_number;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UNSOLD_TICKET',DETAIL='La boleta sorteada no está pagada. No se ha adjudicado el premio.'; END IF;
    v_winners:=1; v_shares:=1;
  ELSE
    PERFORM public.casa_score_polla(p.id);
    SELECT max(points) INTO v_top FROM public.casa_leaderboard(p.id);
    IF v_top IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='NO_PAID_ENTRIES'; END IF;
    IF v_top=0 THEN
      UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,
        settled_chat_id=p_chat_id,settlement_outcome='house_retained_zero_points',settlement_prize_cop=v_prize WHERE id=p.id;
      RETURN jsonb_build_object('contract',2,'outcome','house_retained_zero_points','polla_id',p.id,'status','resuelta',
        'prize_cop',0,'retained_prize_cop',v_prize,'winners',0,'each_cop',0,'top_points',0);
    END IF;
    IF v_top<0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INVALID_POINTS'; END IF;
    -- A share per winning participation; a payout per person.
    SELECT count(*),count(DISTINCT user_id) INTO v_shares,v_winners FROM public.casa_leaderboard(p.id) WHERE points=v_top;
    IF p.prize_kind='objeto' AND v_winners>1 THEN
      INSERT INTO public.casa_object_draws(polla_id,prize_object,top_points)
        VALUES(p.id,p.prize_object,v_top) RETURNING * INTO d;
      INSERT INTO public.casa_object_draw_candidates(draw_id,user_id,points,ticket)
        SELECT d.id,w.user_id,v_top,row_number() OVER(ORDER BY w.user_id)::integer
        FROM (SELECT DISTINCT user_id FROM public.casa_leaderboard(p.id) WHERE points=v_top) w;
      RETURN jsonb_build_object('contract',2,'outcome','object_draw_pending','polla_id',p.id,'status','cerrada',
        'draw_id',d.id,'prize_cop',0,'winners',0,'candidates',v_winners,'each_cop',0,'top_points',v_top);
    END IF;
  END IF;
  v_each:=v_prize/v_shares;
  v_remainder:=v_prize-v_each*v_shares;
  v_outcome:=CASE WHEN p.prize_kind='objeto' THEN 'object_awarded' ELSE 'money_awarded' END;
  IF p.kind='rifa' THEN
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      VALUES(p.id,v_user,1,NULL,v_prize,'Boleta '||p.drawn_number||' — '||p.draw_method,p.prize_kind,
        CASE WHEN p.prize_kind='objeto' THEN p.prize_object END);
  ELSE
    -- Rounding pesos go one per winning participation, in a stable order, so the
    -- payouts add up to exactly the prize.
    INSERT INTO public.casa_payouts(polla_id,user_id,place,points,amount_cop,note,prize_kind,prize_object)
      SELECT p.id,s.user_id,1,v_top,sum(s.amount)::integer,
        CASE WHEN v_shares>1 THEN 'Empate en '||v_top||' puntos'
          ||CASE WHEN count(*)>1 THEN ' · '||count(*)||' participaciones ganadoras' ELSE '' END END,
        p.prize_kind,CASE WHEN p.prize_kind='objeto' THEN p.prize_object END
      FROM (SELECT user_id,v_each+CASE WHEN row_number() OVER(ORDER BY user_id,entry_number)<=v_remainder THEN 1 ELSE 0 END AS amount
              FROM public.casa_leaderboard(p.id) WHERE points=v_top) s
      GROUP BY s.user_id;
  END IF;
  UPDATE public.casa_pollas SET status='resuelta',settled_at=clock_timestamp(),settled_by=p_actor_id,settled_chat_id=p_chat_id,
    settlement_outcome=v_outcome,settlement_prize_cop=v_prize WHERE id=p.id;
  RETURN jsonb_build_object('contract',2,'outcome',v_outcome,'polla_id',p.id,'status','resuelta',
    'prize_cop',v_prize,'winners',v_winners,'winning_entries',v_shares,'each_cop',v_each,'remainder',v_remainder,'top_points',v_top);
END $$;

-- ── 6. Tope editable desde el panel ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.casa_set_max_entries_v2(p_polla_id uuid,p_max integer,p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.casa_pollas;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MAX_ENTRIES';
  END IF;
  p := public.casa_v2_lock_polla(p_polla_id);
  IF p.kind='rifa' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_POLLA_KIND'; END IF;
  -- Lowering the cap never removes participations that already exist; it only
  -- stops new ones.
  IF p.max_entries_per_user IS DISTINCT FROM p_max THEN
    UPDATE public.casa_pollas SET max_entries_per_user=p_max WHERE id=p.id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p.id,'max_entries_per_user',p_max,'changed',p.max_entries_per_user IS DISTINCT FROM p_max);
END $$;

CREATE OR REPLACE FUNCTION public.casa_polla_editor_v2(p_polla_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_state jsonb;
BEGIN
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  SELECT jsonb_build_object(
    'polla',jsonb_build_object(
      'id',p.id,'slug',p.slug,'name',p.name,'description',p.description,'kind',p.kind,'status',p.status,
      'publication_mode',p.publication_mode,'opens_at',p.opens_at,'closes_at',p.closes_at,'close_mode',p.close_mode,
      'scoring_mode',p.scoring_mode,'entry_price_cop',p.entry_price_cop,'house_cut_pct',p.house_cut_pct,
      'prize_kind',p.prize_kind,'pot_mode',p.pot_mode,'fixed_prize_cop',p.fixed_prize_cop,
      'prize_object',p.prize_object,'prize_image_path',p.prize_image_path,
      'payout_method',p.payout_method,'payout_account',p.payout_account,'payout_account_name',p.payout_account_name,
      'ticket_count',p.ticket_count,'max_entries_per_user',p.max_entries_per_user),
    'block',public.casa_polla_edit_block(p),
    'entries',(SELECT count(*) FROM public.casa_entries e WHERE e.polla_id=p.id),
    'operation_mode',(SELECT mode FROM public.casa_operation_control WHERE singleton),
    'object_draws_enabled',(SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton),
    'matches',coalesce((
      SELECT jsonb_agg(jsonb_build_object('match_id',l.match_id,'order_index',l.order_index,
          'voided',l.voided_at IS NOT NULL,
          'picks',(SELECT count(*) FROM public.casa_picks k WHERE k.polla_id=l.polla_id AND k.match_id=l.match_id))
        ORDER BY l.order_index,l.match_id)
      FROM public.casa_polla_matches l WHERE l.polla_id=p.id),'[]'::jsonb))
  INTO v_state
  FROM public.casa_pollas p WHERE p.id=p_polla_id;
  RETURN v_state;
END $$;

-- La creación guarda el tope en la misma transacción. Copia de 104 con una
-- sola diferencia: valida y escribe max_entries_per_user.
CREATE OR REPLACE FUNCTION public.casa_create_polla_v2(p_config jsonb, p_slug text, p_actor_id uuid, p_contract integer)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE p public.casa_pollas; q jsonb; opt text; qid uuid; mid uuid; i integer:=0; j integer;
  closing timestamptz; v_count integer; v_publish boolean; v_mode text; v_pot text; v_open timestamptz; v_fixed bigint;
  v_max numeric;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  IF p_config->>'kind' NOT IN ('partidos','manual','rifa') OR p_config->>'prizeKind' NOT IN ('pozo','objeto')
    OR length(btrim(coalesce(p_config->>'name','')))<3 OR length(coalesce(p_slug,''))<1 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  IF p_config->>'prizeKind'='objeto' AND length(btrim(coalesce(p_config->>'prizeObject','')))<3 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OBJECT_REQUIRED';
  END IF;
  v_mode:=coalesce(p_config->>'publicationMode',CASE WHEN coalesce((p_config->>'publish')::boolean,false) THEN 'ahora' ELSE 'oculta' END);
  v_pot:=coalesce(p_config->>'potMode','proporcional');
  IF v_mode NOT IN ('ahora','programada','oculta') OR v_pot NOT IN ('proporcional','fijo') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  v_fixed:=CASE WHEN v_pot='fijo' THEN (p_config->>'fixedPrizeCop')::bigint END;
  IF v_pot='fijo' AND (p_config->>'prizeKind'<>'pozo' OR v_fixed IS NULL OR v_fixed NOT BETWEEN 1 AND 1000000000
   ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
  END IF;
  -- Migración 131: participaciones por persona (1..50, por defecto 10). En rifas manda la boleta.
  IF p_config ? 'maxEntriesPerUser' AND jsonb_typeof(p_config->'maxEntriesPerUser') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MAX_ENTRIES';
  END IF;
  v_max:=CASE WHEN p_config->>'kind'='rifa' THEN 10 ELSE coalesce((p_config->>'maxEntriesPerUser')::numeric,10) END;
  IF v_max NOT BETWEEN 1 AND 50 OR v_max::numeric%1<>0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MAX_ENTRIES';
  END IF;
  v_open:=CASE WHEN v_mode='programada' THEN (p_config->>'publishesAt')::timestamptz ELSE clock_timestamp() END;
  closing := (p_config->>'closesAt')::timestamptz;
  IF p_config->>'kind'='partidos' THEN
    SELECT count(*),min(m.scheduled_at)-interval '5 minutes' INTO v_count,closing
      FROM public.matches m WHERE m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_config->'matchIds'));
    IF v_count<1 OR v_count>30 OR v_count<>jsonb_array_length(p_config->'matchIds') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MATCHES';
    END IF;
    IF p_config->>'closeMode'<>'auto' THEN closing := (p_config->>'closesAt')::timestamptz; END IF;
  ELSIF p_config->>'closeMode'='auto' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG';
  END IF;
  IF closing IS NULL OR closing<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INSCRIPTIONS_CLOSED'; END IF;
  IF v_mode='programada' AND (v_open IS NULL OR v_open<=clock_timestamp() OR v_open>=closing) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLICATION_DATE';
  END IF;
  v_publish := v_mode<>'oculta';
  IF v_publish AND p_config->>'prizeKind'='objeto' AND p_config->>'kind'<>'rifa'
    AND NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING';
  END IF;
  IF v_publish AND (p_config->>'entryPriceCop')::integer>0 AND
    (nullif(btrim(p_config->>'payoutMethod'),'') IS NULL OR nullif(btrim(p_config->>'payoutAccount'),'') IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PAYMENT_ACCOUNT_REQUIRED';
  END IF;
  INSERT INTO public.casa_pollas(slug,name,description,kind,tournament,scoring_mode,entry_price_cop,house_cut_pct,
    prize_kind,prize_object,prize_image_path,points_result,points_exact,points_one_team,status,closes_at,close_mode,
    ticket_count,draw_method,payout_method,payout_account,payout_account_name,created_by,pot_mode,fixed_prize_cop,publication_mode,opens_at,max_entries_per_user)
  VALUES(p_slug,p_config->>'name',p_config->>'description',(p_config->>'kind')::public.casa_polla_kind,
    CASE WHEN p_config->>'kind'='partidos' THEN p_config->>'tournament' END,
    CASE WHEN p_config->>'kind'='partidos' THEN (p_config->>'scoringMode')::public.casa_scoring_mode END,
    (p_config->>'entryPriceCop')::integer,CASE WHEN p_config->>'prizeKind'='objeto' THEN 100 ELSE (p_config->>'houseCutPct')::integer END,p_config->>'prizeKind',
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeObject' END,
    CASE WHEN p_config->>'prizeKind'='objeto' THEN p_config->>'prizeImagePath' END,
    3,3,1,'borrador',closing,p_config->>'closeMode',
    CASE WHEN p_config->>'kind'='rifa' THEN (p_config->>'ticketCount')::integer END,
    CASE WHEN p_config->>'kind'='rifa' THEN p_config->>'drawMethod' END,
    p_config->>'payoutMethod',p_config->>'payoutAccount',p_config->>'payoutAccountName',p_actor_id,v_pot,v_fixed,v_mode,v_open,v_max) RETURNING * INTO p;
  IF p.kind='partidos' THEN
    FOR mid IN SELECT value::uuid FROM jsonb_array_elements_text(p_config->'matchIds') LOOP
      INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) VALUES(p.id,mid,i); i:=i+1;
    END LOOP;
  ELSIF p.kind='manual' THEN
    IF coalesce(jsonb_array_length(p_config->'questions'),0) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_QUESTIONS';
    END IF;
    FOR q IN SELECT value FROM jsonb_array_elements(p_config->'questions') LOOP
      IF q->>'inputKind'='opciones' AND coalesce(jsonb_array_length(q->'options'),0)<2 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_QUESTIONS';
      END IF;
      INSERT INTO public.casa_questions(polla_id,prompt,order_index,points,input_kind)
        VALUES(p.id,q->>'prompt',i,(q->>'points')::integer,q->>'inputKind') RETURNING id INTO qid;
      i:=i+1; j:=0;
      IF q->>'inputKind'='opciones' THEN
        FOR opt IN SELECT value FROM jsonb_array_elements_text(q->'options') LOOP
          INSERT INTO public.casa_options(question_id,label,order_index) VALUES(qid,opt,j); j:=j+1;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  IF v_publish THEN UPDATE public.casa_pollas SET status='abierta' WHERE id=p.id; END IF;
  RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'publicada',v_mode='ahora','programada',v_mode='programada','opens_at',v_open);
END $function$;

-- ── Permisos: solo servidor ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer),
  public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer),
  public.casa_my_entry_v2(uuid,uuid),
  public.casa_leaderboard(uuid),
  public.casa_settle_polla_v2(uuid,integer,uuid,bigint),
  public.casa_set_max_entries_v2(uuid,integer,uuid,integer),
  public.casa_polla_editor_v2(uuid,uuid),
  public.casa_create_polla_v2(jsonb,text,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer),
  public.casa_begin_entry_proof_v2(uuid,uuid,uuid,integer,text,text,integer,integer),
  public.casa_my_entry_v2(uuid,uuid),
  public.casa_leaderboard(uuid),
  public.casa_settle_polla_v2(uuid,integer,uuid,bigint),
  public.casa_set_max_entries_v2(uuid,integer,uuid,integer),
  public.casa_polla_editor_v2(uuid,uuid),
  public.casa_create_polla_v2(jsonb,text,uuid,integer)
  TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT count(*) FROM public.casa_entries WHERE ticket_number IS NULL AND entry_number IS NULL;  -- 0
--   SELECT proname, proacl FROM pg_proc WHERE proname IN
--     ('casa_begin_entry_proof_v3','casa_set_max_entries_v2','casa_leaderboard'); -- solo postgres + service_role
