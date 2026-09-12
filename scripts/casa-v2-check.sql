-- LOCAL ONLY: executed by scripts/casa-v2-check.mjs against the local Docker DB.
-- Every fixture has a fresh UUID and the entire suite rolls back. No cleanup
-- of existing rows, no matches or historical predictions are touched.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control),'v2');
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    IF position(expected IN msg)=0 THEN RAISE EXCEPTION 'Expected %, got %',expected,msg; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %, but operation succeeded',expected;
END $$;

CREATE FUNCTION pg_temp.manual_pool(admin_id uuid, players uuid[], object_prize boolean, tied boolean, zero_points boolean)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); yes_id uuid:=gen_random_uuid(); no_id uuid:=gen_random_uuid();
  e uuid; i integer;
BEGIN
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,prize_kind,prize_object)
    VALUES(p,'v2-test-'||p,'Prueba local','manual','abierta',clock_timestamp()+interval '2 hours',admin_id,10001,'otro','fixture',
      CASE WHEN object_prize THEN 'objeto' ELSE 'pozo' END,CASE WHEN object_prize THEN 'Camiseta de prueba' END);
  INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind) VALUES(q,p,'Respuesta',3,'opciones');
  INSERT INTO public.casa_options(id,question_id,label) VALUES(yes_id,q,'Sí'),(no_id,q,'No');
  FOR i IN 1..array_length(players,1) LOOP
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
      VALUES(p,players[i],CASE WHEN i<=3 THEN 'pagada'::public.casa_entry_status ELSE 'pendiente'::public.casa_entry_status END,10001) RETURNING id INTO e;
    INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id)
      VALUES(e,p,players[i],q,CASE WHEN NOT zero_points AND (tied OR i=1) THEN yes_id ELSE no_id END);
  END LOOP;
  PERFORM public.casa_resolve_question_v2(p,q,yes_id,NULL,2,admin_id,NULL);
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  RETURN p;
END $$;

DO $$
DECLARE admin_id uuid:=gen_random_uuid(); players uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  uid uuid; p uuid; r jsonb; d uuid; a jsonb; b jsonb; n integer; e uuid; aid uuid; rid uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(admin_id,'+1999'||substr(replace(admin_id::text,'-',''),1,10),'Admin SQL local',true);
  FOREACH uid IN ARRAY players LOOP
    INSERT INTO public.users(id,whatsapp_number,display_name) VALUES(uid,'+1999'||substr(replace(uid::text,'-',''),1,10),'Participante SQL local');
  END LOOP;
  r:=public.casa_create_polla_v2(jsonb_build_object('name','Creación atómica','kind','manual','prizeKind','pozo',
    'entryPriceCop',1000,'houseCutPct',30,'closesAt',clock_timestamp()+interval '1 hour','closeMode','manual',
    'publish',true,'payoutMethod','otro','payoutAccount','fixture','questions',
    jsonb_build_array(jsonb_build_object('prompt','Pregunta local','points',3,'inputKind','opciones','options',jsonb_build_array('Sí','No')))),
    'v2-create-'||gen_random_uuid(),admin_id,2);
  ASSERT (r->>'publicada')::boolean;
  ASSERT (SELECT count(*) FROM public.casa_questions WHERE polla_id=(r->>'id')::uuid)=1;
  UPDATE public.casa_operation_control SET object_draws_enabled=false;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_create_polla_v2(%L::jsonb,%L,%L,2)',
    jsonb_build_object('name','Objeto sin protocolo','kind','manual','prizeKind','objeto','prizeObject','Camiseta',
      'entryPriceCop',1000,'houseCutPct',30,'closesAt',clock_timestamp()+interval '1 hour','closeMode','manual','publish',true),
    'v2-denied-'||gen_random_uuid(),admin_id),'DRAW_PROTOCOL_PENDING');
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pollas WHERE name='Objeto sin protocolo');
  RAISE NOTICE 'PASS atomic manual creation and protocol publication gate';
  p:=pg_temp.manual_pool(admin_id,players,false,false,false);
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,1,%L,NULL)',p,admin_id),'UPDATE_REQUIRED');
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,players[1]),'ADMIN_REQUIRED');
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT r->>'outcome'='money_awarded';
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=p)=1;
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id=p)=21002;
  ASSERT (SELECT user_id FROM public.casa_payouts WHERE polla_id=p)=players[1];
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,admin_id),'POLLA_FINAL');
  RAISE NOTICE 'PASS money winner, authorization, contract, duplicate settlement';

  p:=pg_temp.manual_pool(admin_id,players,false,true,false);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=p)=3;
  ASSERT (SELECT sum(amount_cop) FROM public.casa_payouts WHERE polla_id=p)=21002;
  ASSERT (SELECT max(amount_cop)-min(amount_cop) FROM public.casa_payouts WHERE polla_id=p)=1;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p AND user_id=players[4]);
  RAISE NOTICE 'PASS tie remainder and unpaid exclusion';

  p:=pg_temp.manual_pool(admin_id,players,false,false,true);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT r->>'outcome'='house_retained_zero_points';
  ASSERT (SELECT status FROM public.casa_pollas WHERE id=p)='resuelta';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p);
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,admin_id),'POLLA_FINAL');
  RAISE NOTICE 'PASS zero points is terminal with no payout';

  p:=pg_temp.manual_pool(admin_id,players,true,false,false);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT r->>'outcome'='object_awarded';
  ASSERT (SELECT amount_cop=0 AND prize_object='Camiseta de prueba' AND paid_at IS NULL FROM public.casa_payouts WHERE polla_id=p);
  SELECT id INTO aid FROM public.casa_payouts WHERE polla_id=p;
  r:=public.casa_record_delivery_v2(aid,'Entregada',admin_id,2);
  ASSERT r=public.casa_record_delivery_v2(aid,'Texto de otro retry',admin_id,2);
  RAISE NOTICE 'PASS object award, no cash, immutable delivery';

  p:=pg_temp.manual_pool(admin_id,players,true,true,false);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL); d:=(r->>'draw_id')::uuid;
  ASSERT r->>'outcome'='object_draw_pending';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p);
  ASSERT (SELECT count(*) FROM public.casa_object_draw_candidates WHERE draw_id=d)=3;
  ASSERT (public.casa_settle_polla_v2(p,2,admin_id,NULL)->>'draw_id')::uuid=d;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_archive_polla_v2(%L,%L,2)',p,admin_id),'DRAW_PENDING');
  PERFORM pg_temp.must_fail(format('UPDATE public.casa_pollas SET archived_at=clock_timestamp() WHERE id=%L',p),'DRAW_PENDING');
  PERFORM pg_temp.must_fail(format('UPDATE public.casa_entries SET status=''pagada'' WHERE polla_id=%L AND user_id=%L',p,players[4]),'DRAW_PENDING');
  ASSERT public.casa_score_polla(p)=0;
  UPDATE public.casa_operation_control SET object_draws_enabled=true;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_begin_draw_confirmation_v2(%L,%L,%L,%L,''video/mp4'',100,%L,2)',d,players[4],gen_random_uuid(),repeat('a',64),admin_id),'INVALID_DRAW_WINNER');
  rid:=gen_random_uuid();
  a:=public.casa_begin_draw_confirmation_v2(d,players[2],rid,repeat('a',64),'video/mp4',100,admin_id,2);
  ASSERT a=public.casa_begin_draw_confirmation_v2(d,players[2],rid,repeat('a',64),'video/mp4',100,admin_id,2);
  PERFORM pg_temp.must_fail(format('SELECT public.casa_confirm_object_draw_v2(%L,%L,2)',a->>'attempt_id',admin_id),'EVIDENCE_NOT_UPLOADED');
  INSERT INTO storage.objects(bucket_id,name) VALUES('casa-draw-evidence',a->>'evidence_path');
  r:=public.casa_confirm_object_draw_v2((a->>'attempt_id')::uuid,admin_id,2);
  ASSERT (r->>'winner_id')::uuid=players[2];
  ASSERT (public.casa_confirm_object_draw_v2((a->>'attempt_id')::uuid,admin_id,2)->>'changed')::boolean=false;
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=p)=1;
  ASSERT (SELECT count(*) FROM public.casa_object_draw_candidates WHERE draw_id=d)=3;
  PERFORM public.casa_archive_polla_v2(p,admin_id,2);
  RAISE NOTICE 'PASS pending draw freeze, evidence recovery, exact winner, archive after resolution';

  p:=gen_random_uuid();
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,ticket_count,draw_method)
    VALUES(p,'v2-rifa-'||p,'Rifa local','rifa','abierta',clock_timestamp()+interval '2 hours',admin_id,10001,'otro','fixture',100,'Sorteo');
  a:=public.casa_begin_entry_proof_v2(p,players[1],gen_random_uuid(),7,repeat('b',64),'image/png',100,2);
  PERFORM public.casa_fail_entry_proof_v2((a->>'attempt_id')::uuid,players[1],2);
  FOR n IN 8..100 LOOP
    PERFORM pg_temp.must_fail(format('SELECT public.casa_begin_entry_proof_v2(%L,%L,%L,%s,%L,''image/png'',100,2)',p,players[1],gen_random_uuid(),n,repeat('b',64)),'PREVIOUS_TICKET_PENDING');
  END LOOP;
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p)=1;
  -- Historical multiple failed tickets remain individually recoverable.
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number)
    VALUES(p,players[1],'anulada',10001,8);

  e:=(a->>'entry_id')::uuid; aid:=(a->>'attempt_id')::uuid;
  a:=public.casa_begin_entry_proof_v2(p,players[1],gen_random_uuid(),7,repeat('b',64),'image/png',100,2);
  ASSERT (a->>'entry_id')::uuid=e;
  ASSERT NOT public.casa_fail_entry_proof_v2(aid,players[1],2);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p)=2;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p AND ticket_number IS NULL);
  PERFORM pg_temp.must_fail(format('SELECT public.casa_begin_entry_proof_v2(%L,%L,%L,7,%L,''image/png'',100,2)',p,players[2],gen_random_uuid(),repeat('b',64)),'TICKET_UNAVAILABLE');
  -- Closing must preserve the existing 15-minute attempt and same-file recovery.
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  b:=public.casa_begin_entry_proof_v2(p,players[1],gen_random_uuid(),7,repeat('b',64),'image/png',100,2);
  ASSERT b->>'attempt_id'=a->>'attempt_id';
  ASSERT EXISTS(SELECT 1 FROM public.casa_active_proofs_v2(p,players[1]));
  PERFORM pg_temp.must_fail(format('SELECT public.casa_begin_entry_proof_v2(%L,%L,%L,9,%L,''image/png'',100,2)',p,players[2],gen_random_uuid(),repeat('b',64)),'INSCRIPTIONS_CLOSED');
  INSERT INTO storage.objects(bucket_id,name) VALUES('payment-proofs',a->>'proof_path');
  r:=public.casa_confirm_entry_proof_v2((a->>'attempt_id')::uuid,players[1],2);
  ASSERT public.casa_begin_entry_proof_v2(p,players[1],gen_random_uuid(),7,repeat('b',64),'image/png',100,2)->>'state'='confirmed';
  PERFORM pg_temp.must_fail(format('UPDATE public.casa_entries SET proof_path=''another.webp'' WHERE id=%L',e),'PROOF_ATTEMPT_MISMATCH');
  UPDATE public.casa_entry_proof_attempts SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=(a->>'attempt_id')::uuid;
  PERFORM public.casa_review_attempt_v2((a->>'attempt_id')::uuid,'pagada',NULL,2,admin_id,NULL);
  ASSERT NOT public.casa_fail_entry_proof_v2((a->>'attempt_id')::uuid,players[1],2);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=e)='pagada';
  r:=public.casa_ticket_availability_v2(p,players[2],7,2);
  ASSERT r->'tickets'->0->>'state'='unavailable' AND r->'tickets'->1->>'state'='unavailable';
  r:=public.casa_ticket_availability_v2(p,players[1],7,2);
  ASSERT r->'tickets'->0->>'state'='paid' AND r->'tickets'->1->>'state'='resume';
  ASSERT public.casa_my_entry_v2(p,players[1])->>'status'='pagada';
  PERFORM public.casa_set_drawn_number_v2(p,9,2,admin_id,NULL);
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,admin_id),'UNSOLD_TICKET');
  PERFORM public.casa_set_drawn_number_v2(p,7,2,admin_id,NULL);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT (r->>'prize_cop')::integer=7000;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_set_drawn_number_v2(%L,8,2,%L,NULL)',p,admin_id),'POLLA_FINAL');
  RAISE NOTICE 'PASS ticket recovery, stale failure, expiry only before confirmation, availability, raffle freeze';
END $$;
DO $$
DECLARE aid uuid:=gen_random_uuid(); uid uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); r jsonb; n integer;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES(aid,'+1666'||substr(replace(aid::text,'-',''),1,10),'Admin agregado local',true);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account)
    VALUES(p,'v2-bulk-'||p,'Agregado local','manual','abierta',clock_timestamp()+interval '2 hours',aid,10001,'otro','fixture');
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla(%L)',p),'UPDATE_REQUIRED');
  FOR n IN 1..1005 LOOP
    uid:=gen_random_uuid();
    INSERT INTO public.users(id,whatsapp_number,display_name) VALUES(uid,'+1555'||substr(replace(uid::text,'-',''),1,10),'Participante agregado');
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,uid,'pagada',10001);
  END LOOP;
  r:=public.casa_payment_details_v2(p,NULL);
  ASSERT (r->>'paid_entries')::integer=1005;
  ASSERT (r->>'gross_cop')::bigint=10051005;
  ASSERT (r->>'prize_cop')::bigint=7035703;
  ASSERT NOT has_function_privilege('anon','public.casa_settle_polla_v2(uuid,integer,uuid,bigint)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_review_attempt_v2(uuid,text,text,integer,uuid,bigint)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.casa_object_draw_candidates','SELECT');
  ASSERT NOT has_table_privilege('anon','public.casa_draw_confirmation_attempts','SELECT');
  RAISE NOTICE 'PASS >1000 entry aggregation, legacy preflight rejection, table/RPC access';
END $$;
-- Isolate deployment phases by changing only our local singleton inside this
-- rollback transaction. No production state or concurrent traffic is involved.
DO $$
DECLARE aid uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
BEGIN
  UPDATE public.casa_operation_control SET mode='legacy';
  PERFORM set_config('app.casa_contract','',true);
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES(aid,'+1222'||substr(replace(aid::text,'-',''),1,10),'Admin fases local',true);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,payout_method,payout_account,ticket_count,drawn_number,draw_method)
    VALUES(p,'v2-phases-'||p,'Fases locales','rifa','abierta',clock_timestamp()+interval '2 hours',aid,10000,'otro','fixture',10,7,'Sorteo local');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number) VALUES(p,aid,'pagada',10000,7);
  UPDATE public.casa_pollas SET status='cerrada' WHERE id=p;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,aid),'OPERATIONS_PAUSED');
  PERFORM public.casa_transition_mode('legacy','paused');
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla(%L)',p),'OPERATIONS_PAUSED');
  PERFORM pg_temp.must_fail(format('UPDATE public.casa_pollas SET drawn_number=8 WHERE id=%L',p),'OPERATIONS_PAUSED');
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,aid),'OPERATIONS_PAUSED');
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p);
  PERFORM public.casa_transition_mode('paused','v2');
  PERFORM pg_temp.must_fail(format('SELECT public.casa_settle_polla(%L)',p),'UPDATE_REQUIRED');
  PERFORM pg_temp.must_fail(format('UPDATE public.casa_pollas SET drawn_number=8 WHERE id=%L',p),'UPDATE_REQUIRED');
  PERFORM public.casa_settle_polla_v2(p,2,aid,NULL);
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id=p)=7000;
  RAISE NOTICE 'PASS legacy/paused/v2 consumer matrix and direct old writer rejection';
END $$;
ROLLBACK;
