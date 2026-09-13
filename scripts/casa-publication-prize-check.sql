-- LOCAL ONLY: Docker supabase_db_la-polla, never production.
-- Fresh random fixture IDs; every write rolls back. No deletion, no matches,
-- no historical predictions, and no global operation-mode changes.
-- PowerShell: Get-Content -Raw -Encoding UTF8 scripts/casa-publication-prize-check.sql |
--   docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
\set ON_ERROR_STOP on
BEGIN;
SELECT public.casa_v2_context(2);

CREATE FUNCTION pg_temp.publication_must_fail(q text, expected text) RETURNS void LANGUAGE plpgsql AS $$
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

CREATE TEMP TABLE publication_people ON COMMIT DROP AS
  SELECT n,gen_random_uuid() id FROM generate_series(0,1000) n;
INSERT INTO public.users(id,whatsapp_number,display_name,is_admin)
  SELECT id,'+1666'||substr(replace(id::text,'-',''),1,10),'Local publication fixture '||n,n=0
  FROM publication_people;

CREATE FUNCTION pg_temp.publication_config(p_kind text DEFAULT 'manual') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('name','Local publication and prize fixture','kind',p_kind,'prizeKind','pozo',
    'entryPriceCop',10000,'houseCutPct',0,'potMode','fijo','fixedPrizeCop',1000000,
    'closesAt',clock_timestamp()+interval '4 hours','closeMode','manual','publicationMode','ahora',
    'payoutMethod','otro','payoutAccount','local-fixture','ticketCount',1000,'drawMethod','Local fixture draw',
    'questions',jsonb_build_array(jsonb_build_object('prompt','Local fixture question','points',3,'inputKind','opciones',
      'options',jsonb_build_array('Correcta','Incorrecta'))));
$$;

CREATE FUNCTION pg_temp.publication_create(config jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  result:=public.casa_create_polla_v2(config,'publication-test-'||gen_random_uuid(),
    (SELECT id FROM pg_temp.publication_people WHERE n=0),2);
  RETURN (result->>'id')::uuid;
END $$;

DO $$
DECLARE admin_id uuid:=(SELECT id FROM pg_temp.publication_people WHERE n=0);
  player_id uuid:=(SELECT id FROM pg_temp.publication_people WHERE n=1);
  p uuid; fixed_pool uuid; proportional_pool uuid; object_pool uuid; future_pool uuid; hidden_pool uuid; due_pool uuid;
  void_pool uuid; zero_pool uuid;
  q uuid; answer uuid; e uuid; uid uuid; r jsonb; config jsonb; pot record; hidden_questions uuid[];
  publication_time timestamptz:=clock_timestamp()+interval '1 hour';
BEGIN
  -- Migration 109: the fixed prize is a guaranteed minimum. Creating it with a
  -- 50% house cut is valid; entries cover the minimum first, then the excess splits.
  fixed_pool:=pg_temp.publication_create(pg_temp.publication_config()||jsonb_build_object('houseCutPct',50));
  ASSERT (SELECT pot_mode='fijo' AND house_cut_pct=50 AND fixed_prize_cop=1000000 FROM public.casa_pollas WHERE id=fixed_pool),
    'Fixed prize with 50% house cut must be created as configured';
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[fixed_pool]);
  ASSERT pot.paid_entries=0 AND pot.gross_cop=0 AND pot.prize_cop=1000000 AND pot.house_cop=-1000000, '0 paid: 1,000,000 / -1,000,000';
  ASSERT pot.entry_prize_cop=0 AND pot.projected_prize_cop=1000000;
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT fixed_pool,id,'pagada',10000 FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 100;
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[fixed_pool]);
  ASSERT pot.paid_entries=100 AND pot.gross_cop=1000000 AND pot.prize_cop=1000000 AND pot.house_cop=0, '100 paid: 1,000,000 / 0';
  ASSERT pot.entry_prize_cop=5000 AND pot.projected_prize_cop=1005000, 'Entry 101 adds 5,000 to the pot';
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT fixed_pool,id,'pagada',10000 FROM pg_temp.publication_people WHERE n=101;
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[fixed_pool]);
  ASSERT pot.paid_entries=101 AND pot.prize_cop=1005000 AND pot.house_cop=5000, '101 paid: 1,005,000 / 5,000';
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT fixed_pool,id,'pagada',10000 FROM pg_temp.publication_people WHERE n=102;
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[fixed_pool]);
  ASSERT pot.paid_entries=102 AND pot.prize_cop=1010000 AND pot.house_cop=10000, '102 paid: 1,010,000 / 10,000';
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT fixed_pool,id,'pagada',10000 FROM pg_temp.publication_people WHERE n BETWEEN 103 AND 200;
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[fixed_pool]);
  ASSERT pot.paid_entries=200 AND pot.gross_cop=2000000 AND pot.prize_cop=1500000 AND pot.house_cop=500000, '200 paid: 1,500,000 / 500,000';
  ASSERT (SELECT prize_cop=1500000 AND house_cop=500000 FROM public.casa_polla_pot(fixed_pool));
  ASSERT (SELECT (d->>'entry_prize_cop')::bigint=5000 AND (d->>'entry_house_cop')::bigint=5000 AND (d->>'projected_prize_cop')::bigint=1505000
    FROM public.casa_payment_details_v2(fixed_pool) d);
  RAISE NOTICE 'PASS guaranteed minimum 1,000,000 at 50%%: 0/100/101/102/200 paid -> exact prize and house balance';

  p:=pg_temp.publication_create(pg_temp.publication_config()||jsonb_build_object('houseCutPct',0));
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT p,id,'pagada',10000 FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 150;
  ASSERT (SELECT prize_cop=1500000 AND house_cop=0 FROM public.casa_pot_summaries_v2(ARRAY[p])), '0 percent, 150 paid: 1,500,000 / 0';
  p:=pg_temp.publication_create(pg_temp.publication_config()||jsonb_build_object('houseCutPct',100));
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT p,id,'pagada',10000 FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 150;
  ASSERT (SELECT prize_cop=1000000 AND house_cop=500000 FROM public.casa_pot_summaries_v2(ARRAY[p])), '100 percent, 150 paid: 1,000,000 / 500,000';
  -- Same rounding as the proportional pot: 30% of an odd excess keeps the floor for the pot.
  ASSERT public.casa_money_prize_cop(1000001::bigint,30,1000000)=1000000 AND public.casa_money_prize_cop(1000010::bigint,30,1000000)=1000007;
  ASSERT public.casa_money_prize_cop(30003::bigint,30,NULL)=floor(30003*0.7);
  RAISE NOTICE 'PASS guaranteed minimum with 0%% and 100%% house cut and shared rounding';

  r:=public.casa_fixed_prize_threshold_preview_v2(10000,50,1000000,200);
  ASSERT (r->>'fixed_prize')::bigint=1000000 AND (r->>'entries_to_cover')::bigint=100;
  ASSERT (r->>'entry_prize')::bigint=5000 AND (r->>'entry_house')::bigint=5000;
  ASSERT (r->>'ten_prize')::bigint=1000000 AND (r->>'ten_balance')::bigint=-900000;
  ASSERT (r->>'all_prize')::bigint=1500000 AND (r->>'all_balance')::bigint=500000;
  ASSERT (r->>'all_prize')::bigint=(SELECT prize_cop FROM public.casa_pot_summaries_v2(ARRAY[fixed_pool])), 'Preview and summaries disagree';
  r:=public.casa_fixed_prize_threshold_preview_v2(10000,0,1000000,150);
  ASSERT (r->>'entry_prize')::bigint=10000 AND (r->>'entry_house')::bigint=0 AND (r->>'all_prize')::bigint=1500000;
  r:=public.casa_fixed_prize_threshold_preview_v2(30000,50,1000000,100);
  ASSERT (r->>'entries_to_cover')::bigint=34, 'Entries to cover rounds up';
  r:=public.casa_fixed_prize_threshold_preview_v2(0,50,1000000,100);
  ASSERT r->'entries_to_cover'='null'::jsonb AND (r->>'all_prize')::bigint=1000000 AND (r->>'all_balance')::bigint=-1000000;
  -- The 104 three-argument preview is now the same rule with a 0% house cut.
  r:=public.casa_fixed_prize_preview_v2(10000,1000000,1000);
  ASSERT (r->>'ten_prize')::bigint=1000000 AND (r->>'all_prize')::bigint=10000000;
  ASSERT (r->>'ten_balance')::bigint=-900000 AND (r->>'all_balance')::bigint=0;
  PERFORM pg_temp.publication_must_fail('SELECT public.casa_fixed_prize_preview_v2(10000,NULL,100)','INVALID_FIXED_PRIZE');
  PERFORM pg_temp.publication_must_fail('SELECT public.casa_fixed_prize_preview_v2(10000,0,100)','INVALID_FIXED_PRIZE');
  PERFORM pg_temp.publication_must_fail('SELECT public.casa_fixed_prize_threshold_preview_v2(10000,50,0,100)','INVALID_FIXED_PRIZE');
  PERFORM pg_temp.publication_must_fail('SELECT public.casa_fixed_prize_threshold_preview_v2(10000,101,1000000,100)','INVALID_CONFIG');
  PERFORM pg_temp.publication_must_fail(format('SELECT pg_temp.publication_create(%L::jsonb)',pg_temp.publication_config()||jsonb_build_object('fixedPrizeCop',0,'houseCutPct',50)),'INVALID_FIXED_PRIZE');
  RAISE NOTICE 'PASS fixed preview: entries to cover, per-entry split above the minimum, invalid amounts';

  -- Settlement pays the grown pot: 102 paid at 50%% -> 1,010,000 split between two winners.
  p:=pg_temp.publication_create(pg_temp.publication_config()||jsonb_build_object('houseCutPct',50));
  SELECT id INTO q FROM public.casa_questions WHERE polla_id=p;
  SELECT id INTO answer FROM public.casa_options WHERE question_id=q AND order_index=0;
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT p,id,'pagada',10000 FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 102;
  INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id)
    SELECT e2.id,p,e2.user_id,q,answer FROM public.casa_entries e2
    WHERE e2.polla_id=p AND e2.user_id IN (SELECT id FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 2);
  PERFORM public.casa_resolve_question_v2(p,q,answer,NULL,2,admin_id,NULL);
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT r->>'outcome'='money_awarded' AND (r->>'prize_cop')::bigint=1010000;
  ASSERT (SELECT count(*)=2 AND sum(amount_cop)=1010000 AND min(amount_cop)=505000 FROM public.casa_payouts WHERE polla_id=p);
  ASSERT (SELECT prize_cop=1010000 AND house_cop=10000 FROM public.casa_pot_summaries_v2(ARRAY[p]));
  RAISE NOTICE 'PASS settlement of a guaranteed minimum that grew above it';

  -- A guaranteed prize remains exactly the prize even when collections are lower.
  p:=pg_temp.publication_create(pg_temp.publication_config());
  SELECT id INTO q FROM public.casa_questions WHERE polla_id=p;
  SELECT id INTO answer FROM public.casa_options WHERE question_id=q AND order_index=0;
  FOR uid IN SELECT id FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 4 LOOP
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,uid,'pagada',10000) RETURNING id INTO e;
    IF uid<>(SELECT id FROM pg_temp.publication_people WHERE n=4) THEN
      INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id) VALUES(e,p,uid,q,answer);
    END IF;
  END LOOP;
  PERFORM public.casa_resolve_question_v2(p,q,answer,NULL,2,admin_id,NULL);
  PERFORM public.casa_change_status_v2(p,'cerrar',2,admin_id,NULL);
  r:=public.casa_settle_polla_v2(p,2,admin_id,NULL);
  ASSERT r->>'outcome'='money_awarded' AND (r->>'prize_cop')::bigint=1000000;
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=p)=3;
  ASSERT (SELECT sum(amount_cop) FROM public.casa_payouts WHERE polla_id=p)=1000000;
  ASSERT (SELECT max(amount_cop)-min(amount_cop) FROM public.casa_payouts WHERE polla_id=p)=1;
  ASSERT (SELECT amount_cop FROM public.casa_payouts WHERE polla_id=p ORDER BY user_id LIMIT 1)=333334;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=p AND (place<>1 OR user_id=(SELECT id FROM pg_temp.publication_people WHERE n=4)));
  ASSERT (SELECT house_cop FROM public.casa_polla_pot(p))=-960000;
  PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_settle_polla_v2(%L,2,%L,NULL)',p,admin_id),'POLLA_FINAL');
  RAISE NOTICE 'PASS fixed settlement: three tied winners receive exact total and stable one-peso remainder';

  -- Migration 107: the house balance subtracts only a prize that can still be,
  -- or actually was, awarded. prize_cop keeps the configured commitment.
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[p]);
  ASSERT pot.house_cop=pot.gross_cop-(SELECT sum(amount_cop) FROM public.casa_payouts WHERE polla_id=p AND prize_kind='pozo')
    AND pot.house_cop=-960000 AND pot.prize_cop=1000000, 'Resolved fixed balance must subtract the amount actually paid';

  void_pool:=pg_temp.publication_create(pg_temp.publication_config());
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
    SELECT void_pool,id,'pagada',10000 FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 3;
  PERFORM public.casa_change_status_v2(void_pool,'anular',2,admin_id,NULL);
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[void_pool]);
  ASSERT pot.gross_cop=30000 AND pot.house_cop=30000 AND pot.prize_cop=1000000, 'Voided fixed pool still subtracts its prize';

  zero_pool:=pg_temp.publication_create(pg_temp.publication_config());
  SELECT id INTO q FROM public.casa_questions WHERE polla_id=zero_pool;
  SELECT id INTO answer FROM public.casa_options WHERE question_id=q AND order_index=1;
  FOR uid IN SELECT id FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 2 LOOP
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(zero_pool,uid,'pagada',10000) RETURNING id INTO e;
    INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id) VALUES(e,zero_pool,uid,q,answer);
  END LOOP;
  PERFORM public.casa_resolve_question_v2(zero_pool,q,(SELECT id FROM public.casa_options WHERE question_id=q AND order_index=0),NULL,2,admin_id,NULL);
  PERFORM public.casa_change_status_v2(zero_pool,'cerrar',2,admin_id,NULL);
  r:=public.casa_settle_polla_v2(zero_pool,2,admin_id,NULL);
  ASSERT r->>'outcome'='house_retained_zero_points';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_payouts WHERE polla_id=zero_pool);
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[zero_pool]);
  ASSERT pot.gross_cop=20000 AND pot.house_cop=20000 AND pot.prize_cop=1000000, 'Fixed pool with no winner still subtracts its prize';
  ASSERT public.casa_house_total_v2(ARRAY[p,void_pool,zero_pool])=-960000+30000+20000, 'House total differs from per-pool balances';
  RAISE NOTICE 'PASS fixed house balance: resolved subtracts payouts; voided and zero-point pools keep gross; totals agree';

  config:=(pg_temp.publication_config()-'fixedPrizeCop')||jsonb_build_object('potMode','proporcional','houseCutPct',30,'entryPriceCop',10001);
  proportional_pool:=pg_temp.publication_create(config);
  SELECT id INTO q FROM public.casa_questions WHERE polla_id=proportional_pool;
  SELECT id INTO answer FROM public.casa_options WHERE question_id=q AND order_index=0;
  FOR uid IN SELECT id FROM pg_temp.publication_people WHERE n BETWEEN 1 AND 3 LOOP
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(proportional_pool,uid,'pagada',10001) RETURNING id INTO e;
    INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id) VALUES(e,proportional_pool,uid,q,answer);
  END LOOP;
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[proportional_pool]);
  ASSERT pot.prize_cop=21002 AND pot.house_cop=9001 AND pot.projected_prize_cop=28002 AND pot.entry_prize_cop=7000;
  PERFORM public.casa_resolve_question_v2(proportional_pool,q,answer,NULL,2,admin_id,NULL);
  PERFORM public.casa_change_status_v2(proportional_pool,'cerrar',2,admin_id,NULL);
  r:=public.casa_settle_polla_v2(proportional_pool,2,admin_id,NULL);
  ASSERT (SELECT sum(amount_cop) FROM public.casa_payouts WHERE polla_id=proportional_pool)=21002;
  ASSERT (SELECT max(amount_cop)-min(amount_cop) FROM public.casa_payouts WHERE polla_id=proportional_pool)=1;
  RAISE NOTICE 'PASS existing proportional 70 percent and rounding retain their settlement contract';

  config:=(pg_temp.publication_config('rifa')-'fixedPrizeCop')||jsonb_build_object('potMode','proporcional','prizeKind','objeto','prizeObject','Local fixture shirt');
  object_pool:=pg_temp.publication_create(config);
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number) VALUES(object_pool,player_id,'pagada',10000,7);
  UPDATE public.casa_pollas SET drawn_number=7 WHERE id=object_pool;
  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[object_pool]);
  ASSERT pot.prize_cop=0 AND pot.house_cop=10000 AND pot.projected_prize_cop=0;
  PERFORM public.casa_change_status_v2(object_pool,'cerrar',2,admin_id,NULL);
  r:=public.casa_settle_polla_v2(object_pool,2,admin_id,NULL);
  ASSERT r->>'outcome'='object_awarded';
  ASSERT (SELECT count(*) FROM public.casa_payouts WHERE polla_id=object_pool AND prize_kind='objeto' AND amount_cop=0 AND prize_object='Local fixture shirt')=1;
  RAISE NOTICE 'PASS existing object prize has no cash pot and preserves object award';

  config:=pg_temp.publication_config()||jsonb_build_object('publicationMode','programada','publishesAt',publication_time);
  future_pool:=pg_temp.publication_create(config);
  hidden_pool:=pg_temp.publication_create(pg_temp.publication_config()||jsonb_build_object('publicationMode','oculta'));
  ASSERT (SELECT status='abierta' AND opens_at=publication_time FROM public.casa_pollas WHERE id=future_pool);
  ASSERT (SELECT status='borrador' AND publication_mode='oculta' FROM public.casa_pollas WHERE id=hidden_pool);
  -- Migration 109: neither a hidden pool nor a scheduled pool whose opens_at has
  -- not arrived commits its prize in the house balance; prize_cop still shows it.
  -- A scheduled pool cannot be closed early (107).
  ASSERT (SELECT house_cop=0 AND prize_cop=1000000 FROM public.casa_pot_summaries_v2(ARRAY[hidden_pool])), 'Hidden fixed pool subtracts its prize';
  ASSERT (SELECT house_cop=0 AND prize_cop=1000000 FROM public.casa_pot_summaries_v2(ARRAY[future_pool])), 'Unpublished scheduled fixed pool subtracts its prize';
  ASSERT public.casa_house_total_v2(ARRAY[hidden_pool,future_pool])=0;
  PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_change_status_v2(%L,''cerrar'',2,%L,NULL)',future_pool,admin_id),'POLLA_NOT_PUBLISHED');
  ASSERT (SELECT status='abierta' AND publication_mode='programada' AND opens_at=publication_time FROM public.casa_pollas WHERE id=future_pool);
  RAISE NOTICE 'PASS hidden and unpublished scheduled fixed pools commit no prize; closing an unpublished scheduled pool is rejected';
  FOREACH p IN ARRAY ARRAY[future_pool,hidden_pool] LOOP
    PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_begin_entry_proof_v2(%L,%L,%L,NULL,%L,''image/png'',100,2)',p,player_id,gen_random_uuid(),repeat('a',64)),'POLLA_NOT_PUBLISHED');
    ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p);
  END LOOP;
  RAISE NOTICE 'PASS scheduled and hidden pools cannot reserve entries or proofs';

  PERFORM pg_temp.publication_must_fail(format('SELECT pg_temp.publication_create(%L::jsonb)',config-'publishesAt'),'INVALID_PUBLICATION_DATE');
  PERFORM pg_temp.publication_must_fail(format('SELECT pg_temp.publication_create(%L::jsonb)',config||jsonb_build_object('publishesAt',clock_timestamp()-interval '1 minute')),'INVALID_PUBLICATION_DATE');
  PERFORM pg_temp.publication_must_fail(format('SELECT pg_temp.publication_create(%L::jsonb)',config||jsonb_build_object('publishesAt',config->>'closesAt')),'INVALID_PUBLICATION_DATE');
  PERFORM pg_temp.publication_must_fail(format('SELECT pg_temp.publication_create(%L::jsonb)',config||jsonb_build_object('publishesAt',clock_timestamp()+interval '1 day')),'INVALID_PUBLICATION_DATE');
  PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_set_publication_v2(%L,''programada'',%L,%L,2)',hidden_pool,clock_timestamp()-interval '1 minute',admin_id),'INVALID_PUBLICATION_DATE');
  RAISE NOTICE 'PASS publication requires a future timestamp strictly before closing';

  -- Query through authenticated RLS, exactly the role used by Supabase Data API.
  SELECT array_agg(id) INTO hidden_questions FROM public.casa_questions WHERE polla_id IN (future_pool,hidden_pool);
  PERFORM set_config('request.jwt.claim.sub',player_id::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id IN (future_pool,hidden_pool)), 'RLS exposes hidden/scheduled polla before publication';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id IN (future_pool,hidden_pool)), 'RLS exposes hidden/scheduled questions';
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_options WHERE question_id=ANY(hidden_questions)), 'RLS exposes hidden/scheduled options';
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS authenticated direct reads hide scheduled/hidden pools and contents';

  due_pool:=pg_temp.publication_create(config);
  -- Simulate the publication instant having arrived, keeping programada mode.
  UPDATE public.casa_pollas SET opens_at=transaction_timestamp()-interval '1 millisecond' WHERE id=due_pool;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=due_pool);
  ASSERT EXISTS(SELECT 1 FROM public.casa_questions WHERE polla_id=due_pool);
  EXECUTE 'RESET ROLE';
  r:=public.casa_begin_entry_proof_v2(due_pool,player_id,gen_random_uuid(),NULL,repeat('b',64),'image/png',100,2);
  ASSERT r->>'state'='uploading';
  ASSERT (SELECT publication_mode FROM public.casa_pollas WHERE id=due_pool)='programada';
  ASSERT (SELECT house_cop=-1000000 AND prize_cop=1000000 FROM public.casa_pot_summaries_v2(ARRAY[due_pool])), 'Published scheduled fixed pool must subtract its prize';
  RAISE NOTICE 'PASS due scheduled publication opens reads and entry reservation without a cron or status mutation';
  PERFORM public.casa_change_status_v2(due_pool,'cerrar',2,admin_id,NULL);
  ASSERT (SELECT status='cerrada' FROM public.casa_pollas WHERE id=due_pool);
  RAISE NOTICE 'PASS a scheduled pool can be closed once its publication time arrived';

  PERFORM public.casa_set_publication_v2(future_pool,'ahora',NULL,admin_id,2);
  ASSERT (SELECT status='abierta' AND publication_mode='ahora' AND opens_at<=clock_timestamp() FROM public.casa_pollas WHERE id=future_pool);
  ASSERT (SELECT house_cop=-1000000 FROM public.casa_pot_summaries_v2(ARRAY[future_pool])), 'Scheduled pool published now must subtract its prize';
  -- now() in a RLS policy is the start of this long test transaction. Simulate
  -- a subsequent HTTP read without committing fixtures or changing the clock.
  UPDATE public.casa_pollas SET opens_at=transaction_timestamp()-interval '1 millisecond' WHERE id=future_pool;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT EXISTS(SELECT 1 FROM public.casa_pollas WHERE id=future_pool), 'RLS still hides a pool published now';
  EXECUTE 'RESET ROLE';
  r:=public.casa_begin_entry_proof_v2(future_pool,player_id,gen_random_uuid(),NULL,repeat('a',64),'image/png',100,2);
  ASSERT r->>'state'='uploading';
  PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_set_publication_v2(%L,''oculta'',NULL,%L,2)',future_pool,admin_id),'PUBLICATION_HAS_ENTRIES');
  PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_set_publication_v2(%L,''programada'',%L,%L,2)',future_pool,publication_time,admin_id),'PUBLICATION_HAS_ENTRIES');
  PERFORM public.casa_fail_entry_proof_v2((r->>'attempt_id')::uuid,player_id,2);
  PERFORM pg_temp.publication_must_fail(format('SELECT public.casa_set_publication_v2(%L,''oculta'',NULL,%L,2)',future_pool,admin_id),'PUBLICATION_HAS_ENTRIES');
  ASSERT (SELECT publication_mode='ahora' FROM public.casa_pollas WHERE id=future_pool);
  RAISE NOTICE 'PASS publish-now opens reads/reservations; existing entries prevent hiding or rescheduling even after failed upload';

  -- Fresh hidden pool can be scheduled, returned to hidden, or published immediately.
  PERFORM public.casa_set_publication_v2(hidden_pool,'programada',publication_time,admin_id,2);
  ASSERT (SELECT status='abierta' AND publication_mode='programada' AND opens_at=publication_time FROM public.casa_pollas WHERE id=hidden_pool);
  PERFORM public.casa_set_publication_v2(hidden_pool,'oculta',NULL,admin_id,2);
  ASSERT (SELECT status='borrador' AND publication_mode='oculta' FROM public.casa_pollas WHERE id=hidden_pool);
  PERFORM public.casa_change_status_v2(hidden_pool,'publicar',2,admin_id,NULL);
  ASSERT (SELECT status='abierta' AND publication_mode='ahora' AND opens_at<=clock_timestamp() FROM public.casa_pollas WHERE id=hidden_pool);
  RAISE NOTICE 'PASS admin can schedule/hide/publish a pool with no inscriptions';

  -- Do not let direct service-side writes bypass the fixed-prize invariant.
  PERFORM pg_temp.publication_must_fail(format('UPDATE public.casa_pollas SET fixed_prize_cop=NULL WHERE id=%L',fixed_pool),'casa_fixed_prize_valid');
  PERFORM pg_temp.publication_must_fail(format('UPDATE public.casa_pollas SET fixed_prize_cop=0 WHERE id=%L',fixed_pool),'casa_fixed_prize_valid');
  PERFORM pg_temp.publication_must_fail(format('UPDATE public.casa_pollas SET prize_kind=''objeto'' WHERE id=%L',fixed_pool),'casa_fixed_prize_valid');
  PERFORM pg_temp.publication_must_fail(format('UPDATE public.casa_pollas SET house_cut_pct=101 WHERE id=%L',fixed_pool),'casa_pollas_house_cut_pct_check');
  ASSERT NOT has_function_privilege('authenticated','public.casa_set_publication_v2(uuid,text,timestamptz,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_fixed_prize_preview_v2(integer,bigint,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_fixed_prize_threshold_preview_v2(integer,integer,bigint,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_money_prize_cop(bigint,integer,bigint)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_create_polla_v2(jsonb,text,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_polla_pot(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_pot_summaries_v2(uuid[],uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_payment_details_v2(uuid,uuid)','EXECUTE');
  RAISE NOTICE 'PASS fixed-prize CHECK and new RPC privilege guards';
END $$;
ROLLBACK;
