-- LOCAL ONLY: random fixture IDs, no reused rows, all changes roll back.
-- Get-Content -Raw -Encoding UTF8 scripts/casa-object-result-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.casa_contract','2',true);
DO $$
DECLARE a uuid:=gen_random_uuid(); u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid();
  p uuid:=gen_random_uuid(); p0 uuid:=gen_random_uuid(); m1 uuid:=gen_random_uuid(); m2 uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); e3 uuid:=gen_random_uuid(); issue uuid:=gen_random_uuid(); r jsonb;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin) VALUES
    (a,'+19991'||floor(random()*1000000000)::text,'Admin resultado SQL',true),
    (u1,'+19992'||floor(random()*1000000000)::text,'Zeta registro anterior',false),
    (u2,'+19993'||floor(random()*1000000000)::text,'Alfa registro posterior',false);
  INSERT INTO public.matches(id,external_id,tournament,home_team,away_team,scheduled_at,status) VALUES
    (m1,'test-object:'||m1,'premier_2025','Local SQL uno','Visita SQL uno',now()+interval '2 hours','scheduled'),
    (m2,'test-object:'||m2,'premier_2025','Local SQL dos','Visita SQL dos',now()+interval '3 hours','scheduled');
  INSERT INTO public.casa_pollas(id,slug,name,kind,tournament,scoring_mode,entry_price_cop,prize_kind,prize_object,status,opens_at,closes_at,created_by,points_exact,points_one_team)
    VALUES(p,'test-object-'||p,'Premio SQL','partidos','premier_2025','marcador',0,'objeto','Dos boletas','abierta',now()-interval '1 hour',now()+interval '1 hour',a,3,0),
      (p0,'test-object-'||p0,'Cero SQL','partidos','premier_2025','marcador',0,'objeto','Dos boletas','abierta',now()-interval '1 hour',now()+interval '1 hour',a,3,0);
  INSERT INTO public.casa_polla_matches(polla_id,match_id,order_index) VALUES(p,m1,0),(p,m2,1),(p0,m1,0);
  INSERT INTO public.casa_entries(id,polla_id,user_id,status,amount_cop,entry_number,created_at) VALUES
    (e1,p,u1,'pagada',0,1,now()-interval '2 hours'),
    (e2,p,u2,'pagada',0,1,now()-interval '1 hour'),
    (e3,p,a,'pendiente',0,1,now());
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,entry_number) VALUES(p0,u1,'pagada',0,1);
  INSERT INTO public.casa_picks(entry_id,polla_id,user_id,match_id,home_score,away_score) VALUES
    (e1,p,u1,m1,2,1),(e2,p,u2,m1,2,1),(e1,p,u1,m2,1,0),(e2,p,u2,m2,1,0);
  UPDATE public.matches SET scheduled_at=now()-interval '3 hours',status='finished',home_score=2,away_score=1,final_verified_at=now() WHERE id=m1;
  UPDATE public.casa_pollas SET closes_at=now()-interval '1 hour' WHERE id IN (p,p0);
  ASSERT public.casa_object_result_v1(p)->>'state'='waiting','unverified final match must block';
  ASSERT public.casa_object_result_v1(p0)->>'state'='no_winner','zero points is never a winner';
  UPDATE public.matches SET scheduled_at=now()-interval '2 hours',status='finished',home_score=1,away_score=0,final_verified_at=now() WHERE id=m2;
  r:=public.casa_object_result_v1(p);
  ASSERT r->>'state'='ready',format('all verified should be ready: %s',r);
  ASSERT r->'winner'->>'user_id'=u1::text,'oldest entry wins, not alphabetical leaderboard order';
  ASSERT (r->'winner'->>'points')::integer=6,'read uses points from verification trigger';
  ASSERT (r->>'tied')::boolean,'registration tiebreak must be identified';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p),'preview cannot adjudicate';
  ASSERT (SELECT status='abierta' FROM public.casa_pollas WHERE id=p),'preview cannot close';

  UPDATE public.casa_entries SET proof_path='local-test/receipt.png' WHERE id=e3;
  ASSERT public.casa_object_result_v1(p)->>'state'='waiting','unreviewed proof must block';
  UPDATE public.casa_entries SET status='rechazada' WHERE id=e3;
  ASSERT public.casa_object_result_v1(p)->>'state'='ready','rejected proof does not block';
  INSERT INTO public.casa_match_issues(id,match_id,kind) VALUES(issue,m2,'suspendido');
  ASSERT public.casa_object_result_v1(p)->>'state'='waiting','unresolved match issue must block';
  UPDATE public.casa_match_issues SET decision='mantener',decided_at=now() WHERE id=issue;
  ASSERT public.casa_object_result_v1(p)->>'state'='ready','resolved issue restores ready';

  UPDATE public.casa_pollas SET closes_at=now()+interval '1 hour' WHERE id=p;
  ASSERT public.casa_object_result_v1(p)->>'state'='waiting','open inscriptions must block';
  UPDATE public.casa_pollas SET publication_mode='oculta' WHERE id=p;
  ASSERT public.casa_object_result_v1(p) IS NULL,'hidden polla has no result';
  ASSERT public.casa_object_result_v1(gen_random_uuid()) IS NULL,'unknown polla has no result';
  ASSERT NOT has_function_privilege('anon','public.casa_object_result_v1(uuid)','execute'),'anon cannot execute';
  ASSERT NOT has_function_privilege('authenticated','public.casa_object_result_v1(uuid)','execute'),'authenticated cannot bypass route';
  ASSERT has_function_privilege('service_role','public.casa_object_result_v1(uuid)','execute'),'server can execute';
  RAISE NOTICE 'OK: verified closure, SQL points, registration tiebreak, zero points, proof/issues/publication guards, read-only, permissions';
END $$;
ROLLBACK;
