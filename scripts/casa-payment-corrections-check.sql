-- LOCAL ONLY. Fresh fixtures and all writes roll back. No real predictions.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control),'v2');
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.correction_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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

DO $$
DECLARE admin_id uuid:=gen_random_uuid(); player_id uuid:=gen_random_uuid(); pool_id uuid:=gen_random_uuid();
  proof jsonb; v_attempt_id uuid; entry_id uuid; proof_path text; review_at timestamptz; legacy_id uuid:=gen_random_uuid(); legacy_attempt uuid;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (admin_id,'+1888'||substr(replace(admin_id::text,'-',''),1,10),'Admin correcciones local',true),
    (player_id,'+1777'||substr(replace(player_id::text,'-',''),1,10),'Participante correcciones local',false);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,ticket_count,drawn_number,payout_method,payout_account,draw_method)
    VALUES(pool_id,'corrections-test-'||pool_id,'Correcciones SQL local','rifa','abierta',clock_timestamp()+interval '2 hours',admin_id,10000,100,7,'otro','fixture','Sorteo local');
  proof:=public.casa_begin_entry_proof_v2(pool_id,player_id,gen_random_uuid(),7,repeat('a',64),'image/png',100,2);
  v_attempt_id:=(proof->>'attempt_id')::uuid; entry_id:=(proof->>'entry_id')::uuid; proof_path:=proof->>'proof_path';
  INSERT INTO storage.objects(bucket_id,name) VALUES('payment-proofs',proof_path);
  PERFORM public.casa_confirm_entry_proof_v2(v_attempt_id,player_id,2);
  PERFORM public.casa_review_attempt_v3(v_attempt_id,0,'pagada','Comprobante verificado',2,admin_id);
  SELECT a.reviewed_at INTO review_at FROM public.casa_entry_proof_attempts a WHERE a.id=v_attempt_id;
  ASSERT (SELECT paid_entries FROM public.casa_polla_pot(pool_id))=1;
  PERFORM pg_temp.correction_must_fail(format('SELECT casa_unpay_attempt_v2(%L,0,%L,2,%L)',v_attempt_id,'Error',player_id),'ADMIN_REQUIRED');
  PERFORM pg_temp.correction_must_fail(format('UPDATE casa_entries SET status=''pendiente'' WHERE id=%L',entry_id),'ALREADY_PAID');
  PERFORM public.casa_unpay_attempt_v2(v_attempt_id,0,'Aprobé el comprobante equivocado',2,admin_id);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=entry_id)='pendiente';
  ASSERT (SELECT e.proof_path FROM public.casa_entries e WHERE e.id=entry_id)=proof_path;
  ASSERT (SELECT paid_entries FROM public.casa_polla_pot(pool_id))=0;
  ASSERT (SELECT count(*) FROM public.casa_payment_corrections WHERE casa_payment_corrections.attempt_id=v_attempt_id)=1;
  ASSERT (SELECT previous_reviewed_at FROM public.casa_payment_corrections WHERE casa_payment_corrections.attempt_id=v_attempt_id)=review_at;
  ASSERT (SELECT previous_review_reason FROM public.casa_payment_corrections WHERE casa_payment_corrections.attempt_id=v_attempt_id)='Comprobante verificado';
  ASSERT (public.casa_unpay_attempt_v2(v_attempt_id,0,'Aprobé el comprobante equivocado',2,admin_id)->>'changed')::boolean=false;
  RAISE NOTICE 'PASS correction retains proof, approval metadata and audit; SQL pot excludes pending; retry is idempotent';

  PERFORM pg_temp.correction_must_fail(format('SELECT casa_review_attempt_v3(%L,0,''pagada'',NULL,2,%L)',v_attempt_id,admin_id),'ALREADY_REVIEWED');
  PERFORM pg_temp.correction_must_fail(format('SELECT casa_review_attempt_v2(%L,''pagada'',NULL,2,%L,NULL)',v_attempt_id,admin_id),'UPDATE_REQUIRED');
  PERFORM public.casa_review_attempt_v3(v_attempt_id,1,'pagada','Segunda revisión',2,admin_id);
  PERFORM pg_temp.correction_must_fail(format('SELECT casa_unpay_attempt_v2(%L,0,%L,2,%L)',v_attempt_id,'Corrección vieja',admin_id),'ALREADY_REVIEWED');
  ASSERT (SELECT status FROM public.casa_entries WHERE id=entry_id)='pagada';
  RAISE NOTICE 'PASS stale approval, legacy Telegram callback and stale correction cannot undo newer review';

  -- An old approved receipt can acquire an attempt without changing its payment.
  INSERT INTO public.casa_entries(id,polla_id,user_id,status,amount_cop,ticket_number,proof_path,reviewed_at,reviewed_by)
    VALUES(legacy_id,pool_id,player_id,'pagada',10000,8,'local-legacy/'||legacy_id||'.png',clock_timestamp(),admin_id);
  legacy_attempt:=public.casa_legacy_proof_attempt_v2(legacy_id,2,admin_id,NULL);
  ASSERT (SELECT status FROM public.casa_entries WHERE id=legacy_id)='pagada';
  PERFORM public.casa_unpay_attempt_v2(legacy_attempt,0,'Recibo histórico equivocado',2,admin_id);
  PERFORM public.casa_review_attempt_v3(legacy_attempt,1,'rechazada','Revisado otra vez',2,admin_id);
  RAISE NOTICE 'PASS legacy approved receipt binds its proof and supports the same correction';

  PERFORM public.casa_change_status_v2(pool_id,'cerrar',2,admin_id,NULL);
  PERFORM public.casa_settle_polla_v2(pool_id,2,admin_id,NULL);
  PERFORM pg_temp.correction_must_fail(format('SELECT casa_unpay_attempt_v2(%L,1,%L,2,%L)',v_attempt_id,'Demasiado tarde',admin_id),'POLLA_FINAL');
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=pool_id)=1;
  RAISE NOTICE 'PASS awarded payment cannot return to pending or change the winner';

  ASSERT NOT has_function_privilege('authenticated','public.casa_unpay_attempt_v2(uuid,integer,text,integer,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_review_attempt_v3(uuid,integer,text,text,integer,uuid)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.casa_payment_corrections','SELECT');
  ASSERT NOT has_table_privilege('service_role','public.casa_payment_corrections','UPDATE');
  ASSERT NOT has_table_privilege('service_role','public.casa_payment_corrections','DELETE');
  RAISE NOTICE 'PASS RPC permissions and append-only correction history';
END $$;
ROLLBACK;
