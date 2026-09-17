-- 132_casa_exact_score_only.sql — en las pollas de marcador NUEVAS solo suma el
-- marcador exacto.
--
-- Pedido del dueño (2026-09-16): «para las próximas pollas que es acertar
-- marcadores, cambia las reglas: ahora solo marcador exacto da 3 puntos, de
-- resto todo da 0 puntos».
--
-- Cómo se cumple sin tocar lo que ya está jugándose:
--   · casa_score_polla (082) ya puntúa con los valores de CADA polla
--     (points_exact / points_one_team). No cambia.
--   · casa_create_polla_v2 escribía los puntos fijos «3,3,1» al crear; desde
--     acá escribe «3,3,0»: marcador exacto 3, goles de un solo equipo 0.
--   · El DEFAULT de casa_pollas.points_one_team pasa a 0 para cualquier otra
--     inserción futura. Un cambio de DEFAULT no modifica filas existentes.
--
-- Las pollas ya creadas (abiertas, cerradas o resueltas) conservan su
-- points_one_team = 1: ni se repuntúan ni se reescriben. Info, el bot y el
-- editor leen los puntos reales de cada polla, así que cada una explica su
-- propia regla.
--
-- Salvo la constante de puntos, casa_create_polla_v2 es idéntica a la 131.
-- Regresión local: scripts/casa-exact-score-check.sql.

ALTER TABLE public.casa_pollas ALTER COLUMN points_one_team SET DEFAULT 0;
COMMENT ON COLUMN public.casa_pollas.points_one_team IS
  'Puntos por acertar los goles de UN solo equipo. 0 desde la migración 132 (solo el marcador exacto suma); las pollas anteriores conservan 1.';

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
    3,3,0,'borrador',closing,p_config->>'closeMode',
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

-- ── Permisos: solo servidor (igual que en la 131) ─────────────────────────
REVOKE ALL ON FUNCTION public.casa_create_polla_v2(jsonb,text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.casa_create_polla_v2(jsonb,text,uuid,integer) TO service_role;

-- Verificación (solo lectura) después de aplicar:
--   SELECT column_default FROM information_schema.columns
--    WHERE table_name='casa_pollas' AND column_name='points_one_team';   -- 0
--   SELECT prosrc LIKE '%3,3,0,''borrador''%' FROM pg_proc WHERE proname='casa_create_polla_v2'; -- true
--   SELECT proacl FROM pg_proc WHERE proname='casa_create_polla_v2';     -- solo postgres + service_role
