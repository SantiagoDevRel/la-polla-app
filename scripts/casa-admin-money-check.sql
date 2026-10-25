-- Migrations 174-175: the administrator's account counts only real deposits,
-- subtracts the cost of physical prizes and shows both outcomes while in play.
-- Run only with check-casa-sql.mjs in its owned, network-isolated PostgreSQL
-- container. All fixtures below are rolled back.
BEGIN;
SELECT public.casa_v2_context(2);

DO $$
DECLARE admin uuid:=gen_random_uuid(); real1 uuid:=gen_random_uuid(); real2 uuid:=gen_random_uuid();
  gifted uuid:=gen_random_uuid(); invited uuid:=gen_random_uuid(); house uuid;
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); pool uuid; q uuid; win uuid; lose uuid;
  money record; pot record; r jsonb;
BEGIN
  SELECT user_id INTO house FROM public.casa_admin_players WHERE position=1;
  INSERT INTO public.users(id,display_name,is_admin) VALUES(admin,'Money admin',true),
    (real1,'Real one',false),(real2,'Real two',false),(gifted,'Gifted',false),(invited,'Invited',false);
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,house_cut_pct,
    payout_method,payout_account)
  VALUES(a,'sql-money-a-'||a,'Money A','manual','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',admin,10000,30,'otro','fixture'),
    (b,'sql-money-b-'||b,'Money B','manual','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',admin,10000,30,'otro','fixture');

  FOREACH pool IN ARRAY ARRAY[a,b] LOOP
    q:=gen_random_uuid(); win:=gen_random_uuid(); lose:=gen_random_uuid();
    INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind) VALUES(q,pool,'Fixture question',3,'opciones');
    INSERT INTO public.casa_options(id,question_id,label,order_index) VALUES(win,q,'Win',0),(lose,q,'Lose',1);
    -- Two real deposits, one house player, one courtesy and one invitation gift.
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop)
      VALUES(pool,real1,'pagada',10000),(pool,real2,'pagada',10000);
    PERFORM public.casa_set_admin_player(pool,house,true,0,admin,2);
    PERFORM public.casa_grant_courtesies_v1(pool,gifted,1,admin,2);
    r:=public.casa_accept_courtesies_v1(pool,gifted,2);
    ASSERT (r->>'ok')::boolean, format('courtesy not accepted: %s',r);
    -- Fixture shortcut: a real gift comes from the referral flow (135); only its origin matters here.
    ALTER TABLE public.casa_entries DISABLE TRIGGER casa_02_referral_guard;
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,origin) VALUES(pool,invited,'pagada',0,'invitacion');
    ALTER TABLE public.casa_entries ENABLE TRIGGER casa_02_referral_guard;
    -- A: a real player wins. B: the house player wins.
    INSERT INTO public.casa_picks(entry_id,polla_id,user_id,question_id,option_id)
      SELECT x.id,pool,x.user_id,q,CASE WHEN x.user_id=CASE WHEN pool=a THEN real1 ELSE house END THEN win ELSE lose END
      FROM public.casa_entries x WHERE x.polla_id=pool AND x.status='pagada';
  END LOOP;

  SELECT * INTO pot FROM public.casa_pot_summaries_v2(ARRAY[a]);
  ASSERT pot.paid_entries=5 AND pot.gross_cop=30000 AND pot.prize_cop=21000 AND pot.house_cop=9000,
    format('public pot changed: %s',row_to_json(pot));
  SELECT * INTO money FROM public.casa_admin_money_v1(ARRAY[a]);
  ASSERT money.real_entries=2 AND money.house_entries=1 AND money.free_entries=2, format('counts: %s',row_to_json(money));
  ASSERT money.real_gross_cop=20000 AND money.real_house_cop=-1000 AND money.house_wins_cop=20000 AND money.prize_cost_cop=0,
    format('money in play: %s',row_to_json(money));
  ASSERT public.casa_house_total_v2(ARRAY[a,b])=-2000, 'house total must add real balances';
  ASSERT (SELECT if_player_wins_cop=-2000 AND if_house_wins_cop=40000 FROM public.casa_admin_house_totals_v1(ARRAY[a,b]));
  RAISE NOTICE 'PASS in play: only real deposits count; the committed prize is subtracted; public pot unchanged';

  FOREACH pool IN ARRAY ARRAY[a,b] LOOP
    SELECT id INTO q FROM public.casa_questions WHERE polla_id=pool;
    SELECT id INTO win FROM public.casa_options WHERE question_id=q AND order_index=0;
    PERFORM public.casa_resolve_question_v2(pool,q,win,NULL,2,admin,NULL);
    PERFORM public.casa_change_status_v2(pool,'cerrar',2,admin,NULL);
    r:=public.casa_settle_polla_v2(pool,2,admin,NULL);
  END LOOP;
  ASSERT (SELECT user_id=real1 AND amount_cop=21000 FROM public.casa_payouts WHERE polla_id=a);
  ASSERT (SELECT user_id=house AND amount_cop=21000 FROM public.casa_payouts WHERE polla_id=b);
  ASSERT (SELECT real_house_cop=-1000 FROM public.casa_admin_money_v1(ARRAY[a])), 'resolved: real winner paid from real money';
  ASSERT (SELECT real_house_cop=20000 FROM public.casa_admin_money_v1(ARRAY[b])), 'resolved: a house winner costs nothing';
  ASSERT public.casa_house_total_v2(ARRAY[a,b])=19000;
  ASSERT (SELECT if_player_wins_cop=19000 AND if_house_wins_cop=19000 FROM public.casa_admin_house_totals_v1(ARRAY[a,b])), 'resolved: both cases equal what happened';
  RAISE NOTICE 'PASS resolved: only payouts to real people leave the house balance';

  -- Physical prize: C is won by a real player, D by the house player.
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,house_cut_pct,
    ticket_count,draw_method,payout_method,payout_account,prize_kind,prize_object)
  VALUES(c,'sql-money-c-'||c,'Money C','rifa','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',admin,10000,100,3,'Fixture draw','otro','fixture','objeto','Fixture shirt'),
    (d,'sql-money-d-'||d,'Money D','rifa','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',admin,10000,100,3,'Fixture draw','otro','fixture','objeto','Fixture shirt');
  FOREACH pool IN ARRAY ARRAY[c,d] LOOP
    INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number)
      VALUES(pool,real1,'pagada',10000,1),(pool,real2,'pagada',10000,2);
    PERFORM public.casa_set_admin_player(pool,house,true,0,admin,2);
    INSERT INTO public.casa_polla_costs(polla_id,prize_cost_cop) VALUES(pool,15000);
  END LOOP;
  ASSERT (SELECT ticket_number=3 FROM public.casa_entries WHERE polla_id=d AND user_id=house);
  SELECT * INTO money FROM public.casa_admin_money_v1(ARRAY[c]);
  ASSERT money.real_gross_cop=20000 AND money.prize_cost_cop=15000 AND money.real_house_cop=5000 AND money.house_wins_cop=20000,
    format('object in play: %s',row_to_json(money));
  PERFORM public.casa_set_drawn_number_v2(c,1,2,admin,NULL);
  PERFORM public.casa_set_drawn_number_v2(d,3,2,admin,NULL);
  FOREACH pool IN ARRAY ARRAY[c,d] LOOP
    PERFORM public.casa_change_status_v2(pool,'cerrar',2,admin,NULL);
    r:=public.casa_settle_polla_v2(pool,2,admin,NULL);
    ASSERT r->>'outcome'='object_awarded', format('object not awarded: %s',r);
  END LOOP;
  ASSERT (SELECT real_house_cop=5000 AND house_wins_cop=5000 FROM public.casa_admin_money_v1(ARRAY[c])), 'object to a real player costs the prize';
  ASSERT (SELECT real_house_cop=20000 AND house_wins_cop=20000 FROM public.casa_admin_money_v1(ARRAY[d])), 'object kept by the house costs nothing';
  RAISE NOTICE 'PASS physical prize cost: subtracted in play and when a real player wins, kept when the house wins';

  ASSERT NOT has_table_privilege('authenticated','public.casa_polla_costs','SELECT');
  ASSERT NOT has_table_privilege('anon','public.casa_polla_costs','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.casa_admin_house_totals_v1(uuid[])','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.casa_admin_money_v1(uuid[])','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_admin_money_v1(uuid[])','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_house_total_v2(uuid[])','EXECUTE');
  RAISE NOTICE 'PASS server-only execution';
END $$;
ROLLBACK;
