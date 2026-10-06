-- Only run in a disposable local database. All fresh fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);
DO $$
DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); v uuid;
  result jsonb; summary record; fixed_mode boolean;
BEGIN
  INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
    VALUES(u,'+1997'||substr(replace(u::text,'-',''),1,10),'Balance fixture admin',true);
  FOREACH fixed_mode IN ARRAY ARRAY[false,true] LOOP
    p:=gen_random_uuid(); q:=gen_random_uuid();
    INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,created_by,entry_price_cop,house_cut_pct,
      pot_mode,fixed_prize_cop,payout_method,payout_account)
      VALUES(p,'balance-'||p,'Balance fixture','manual','abierta',clock_timestamp()+interval '1 hour',u,10001,30,
        CASE WHEN fixed_mode THEN 'fijo' ELSE 'proporcional' END,CASE WHEN fixed_mode THEN 100000 END,'otro','fixture');
    INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind,resolved_text,resolved_at)
      VALUES(q,p,'Balance fixture question',3,'texto','correct',clock_timestamp());
    FOR i IN 1..3 LOOP
      v:=gen_random_uuid();
      INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
        VALUES(v,'+1996'||substr(replace(v::text,'-',''),1,10),'Zero points fixture',false);
      INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,v,'pagada',10001);
    END LOOP;
    SELECT * INTO summary FROM public.casa_pot_summaries_v2(ARRAY[p]);
    ASSERT summary.gross_cop=30003;
    ASSERT summary.house_cop=CASE WHEN fixed_mode THEN -69997 ELSE 9001 END;
    PERFORM public.casa_change_status_v2(p,'cerrar',2,u,NULL);
    result:=public.casa_settle_polla_v2(p,2,u,NULL);
    ASSERT result->>'outcome'='house_retained_zero_points';
    SELECT * INTO summary FROM public.casa_pot_summaries_v2(ARRAY[p]);
    ASSERT summary.house_cop=30003, 'Terminal balance must account for all retained gross';
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p);
  END LOOP;
  ASSERT NOT has_function_privilege('anon','public.casa_pot_summaries_v2(uuid[],uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_pot_summaries_v2(uuid[],uuid)','EXECUTE');
  RAISE NOTICE 'PASS proportional/fixed zero-point terminal balance; no payouts; service-only ACL preserved';
END $$;
ROLLBACK;
