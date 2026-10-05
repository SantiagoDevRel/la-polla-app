-- Disposable local database only. Fresh fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
CREATE FUNCTION pg_temp.must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    ASSERT msg=expected, format('Expected %s, got %s',expected,msg); RETURN;
  END;
  RAISE EXCEPTION 'Expected failure %',expected;
END $$;
DO $$
DECLARE a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  result jsonb; eid uuid; qid uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (a,'+1995'||substr(replace(a::text,'-',''),1,10),'Free fixture admin',true),
    (u,'+1995'||substr(replace(u::text,'-',''),1,10),'Free fixture player',false),
    (other_user,'+1995'||substr(replace(other_user::text,'-',''),1,10),'Other fixture player',false);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,publication_mode,opens_at)
    VALUES(p,'free-'||p,'Free fixture','manual','abierta',clock_timestamp()+interval '1 hour',a,0,'ahora',clock_timestamp());
  INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind) VALUES(qid,p,'Fixture question',3,'texto');
  result:=public.casa_join_free_v1(p,u,2); eid:=(result->>'entry_id')::uuid;
  ASSERT (SELECT status='pagada' AND amount_cop=0 AND proof_path IS NULL FROM public.casa_entries WHERE id=eid);
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,question_id,free_text) VALUES(p,eid,u,qid,'Immediate prediction');
  ASSERT (public.casa_join_free_v1(p,u,2)->>'entry_id')::uuid=eid;
  ASSERT (SELECT count(*)=1 FROM public.casa_entries WHERE polla_id=p AND user_id=u);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,other_user,'pendiente',0) RETURNING id INTO eid;
  ASSERT (public.casa_join_free_v1(p,other_user,2)->>'entry_id')::uuid=eid;
  ASSERT (SELECT status='pagada' FROM public.casa_entries WHERE id=eid), 'Free enrollment left a pending entry blocked';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entry_proof_attempts pa JOIN public.casa_entries e ON e.id=pa.entry_id WHERE e.polla_id=p);
  PERFORM pg_temp.must_fail(format('SELECT public.casa_join_free_v1(%L,NULL,2)',p),'AUTH_REQUIRED');
  UPDATE public.casa_pollas SET entry_price_cop=1000,payout_method='otro',payout_account='fixture' WHERE id=p;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_join_free_v1(%L,%L,2)',p,u),'NOT_FREE');
  UPDATE public.casa_pollas SET entry_price_cop=0,publication_mode='oculta' WHERE id=p;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_join_free_v1(%L,%L,2)',p,u),'POLLA_CLOSED');
  UPDATE public.casa_pollas SET publication_mode='ahora',status='cerrada' WHERE id=p;
  PERFORM pg_temp.must_fail(format('SELECT public.casa_join_free_v1(%L,%L,2)',p,u),'POLLA_CLOSED');
  ASSERT NOT has_function_privilege('anon','public.casa_join_free_v1(uuid,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_join_free_v1(uuid,uuid,integer)','EXECUTE');
  RAISE NOTICE 'PASS immediate free picks, retry idempotence, pending recovery, no proof, auth/payment/publication/closure guards and RPC ACL';
END $$;
ROLLBACK;
