-- LOCAL DOCKER ONLY. Migración 131: varias participaciones por persona.
-- Fixtures nuevos; todo se revierte al final. No toca predictions reales.
--   docker exec -i supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1 < scripts/casa-multi-entries-check.sql
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_transition_mode((SELECT mode FROM public.casa_operation_control),'v2');
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.multi_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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

-- Begin + upload + confirm one proof; returns the begin payload.
CREATE FUNCTION pg_temp.multi_send(p_polla uuid, p_user uuid, p_number integer, p_sha text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r:=public.casa_begin_entry_proof_v3(p_polla,p_user,gen_random_uuid(),NULL,p_number,repeat(p_sha,64),'image/png',100,2);
  INSERT INTO storage.objects(bucket_id,name) VALUES('payment-proofs',r->>'proof_path');
  PERFORM public.casa_confirm_entry_proof_v2((r->>'attempt_id')::uuid,p_user,2);
  RETURN r;
END $$;

CREATE FUNCTION pg_temp.multi_review(p_entry uuid, p_decision text, p_admin uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a uuid; rev integer;
BEGIN
  SELECT e.current_proof_attempt_id,x.review_revision INTO a,rev FROM public.casa_entries e
    JOIN public.casa_entry_proof_attempts x ON x.id=e.current_proof_attempt_id WHERE e.id=p_entry;
  PERFORM public.casa_review_attempt_v3(a,rev,p_decision,CASE WHEN p_decision='rechazada' THEN 'Monto incorrecto' END,2,p_admin);
END $$;

DO $$
DECLARE admin_id uuid:=gen_random_uuid(); ana uuid:=gen_random_uuid(); beto uuid:=gen_random_uuid();
  p uuid:=gen_random_uuid(); mid uuid; r jsonb; e1 uuid; e2 uuid; e3 uuid; b1 uuid; settle jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (admin_id,'+1866'||substr(replace(admin_id::text,'-',''),1,10),'Admin multi local',true),
    (ana,'+1855'||substr(replace(ana::text,'-',''),1,10),'Ana multi local',false),
    (beto,'+1844'||substr(replace(beto::text,'-',''),1,10),'Beto multi local',false);
  mid:=public.upsert_match_safe('casa-multi-'||p,'local_casa_multi',1,'league','Home '||p,'Away '||p,
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,
      house_cut_pct,payout_method,payout_account,max_entries_per_user)
    VALUES(p,'multi-'||p,'Ofigolazo local','partidos','local_casa_multi','marcador','abierta',clock_timestamp()+interval '1 hour',
      admin_id,20000,30,'nequi','fixture',3);
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);

  -- 1) Tres participaciones, cada una con su transferencia y su comprobante.
  r:=pg_temp.multi_send(p,ana,NULL,'a'); e1:=(r->>'entry_id')::uuid;
  ASSERT (r->>'entry_number')::integer=1, 'first participation must be #1';
  r:=pg_temp.multi_send(p,ana,NULL,'b'); e2:=(r->>'entry_id')::uuid;
  ASSERT (r->>'entry_number')::integer=2, 'second participation must be #2';
  ASSERT e1<>e2;
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,NULL,%L,''image/png'',100,2)',
    p,ana,gen_random_uuid(),repeat('a',64)),'DUPLICATE_PROOF');
  r:=pg_temp.multi_send(p,ana,NULL,'c'); e3:=(r->>'entry_id')::uuid;
  ASSERT (r->>'entry_number')::integer=3;
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,NULL,%L,''image/png'',100,2)',
    p,ana,gen_random_uuid(),repeat('d',64)),'MAX_ENTRIES');
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,7,%L,''image/png'',100,2)',
    p,ana,gen_random_uuid(),repeat('d',64)),'ENTRY_NOT_FOUND');
  PERFORM pg_temp.multi_must_fail(format('INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,entry_number) VALUES(%L,%L,''pendiente'',20000,2)',
    p,ana),'casa_entries_user_entry_number');
  PERFORM pg_temp.multi_must_fail(format('INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number,entry_number) VALUES(%L,%L,''pendiente'',20000,5,1)',
    p,ana),'casa_entries_entry_number_shape');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,admin_id,'anulada',20000),(p,admin_id,'anulada',20000);
  ASSERT (SELECT array_agg(entry_number ORDER BY entry_number) FROM public.casa_entries WHERE polla_id=p AND user_id=admin_id)=ARRAY[1,2]::smallint[],
    'direct inserts must receive consecutive numbers';
  DELETE FROM public.casa_entries WHERE polla_id=p AND user_id=admin_id;
  RAISE NOTICE 'PASS one proof per participation: numbering, duplicate receipt, per-person cap, unknown number, unique index';

  -- 2) Pronósticos independientes por participación, antes de la aprobación.
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES
    (p,e1,ana,mid,2,1),(p,e2,ana,mid,1,1),(p,e3,ana,mid,1,1);
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE polla_id=p AND user_id=ana)=3;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_leaderboard(p)), 'unapproved participations must not appear in the table';
  ASSERT (SELECT paid_entries FROM public.casa_polla_pot(p))=0;
  RAISE NOTICE 'PASS picks per participation while payment is in review; nothing counts yet';

  -- 3) El administrador decide comprobante por comprobante.
  PERFORM pg_temp.multi_review(e1,'pagada',admin_id);
  ASSERT (SELECT count(*) FROM public.casa_leaderboard(p))=1;
  ASSERT (SELECT paid_entries FROM public.casa_polla_pot(p))=1;
  PERFORM pg_temp.multi_review(e2,'pagada',admin_id);
  PERFORM pg_temp.multi_review(e3,'rechazada',admin_id);
  ASSERT (SELECT count(*) FROM public.casa_leaderboard(p))=2;
  ASSERT (SELECT bool_and(user_entries=2) FROM public.casa_leaderboard(p));
  ASSERT (SELECT array_agg(entry_number ORDER BY entry_number) FROM public.casa_leaderboard(p))=ARRAY[1,2];
  ASSERT (SELECT gross_cop FROM public.casa_polla_pot(p))=40000;
  -- A rejected participation still counts toward the cap: it is retried in place.
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,NULL,%L,''image/png'',100,2)',
    p,ana,gen_random_uuid(),repeat('e',64)),'MAX_ENTRIES');
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_begin_entry_proof_v3(%L,%L,%L,NULL,1,%L,''image/png'',100,2)',
    p,ana,gen_random_uuid(),repeat('e',64)),'ALREADY_PAID');
  r:=pg_temp.multi_send(p,ana,3,'f');
  ASSERT (r->>'entry_id')::uuid=e3 AND (SELECT status FROM public.casa_entries WHERE id=e3)='pendiente';
  ASSERT (SELECT home_score FROM public.casa_picks WHERE entry_id=e3)=1, 'retrying a proof keeps its picks';
  RAISE NOTICE 'PASS one-by-one approvals, rejection retried on the same participation with its picks';

  -- 4) Compatibilidad v2 (bot y clientes viejos) y reuso de una carga fallida.
  r:=public.casa_begin_entry_proof_v2(p,beto,gen_random_uuid(),NULL,repeat('1',64),'image/png',100,2);
  ASSERT (r->>'entry_number')::integer=1;
  INSERT INTO storage.objects(bucket_id,name) VALUES('payment-proofs',r->>'proof_path');
  PERFORM public.casa_confirm_entry_proof_v2((r->>'attempt_id')::uuid,beto,2);
  b1:=(r->>'entry_id')::uuid;
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_begin_entry_proof_v2(%L,%L,%L,NULL,%L,''image/png'',100,2)',
    p,beto,gen_random_uuid(),repeat('2',64)),'PROOF_IN_REVIEW');
  r:=public.casa_begin_entry_proof_v3(p,beto,gen_random_uuid(),NULL,NULL,repeat('3',64),'image/png',100,2);
  ASSERT (r->>'entry_number')::integer=2;
  ASSERT public.casa_fail_entry_proof_v2((r->>'attempt_id')::uuid,beto,2);
  r:=public.casa_begin_entry_proof_v3(p,beto,gen_random_uuid(),NULL,NULL,repeat('4',64),'image/png',100,2);
  ASSERT (r->>'entry_number')::integer=2, 'a failed upload number is reused';
  ASSERT public.casa_fail_entry_proof_v2((r->>'attempt_id')::uuid,beto,2);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p AND user_id=beto)=2;
  PERFORM pg_temp.multi_review(b1,'pagada',admin_id);
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,b1,beto,mid,1,1);
  PERFORM pg_temp.multi_review(e3,'pagada',admin_id);
  RAISE NOTICE 'PASS v2 keeps single-entry behaviour; failed uploads do not consume numbers';

  -- 5) Tope editable solo por administradores; bajar el tope no borra nada.
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_set_max_entries_v2(%L,5,%L,2)',p,ana),'ADMIN_REQUIRED');
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_set_max_entries_v2(%L,0,%L,2)',p,admin_id),'INVALID_MAX_ENTRIES');
  ASSERT (public.casa_set_max_entries_v2(p,1,admin_id,2)->>'changed')::boolean;
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p AND user_id=ana)=3;
  ASSERT (public.casa_polla_editor_v2(p,admin_id)->'polla'->>'max_entries_per_user')::integer=1;
  r:=public.casa_create_polla_v2(jsonb_build_object('name','Tope local','kind','manual','prizeKind','pozo','entryPriceCop',0,
    'houseCutPct',0,'closesAt',clock_timestamp()+interval '1 day','publicationMode','oculta','closeMode','manual','maxEntriesPerUser',4,
    'questions',jsonb_build_array(jsonb_build_object('prompt','¿Quién gana?','points',3,'inputKind','opciones','options',jsonb_build_array('A','B')))),
    'tope-'||p,admin_id,2);
  ASSERT (SELECT max_entries_per_user FROM public.casa_pollas WHERE id=(r->>'id')::uuid)=4, 'creation stores the cap';
  r:=public.casa_create_polla_v2(jsonb_build_object('name','Tope defecto','kind','manual','prizeKind','pozo','entryPriceCop',0,
    'houseCutPct',0,'closesAt',clock_timestamp()+interval '1 day','publicationMode','oculta','closeMode','manual',
    'questions',jsonb_build_array(jsonb_build_object('prompt','¿Quién gana?','points',3,'inputKind','opciones','options',jsonb_build_array('A','B')))),
    'tope-def-'||p,admin_id,2);
  ASSERT (SELECT max_entries_per_user FROM public.casa_pollas WHERE id=(r->>'id')::uuid)=10, 'creation defaults the cap to 10';
  PERFORM pg_temp.multi_must_fail(format('SELECT public.casa_create_polla_v2(%L::jsonb,%L,%L,2)',
    jsonb_build_object('name','Tope malo','kind','manual','prizeKind','pozo','entryPriceCop',0,'houseCutPct',0,
      'closesAt',clock_timestamp()+interval '1 day','publicationMode','oculta','closeMode','manual','maxEntriesPerUser',0,
      'questions',jsonb_build_array(jsonb_build_object('prompt','x','points',3,'inputKind','opciones','options',jsonb_build_array('A','B')))),
    'tope-malo-'||p,admin_id),'INVALID_MAX_ENTRIES');
  RAISE NOTICE 'PASS admin-only cap setter, existing participations preserved, editor exposes the cap';

  -- 6) Reparto: el pozo se divide por participación ganadora, se paga por persona.
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  UPDATE public.matches SET status='finished',home_score=1,away_score=1,final_verified_at=clock_timestamp() WHERE id=mid;
  ASSERT (SELECT points FROM public.casa_leaderboard(p) WHERE entry_id=e2)=3;
  ASSERT (SELECT points FROM public.casa_leaderboard(p) WHERE entry_id=e1)=1;
  ASSERT (SELECT count(*) FROM public.casa_leaderboard(p) WHERE puesto=1)=3;
  settle:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT settle->>'outcome'='money_awarded', settle::text;
  ASSERT (settle->>'prize_cop')::bigint=56000, settle::text;
  ASSERT (settle->>'winners')::integer=2 AND (settle->>'winning_entries')::integer=3, settle::text;
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=p)=2;
  ASSERT (SELECT sum(amount_cop) FROM public.casa_payouts WHERE polla_id=p)=56000;
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id=p AND user_id=ana) BETWEEN 37332 AND 37334;
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id=p AND user_id=beto) BETWEEN 18666 AND 18667;
  ASSERT (SELECT note FROM public.casa_payouts WHERE polla_id=p AND user_id=ana) LIKE '%2 participaciones ganadoras%';
  RAISE NOTICE 'PASS settlement splits by winning participation, one payout per person, exact total';

  ASSERT NOT has_function_privilege('authenticated','public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_set_max_entries_v2(uuid,integer,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_leaderboard(uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.casa_begin_entry_proof_v3(uuid,uuid,uuid,integer,integer,text,text,integer,integer)','EXECUTE');
  RAISE NOTICE 'PASS server-only permissions';
END $$;

-- Objeto: empate entre participaciones de UNA persona no abre sorteo.
DO $$
DECLARE admin_id uuid:=gen_random_uuid(); ana uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); mid uuid; e1 uuid; e2 uuid; settle jsonb;
BEGIN
  UPDATE public.casa_operation_control SET object_draws_enabled=true WHERE singleton;
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (admin_id,'+1833'||substr(replace(admin_id::text,'-',''),1,10),'Admin objeto local',true),
    (ana,'+1822'||substr(replace(ana::text,'-',''),1,10),'Ana objeto local',false);
  mid:=public.upsert_match_safe('casa-mobj-'||p,'local_casa_multi',1,'league','Obj H '||left(p::text,8),'Obj A '||left(p::text,8),
    NULL,NULL,clock_timestamp()+interval '2 hours',NULL,NULL,NULL,'scheduled',NULL,NULL,NULL);
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,status,closes_at,created_by,entry_price_cop,
      house_cut_pct,prize_kind,prize_object,payout_method,payout_account)
    VALUES(p,'multi-obj-'||p,'Camiseta local','partidos','local_casa_multi','marcador','abierta',clock_timestamp()+interval '1 hour',
      admin_id,20000,100,'objeto','Camiseta','nequi','fixture');
  INSERT INTO public.casa_polla_matches(polla_id,match_id) VALUES(p,mid);
  e1:=(pg_temp.multi_send(p,ana,NULL,'7')->>'entry_id')::uuid;
  e2:=(pg_temp.multi_send(p,ana,NULL,'8')->>'entry_id')::uuid;
  INSERT INTO public.casa_picks(polla_id,entry_id,user_id,match_id,home_score,away_score) VALUES(p,e1,ana,mid,2,0),(p,e2,ana,mid,2,0);
  PERFORM pg_temp.multi_review(e1,'pagada',admin_id);
  PERFORM pg_temp.multi_review(e2,'pagada',admin_id);
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  UPDATE public.matches SET status='finished',home_score=2,away_score=0,final_verified_at=clock_timestamp() WHERE id=mid;
  settle:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT settle->>'outcome'='object_awarded', settle::text;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_object_draws WHERE polla_id=p);
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=p AND user_id=ana AND prize_kind='objeto' AND amount_cop=0)=1;
  RAISE NOTICE 'PASS object tie between one person''s participations awards that person without a draw';
END $$;
ROLLBACK;
