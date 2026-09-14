-- 122: editor administrativo de pollas Casa (engranaje en /casa, 2026-09-14).
--
-- Pedido del dueño: una tuerca arriba a la derecha de cada polla, visible solo
-- para administradores, que permita editar la polla y agregar o quitar
-- partidos hasta el cierre. Después del cierre ya no se puede editar.
--
-- Todas las reglas viven aquí; la app solo las muestra:
--   * Se edita únicamente una polla en borrador o abierta, sin archivar, sin
--     liquidación, sin sorteo de desempate y con closes_at en el futuro
--     (casa_polla_edit_block). Si no: POLLA_NOT_EDITABLE (o POLLA_FINAL desde
--     casa_v2_lock_polla para archivadas/finalizadas).
--   * Nombre y descripción: mientras se pueda editar. El slug no cambia, así el
--     enlace que ya se compartió sigue sirviendo.
--   * Modo de puntaje, entrada, % de la casa, premio, publicación y cuenta de
--     cobro: solo sin inscripciones (pendiente, pagada, rechazada o anulada,
--     todas cuentan). Con una sola: POLLA_HAS_ENTRIES. Reenviar el valor que ya
--     tiene no cuenta como cambio.
--   * Agregar partidos: sin empezar y con saque a más de 5 minutos (la misma
--     condición del candado de pronósticos, 107), tope de 30. Vincular dispara
--     el recálculo del cierre automático de 118.
--   * Quitar partidos: nunca borra ni modifica casa_picks. Un partido con
--     pronósticos en esta polla no se quita (MATCH_HAS_PICKS); anularlo sigue
--     siendo decisión de /admin/issues. Sin pronósticos se desvincula y el
--     cierre automático sigue a los partidos que quedan: trigger AFTER DELETE
--     nuevo (misma forma que el AFTER INSERT de 118) y recálculo explícito.
--   * order_index queda contiguo (0..n-1): los existentes conservan su orden y
--     los nuevos van al final, en el orden en que se eligieron.
--
-- Instalar esta migración no escribe filas. Es idempotente (CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS) para poder encadenarla en la regresión local.
-- Requiere 097–109 y 118.

-- 1) Una sola definición de "esta polla todavía se puede editar".
CREATE OR REPLACE FUNCTION public.casa_polla_edit_block(p_polla public.casa_pollas) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE
    WHEN p_polla.id IS NULL THEN 'NOT_FOUND'
    WHEN p_polla.archived_at IS NOT NULL THEN 'ARCHIVED'
    WHEN p_polla.status IN ('resuelta','anulada') OR p_polla.settled_at IS NOT NULL
      OR p_polla.settlement_outcome IS NOT NULL THEN 'FINAL'
    WHEN EXISTS(SELECT 1 FROM public.casa_object_draws d WHERE d.polla_id=p_polla.id) THEN 'DRAW'
    WHEN p_polla.status NOT IN ('borrador','abierta') OR p_polla.closes_at<=clock_timestamp() THEN 'CLOSED'
  END;
$$;
REVOKE ALL ON FUNCTION public.casa_polla_edit_block(public.casa_pollas) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_polla_edit_block(public.casa_pollas) TO service_role;

-- 2) Lo que muestra el editor: campos editables, el motivo de bloqueo, cuántas
--    inscripciones hay y cuántos pronósticos tiene cada partido en ESTA polla.
--    Solo conteos: ningún dato de participantes.
CREATE OR REPLACE FUNCTION public.casa_polla_editor_v2(p_polla_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
      'ticket_count',p.ticket_count),
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
REVOKE ALL ON FUNCTION public.casa_polla_editor_v2(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_polla_editor_v2(uuid,uuid) TO service_role;

-- 3) El cierre automático también sigue a los partidos cuando se desvincula uno.
--    Igual que el AFTER INSERT de 118: nunca bloquea la escritura que lo dispara.
CREATE OR REPLACE FUNCTION public.casa_auto_close_after_unlink() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.casa_recompute_auto_close(OLD.polla_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN OLD;
  END;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.casa_auto_close_after_unlink() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_auto_close_after_unlink() TO service_role;

DROP TRIGGER IF EXISTS casa_auto_close_on_unlink ON public.casa_polla_matches;
CREATE TRIGGER casa_auto_close_on_unlink
  AFTER DELETE ON public.casa_polla_matches
  FOR EACH ROW EXECUTE FUNCTION public.casa_auto_close_after_unlink();

-- 4) La edición, en UNA transacción: datos, condiciones, partidos y publicación.
--    p_changes solo trae las claves que cambian (camelCase, como la creación).
CREATE OR REPLACE FUNCTION public.casa_edit_polla_v2(p_polla_id uuid,p_changes jsonb,
  p_add_match_ids uuid[],p_remove_match_ids uuid[],p_actor_id uuid,p_contract integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  p public.casa_pollas;
  c jsonb:=coalesce(p_changes,'{}'::jsonb);
  v_block text; v_key text; v_has_entries boolean;
  v_add uuid[]; v_remove uuid[];
  v_name text; v_description text; v_scoring public.casa_scoring_mode; v_price integer; v_cut integer;
  v_prize_kind text; v_pot text; v_fixed bigint; v_object text; v_image text;
  v_method text; v_account text; v_holder text;
  v_pub_mode text; v_pub_at timestamptz; v_pub_change boolean:=false;
  v_fields_change boolean; v_locked_change boolean;
  v_bad uuid; v_count integer; v_next integer; v_added integer:=0; v_removed integer:=0; v_close timestamptz;
BEGIN
  PERFORM public.casa_v2_context(p_contract);
  PERFORM public.casa_v2_admin(p_actor_id,NULL);
  -- Lock the pool first: entries, picks, payments and settlement all take this
  -- same row lock, so nothing can join or pick while the edit is validated.
  p:=public.casa_v2_lock_polla(p_polla_id,true);
  v_block:=public.casa_polla_edit_block(p);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_NOT_EDITABLE',DETAIL=v_block;
  END IF;

  IF jsonb_typeof(c)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(c) LOOP
    IF v_key NOT IN ('name','description','scoringMode','entryPriceCop','houseCutPct','prizeKind','potMode',
      'fixedPrizeCop','prizeObject','prizeImagePath','payoutMethod','payoutAccount','payoutAccountName',
      'publicationMode','publishesAt') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL=v_key;
    END IF;
  END LOOP;

  -- Distinct ids; additions keep the order in which they were chosen.
  SELECT coalesce(array_agg(id ORDER BY first_seen),'{}'::uuid[]) INTO v_add
    FROM (SELECT x AS id,min(o) AS first_seen
            FROM unnest(coalesce(p_add_match_ids,'{}'::uuid[])) WITH ORDINALITY u(x,o)
           WHERE x IS NOT NULL GROUP BY x) s;
  SELECT coalesce(array_agg(DISTINCT x),'{}'::uuid[]) INTO v_remove
    FROM unnest(coalesce(p_remove_match_ids,'{}'::uuid[])) u(x) WHERE x IS NOT NULL;

  -- Name and description.
  IF c ? 'name' THEN
    IF jsonb_typeof(c->'name') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_NAME';
    END IF;
    v_name:=btrim(c->>'name');
    IF length(v_name) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_NAME'; END IF;
  ELSE v_name:=p.name; END IF;
  IF c ? 'description' THEN
    IF jsonb_typeof(c->'description') NOT IN ('string','null') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='description';
    END IF;
    v_description:=nullif(btrim(c->>'description'),'');
    IF length(coalesce(v_description,''))>400 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='description';
    END IF;
  ELSE v_description:=p.description; END IF;

  -- Scoring mode (match pools only).
  IF c ? 'scoringMode' THEN
    IF p.kind<>'partidos' OR coalesce(c->>'scoringMode','') NOT IN ('1x2','marcador') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='scoringMode';
    END IF;
    v_scoring:=(c->>'scoringMode')::public.casa_scoring_mode;
  ELSE v_scoring:=p.scoring_mode; END IF;

  -- Entry price.
  IF c ? 'entryPriceCop' THEN
    IF jsonb_typeof(c->'entryPriceCop') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='entryPriceCop';
    END IF;
    IF (c->>'entryPriceCop')::numeric NOT BETWEEN 0 AND 10000000 OR (c->>'entryPriceCop')::numeric%1<>0 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='entryPriceCop';
    END IF;
    v_price:=(c->>'entryPriceCop')::integer;
  ELSE v_price:=p.entry_price_cop; END IF;

  -- Prize: the six fields move together and are normalized like the creator
  -- (object = 100 % house, no fixed prize; cash pools carry no object).
  IF c ?| ARRAY['prizeKind','potMode','fixedPrizeCop','houseCutPct','prizeObject','prizeImagePath'] THEN
    v_prize_kind:=CASE WHEN c ? 'prizeKind' THEN c->>'prizeKind' ELSE p.prize_kind END;
    IF coalesce(v_prize_kind,'') NOT IN ('pozo','objeto') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='prizeKind';
    END IF;
    IF c ? 'houseCutPct' THEN
      IF jsonb_typeof(c->'houseCutPct') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='houseCutPct';
      END IF;
      IF (c->>'houseCutPct')::numeric NOT BETWEEN 0 AND 100 OR (c->>'houseCutPct')::numeric%1<>0 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='houseCutPct';
      END IF;
      v_cut:=(c->>'houseCutPct')::integer;
    ELSE v_cut:=p.house_cut_pct; END IF;
    IF (c ? 'prizeObject' AND jsonb_typeof(c->'prizeObject') NOT IN ('string','null'))
      OR (c ? 'prizeImagePath' AND jsonb_typeof(c->'prizeImagePath') NOT IN ('string','null')) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='prizeObject';
    END IF;
    IF v_prize_kind='objeto' THEN
      v_cut:=100; v_pot:='proporcional'; v_fixed:=NULL;
      v_object:=CASE WHEN c ? 'prizeObject' THEN nullif(btrim(c->>'prizeObject'),'') ELSE p.prize_object END;
      v_image:=CASE WHEN c ? 'prizeImagePath' THEN nullif(btrim(c->>'prizeImagePath'),'') ELSE p.prize_image_path END;
      IF length(coalesce(v_object,''))<3 OR length(v_object)>160 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OBJECT_REQUIRED';
      END IF;
      -- Only paths issued by /api/casa/admin/prize-image (random name) are accepted.
      IF v_image IS DISTINCT FROM p.prize_image_path AND v_image IS NOT NULL
        AND v_image !~ '^premios/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='prizeImagePath';
      END IF;
    ELSE
      v_pot:=CASE WHEN c ? 'potMode' THEN c->>'potMode' ELSE p.pot_mode END;
      IF coalesce(v_pot,'') NOT IN ('proporcional','fijo') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='potMode';
      END IF;
      IF v_pot='fijo' THEN
        IF c ? 'fixedPrizeCop' THEN
          IF jsonb_typeof(c->'fixedPrizeCop') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
          END IF;
          IF (c->>'fixedPrizeCop')::numeric NOT BETWEEN 1 AND 1000000000 OR (c->>'fixedPrizeCop')::numeric%1<>0 THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE';
          END IF;
          v_fixed:=(c->>'fixedPrizeCop')::bigint;
        ELSE v_fixed:=p.fixed_prize_cop; END IF;
        IF v_fixed IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIXED_PRIZE'; END IF;
      ELSE v_fixed:=NULL; END IF;
      v_object:=NULL; v_image:=NULL;
    END IF;
  ELSE
    v_prize_kind:=p.prize_kind; v_cut:=p.house_cut_pct; v_pot:=p.pot_mode; v_fixed:=p.fixed_prize_cop;
    v_object:=p.prize_object; v_image:=p.prize_image_path;
  END IF;

  -- Payment account: the three fields move together; blank means none.
  IF c ?| ARRAY['payoutMethod','payoutAccount','payoutAccountName'] THEN
    IF (c ? 'payoutMethod' AND jsonb_typeof(c->'payoutMethod') NOT IN ('string','null'))
      OR (c ? 'payoutAccount' AND jsonb_typeof(c->'payoutAccount') NOT IN ('string','null'))
      OR (c ? 'payoutAccountName' AND jsonb_typeof(c->'payoutAccountName') NOT IN ('string','null')) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='payout';
    END IF;
    v_method:=CASE WHEN c ? 'payoutMethod' THEN nullif(btrim(c->>'payoutMethod'),'') ELSE p.payout_method END;
    v_account:=CASE WHEN c ? 'payoutAccount' THEN nullif(btrim(c->>'payoutAccount'),'') ELSE p.payout_account END;
    v_holder:=CASE WHEN c ? 'payoutAccountName' THEN nullif(btrim(c->>'payoutAccountName'),'') ELSE p.payout_account_name END;
    IF length(coalesce(v_method,''))>40 OR length(coalesce(v_account,''))>60 OR length(coalesce(v_holder,''))>80 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='payout';
    END IF;
  ELSE
    v_method:=p.payout_method; v_account:=p.payout_account; v_holder:=p.payout_account_name;
  END IF;

  -- Publication. Only a real change counts (and needs zero entries).
  IF c ? 'publishesAt' AND NOT c ? 'publicationMode' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='publishesAt';
  END IF;
  IF c ? 'publicationMode' THEN
    v_pub_mode:=c->>'publicationMode';
    IF coalesce(v_pub_mode,'') NOT IN ('ahora','programada','oculta') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_CONFIG',DETAIL='publicationMode';
    END IF;
    IF v_pub_mode='programada' THEN
      IF jsonb_typeof(c->'publishesAt') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLICATION_DATE';
      END IF;
      BEGIN
        v_pub_at:=(c->>'publishesAt')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLICATION_DATE';
      END;
    END IF;
    v_pub_change:=CASE v_pub_mode
      WHEN 'oculta' THEN NOT (p.status='borrador' AND p.publication_mode='oculta')
      WHEN 'ahora' THEN NOT (p.status='abierta' AND p.opens_at<=clock_timestamp())
      ELSE NOT (p.status='abierta' AND p.opens_at>clock_timestamp() AND p.opens_at=v_pub_at)
    END;
  END IF;

  v_fields_change:=v_name IS DISTINCT FROM p.name OR v_description IS DISTINCT FROM p.description;
  v_locked_change:=v_scoring IS DISTINCT FROM p.scoring_mode OR v_price IS DISTINCT FROM p.entry_price_cop
    OR v_cut IS DISTINCT FROM p.house_cut_pct OR v_prize_kind IS DISTINCT FROM p.prize_kind
    OR v_pot IS DISTINCT FROM p.pot_mode OR v_fixed IS DISTINCT FROM p.fixed_prize_cop
    OR v_object IS DISTINCT FROM p.prize_object OR v_image IS DISTINCT FROM p.prize_image_path
    OR v_method IS DISTINCT FROM p.payout_method OR v_account IS DISTINCT FROM p.payout_account
    OR v_holder IS DISTINCT FROM p.payout_account_name;
  v_has_entries:=EXISTS(SELECT 1 FROM public.casa_entries e WHERE e.polla_id=p.id);
  IF (v_locked_change OR v_pub_change) AND v_has_entries THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='POLLA_HAS_ENTRIES',
      DETAIL='Con inscripciones no cambian el modo de puntaje, la entrada, el premio, la publicación ni la cuenta de cobro.';
  END IF;

  -- Match changes are validated completely before anything is written.
  IF cardinality(v_add)>0 OR cardinality(v_remove)>0 THEN
    IF p.kind<>'partidos' OR v_add && v_remove THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MATCHES';
    END IF;
    SELECT k.match_id INTO v_bad FROM public.casa_picks k
     WHERE k.polla_id=p.id AND k.match_id=ANY(v_remove) ORDER BY k.match_id LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MATCH_HAS_PICKS',DETAIL=v_bad::text;
    END IF;
    IF (SELECT count(*) FROM public.matches m WHERE m.id=ANY(v_add))<>cardinality(v_add) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_MATCHES';
    END IF;
    SELECT m.id INTO v_bad FROM public.matches m
     WHERE m.id=ANY(v_add)
       AND NOT EXISTS(SELECT 1 FROM public.casa_polla_matches l WHERE l.polla_id=p.id AND l.match_id=m.id)
       AND NOT coalesce(
         (m.status='scheduled' OR (m.status='cancelled' AND coalesce(m.elapsed,0)=0))
         AND m.final_verified_at IS NULL
         AND m.scheduled_at-interval '5 minutes'>clock_timestamp(),false)
     ORDER BY m.scheduled_at,m.id LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MATCH_TOO_SOON',DETAIL=v_bad::text;
    END IF;
    SELECT count(*) INTO v_count FROM public.casa_polla_matches l
     WHERE l.polla_id=p.id AND NOT l.match_id=ANY(v_remove);
    v_count:=v_count+(SELECT count(*) FROM unnest(v_add) a(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.casa_polla_matches l WHERE l.polla_id=p.id AND l.match_id=a.id));
    IF v_count>30 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MATCH_LIMIT'; END IF;
    IF v_count<1 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MATCHES_REQUIRED'; END IF;
  END IF;

  -- Hiding goes first: a hidden pool needs no payment account.
  IF v_pub_change AND v_pub_mode='oculta' THEN
    PERFORM public.casa_set_publication_v2(p.id,'oculta',NULL,p_actor_id,2);
    SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id;
  END IF;

  IF v_fields_change OR v_locked_change THEN
    IF p.status='abierta' AND v_price>0 AND (v_method IS NULL OR v_account IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PAYMENT_ACCOUNT_REQUIRED';
    END IF;
    UPDATE public.casa_pollas SET name=v_name,description=v_description,scoring_mode=v_scoring,
      entry_price_cop=v_price,house_cut_pct=v_cut,prize_kind=v_prize_kind,pot_mode=v_pot,fixed_prize_cop=v_fixed,
      prize_object=v_object,prize_image_path=v_image,payout_method=v_method,payout_account=v_account,
      payout_account_name=v_holder
    WHERE id=p.id;
  END IF;

  IF cardinality(v_add)>0 OR cardinality(v_remove)>0 THEN
    DELETE FROM public.casa_polla_matches WHERE polla_id=p.id AND match_id=ANY(v_remove);
    GET DIAGNOSTICS v_removed=ROW_COUNT;
    SELECT coalesce(max(order_index)+1,0) INTO v_next FROM public.casa_polla_matches WHERE polla_id=p.id;
    INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index)
      SELECT p.id,a.id,v_next+a.o-1
        FROM unnest(v_add) WITH ORDINALITY a(id,o)
       WHERE NOT EXISTS(SELECT 1 FROM public.casa_polla_matches l WHERE l.polla_id=p.id AND l.match_id=a.id)
       ORDER BY a.o;
    GET DIAGNOSTICS v_added=ROW_COUNT;
    UPDATE public.casa_polla_matches l SET order_index=r.rn-1
      FROM (SELECT match_id,row_number() OVER (ORDER BY order_index,match_id) AS rn
              FROM public.casa_polla_matches WHERE polla_id=p.id) r
     WHERE l.polla_id=p.id AND l.match_id=r.match_id AND l.order_index<>r.rn-1;
  END IF;

  -- Publishing re-runs every precondition of casa_change_status_v2 on the
  -- updated row (payment account, prize protocol, at least one match).
  IF v_pub_change AND v_pub_mode<>'oculta' THEN
    PERFORM public.casa_set_publication_v2(p.id,v_pub_mode,v_pub_at,p_actor_id,2);
  END IF;

  IF v_added>0 OR v_removed>0 OR v_pub_change THEN
    PERFORM public.casa_recompute_auto_close(p.id);
  END IF;

  SELECT * INTO p FROM public.casa_pollas WHERE id=p_polla_id;
  IF (v_added>0 OR v_removed>0 OR v_pub_change) AND p.kind='partidos' AND p.close_mode='auto' THEN
    SELECT min(m.scheduled_at)-interval '5 minutes' INTO v_close
      FROM public.casa_polla_matches l JOIN public.matches m ON m.id=l.match_id
     WHERE l.polla_id=p.id AND l.voided_at IS NULL;
    -- 118 refuses to move the close before a scheduled publication: the
    -- first match would start before anyone can see the pool.
    IF v_close IS NOT NULL AND v_close IS DISTINCT FROM p.closes_at THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLICATION_DATE',
        DETAIL='El primer partido empieza antes de la publicación programada.';
    END IF;
  END IF;
  IF v_locked_change AND p.status='abierta' AND p.prize_kind='objeto' AND p.kind<>'rifa'
    AND NOT (SELECT object_draws_enabled FROM public.casa_operation_control WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DRAW_PROTOCOL_PENDING';
  END IF;

  RETURN jsonb_build_object('ok',true,'id',p.id,'slug',p.slug,'status',p.status,
    'publication_mode',p.publication_mode,'opens_at',p.opens_at,'closes_at',p.closes_at,
    'matches',(SELECT count(*) FROM public.casa_polla_matches WHERE polla_id=p.id),
    'added',v_added,'removed',v_removed,
    'changed',v_fields_change OR v_locked_change OR v_pub_change OR v_added>0 OR v_removed>0);
END $$;
REVOKE ALL ON FUNCTION public.casa_edit_polla_v2(uuid,jsonb,uuid[],uuid[],uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.casa_edit_polla_v2(uuid,jsonb,uuid[],uuid[],uuid,integer) TO service_role;
