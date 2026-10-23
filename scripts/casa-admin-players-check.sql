-- Run only with check-casa-sql.mjs in its owned, network-isolated
-- PostgreSQL container. All fixtures below are rolled back.
BEGIN;
SELECT public.casa_v2_context(2);
CREATE FUNCTION pg_temp.expect_failure(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
    IF position(expected IN message)=0 THEN RAISE EXCEPTION 'Expected %, got %',expected,message; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

DO $$
DECLARE actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  raffle uuid:=gen_random_uuid(); blocked uuid:=gen_random_uuid(); other_pool uuid:=gen_random_uuid();
  player uuid; player2 uuid; player3 uuid; entry uuid; first_entry uuid; q uuid:=gen_random_uuid(); opt uuid:=gen_random_uuid();
  result jsonb; old_event uuid;
BEGIN
  INSERT INTO public.users(id,display_name,is_admin) VALUES(actor,'SQL admin',true),(outsider,'SQL outsider',false);
  SELECT user_id INTO player FROM public.casa_admin_players WHERE position=1;
  SELECT user_id INTO player2 FROM public.casa_admin_players WHERE position=2;
  SELECT user_id INTO player3 FROM public.casa_admin_players WHERE position=3;
  ASSERT (SELECT count(*) FROM public.casa_admin_players)=20;
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,house_cut_pct,
    payout_method,payout_account)
  VALUES(p,'sql-roster-'||p,'SQL roster','manual','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',actor,10000,30,'otro','fixture'),
    (other_pool,'sql-other-'||other_pool,'Other pool','manual','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',actor,10000,30,'otro','fixture');

  PERFORM pg_temp.expect_failure(format('SELECT public.casa_get_admin_players(%L,%L)',p,outsider),'ADMIN_REQUIRED');
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',p,player,outsider),'ADMIN_REQUIRED');
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,1)',p,player,actor),'UPDATE_REQUIRED');
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',p,outsider,actor),'INVALID_MANAGED_PLAYER');
  ASSERT NOT has_function_privilege('anon','public.casa_set_admin_player(uuid,uuid,boolean,integer,uuid,integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.casa_get_admin_players(uuid,uuid)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.casa_admin_players','SELECT');
  ASSERT NOT has_table_privilege('service_role','public.casa_admin_player_events','UPDATE');
  ASSERT NOT has_table_privilege('service_role','public.casa_admin_player_events','DELETE');
  RAISE NOTICE 'PASS administrator, contract, exact roster and Data API authorization';

  result:=public.casa_set_admin_player(p,player,false,0,actor,2);
  ASSERT jsonb_array_length(result->'players')=20 AND (result->>'editable')::boolean;
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=p);
  result:=public.casa_set_admin_player(p,player,true,0,actor,2);
  SELECT id INTO entry FROM public.casa_entries WHERE polla_id=p AND user_id=player;
  first_entry:=entry;
  ASSERT (SELECT status='pagada' AND amount_cop=10000 AND proof_path IS NULL AND reviewed_by=actor FROM public.casa_entries WHERE id=entry);
  ASSERT (SELECT paid_entries=1 AND gross_cop=10000 AND prize_cop=7000 AND house_cop=3000 FROM public.casa_pot_summaries_v2(ARRAY[p]));
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_entries WHERE polla_id=other_pool);
  PERFORM public.casa_set_admin_player(p,player,true,0,actor,2);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=p)=1;
  ASSERT (SELECT count(*) FROM public.casa_admin_player_events WHERE entry_id=entry)=1;
  RAISE NOTICE 'PASS paid entry, SQL pot contribution, pool scope and lost-response retry';

  INSERT INTO public.casa_questions(id,polla_id,prompt,points,input_kind) VALUES(q,p,'Fixture question',3,'opciones');
  INSERT INTO public.casa_options(id,question_id,label) VALUES(opt,q,'Fixture option');
  result:=public.casa_save_picks_v1(p,player,entry,gen_random_uuid(),0,
    jsonb_build_array(jsonb_build_object('questionId',q,'optionId',opt)));
  ASSERT (result->>'guardados')::integer=1;
  PERFORM pg_temp.expect_failure(format('UPDATE public.casa_entries SET status=''anulada'' WHERE id=%L',entry),'ALREADY_PAID');
  PERFORM public.casa_set_admin_player(p,player,false,1,actor,2);
  ASSERT (SELECT status='anulada' AND reviewed_by=actor FROM public.casa_entries WHERE id=entry);
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE entry_id=entry)=1;
  ASSERT (SELECT paid_entries=0 AND gross_cop=0 AND prize_cop=0 FROM public.casa_pot_summaries_v2(ARRAY[p]));
  ASSERT NOT EXISTS(SELECT 1 FROM public.casa_leaderboard(p) WHERE user_id=player);
  PERFORM public.casa_set_admin_player(p,player,true,2,actor,2);
  ASSERT (SELECT id FROM public.casa_entries WHERE polla_id=p AND user_id=player)=first_entry;
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE entry_id=entry)=1;
  ASSERT (SELECT count(*) FROM public.casa_admin_player_events WHERE entry_id=entry)=3;
  SELECT id INTO old_event FROM public.casa_admin_player_events WHERE entry_id=entry AND revision=2;
  PERFORM set_config('app.casa_admin_player_event',old_event::text,true);
  PERFORM pg_temp.expect_failure(format('UPDATE public.casa_entries SET status=''anulada'' WHERE id=%L',entry),'ALREADY_PAID');
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,false,1,%L,2)',p,player,actor),'PLAYER_SELECTION_CHANGED');
  RAISE NOTICE 'PASS audited removal/re-add retains picks and identity; stale reversal rejected';

  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop) VALUES(p,player2,'pagada',10000);
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,false,0,%L,2)',p,player2,actor),'MANAGED_ENTRY_CONFLICT');
  ASSERT (SELECT status='pagada' FROM public.casa_entries WHERE polla_id=p AND user_id=player2);
  RAISE NOTICE 'PASS unrelated existing inscription remains immutable';
  PERFORM public.casa_resolve_question_v2(p,q,opt,NULL,2,actor,NULL);
  PERFORM public.casa_change_status_v2(p,'cerrar',2,actor,NULL);
  PERFORM public.casa_settle_polla_v2(p,2,actor,NULL);
  ASSERT (SELECT user_id=player AND amount_cop=14000 FROM public.casa_payouts WHERE polla_id=p);
  RAISE NOTICE 'PASS managed player wins a normal points-based pool';

  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,max_entries_per_user)
  VALUES(blocked,'sql-free-'||blocked,'SQL free pool','manual','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',actor,0,10);
  PERFORM public.casa_set_admin_player(blocked,player,true,0,actor,2);
  ASSERT (SELECT amount_cop=0 AND status='pagada' AND entry_number=1 FROM public.casa_entries WHERE polla_id=blocked);
  ASSERT (SELECT max_entries_per_user=1 FROM public.casa_pollas WHERE id=blocked);
  ASSERT (SELECT paid_entries=1 AND gross_cop=0 FROM public.casa_pot_summaries_v2(ARRAY[blocked]));
  PERFORM public.casa_set_admin_player(blocked,player,false,1,actor,2);
  PERFORM public.casa_set_admin_player(blocked,player,true,2,actor,2);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=blocked)=1;
  RAISE NOTICE 'PASS free pools retain their zero amount, single-entry cap and original entry';

  UPDATE public.casa_pollas SET status='cerrada' WHERE id=other_pool;
  ASSERT NOT (public.casa_get_admin_players(other_pool,actor)->>'editable')::boolean;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',other_pool,player,actor),'INSCRIPTIONS_CLOSED');
  UPDATE public.casa_pollas SET status='abierta',closes_at=clock_timestamp()-interval '1 second' WHERE id=other_pool;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',other_pool,player,actor),'INSCRIPTIONS_CLOSED');
  UPDATE public.casa_pollas SET closes_at=clock_timestamp()+interval '2 hours',publication_mode='oculta' WHERE id=other_pool;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',other_pool,player,actor),'POLLA_NOT_PUBLISHED');
  UPDATE public.casa_pollas SET publication_mode='programada',opens_at=clock_timestamp()+interval '1 hour' WHERE id=other_pool;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',other_pool,player,actor),'POLLA_NOT_PUBLISHED');
  UPDATE public.casa_pollas SET status='resuelta' WHERE id=other_pool;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',other_pool,player,actor),'POLLA_FINAL');
  RAISE NOTICE 'PASS closed, expired, unpublished, scheduled and finalized registration guards';

  blocked:=gen_random_uuid();
  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,prize_kind,prize_object,payout_method,payout_account)
  VALUES(blocked,'sql-draw-'||blocked,'SQL pending draw','manual','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',actor,10000,'objeto','Fixture prize','otro','fixture');
  INSERT INTO public.casa_object_draws(polla_id,prize_object,top_points) VALUES(blocked,'Fixture prize',3);
  ASSERT NOT (public.casa_get_admin_players(blocked,actor)->>'editable')::boolean;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',blocked,player,actor),'DRAW_PENDING');
  RAISE NOTICE 'PASS pending draws freeze the roster';

  INSERT INTO public.casa_pollas(id,slug,name,kind,status,closes_at,opens_at,created_by,entry_price_cop,house_cut_pct,ticket_count,draw_method,payout_method,payout_account)
  VALUES(raffle,'sql-raffle-'||raffle,'SQL raffle','rifa','abierta',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 hour',actor,10000,30,3,'Fixture draw','otro','fixture');
  INSERT INTO public.casa_entries(polla_id,user_id,status,amount_cop,ticket_number) VALUES(raffle,outsider,'anulada',10000,1);
  PERFORM public.casa_set_admin_player(raffle,player,true,0,actor,2);
  ASSERT (SELECT ticket_number FROM public.casa_entries WHERE polla_id=raffle AND user_id=player)=2;
  PERFORM public.casa_set_admin_player(raffle,player,false,1,actor,2);
  PERFORM public.casa_set_admin_player(raffle,player2,true,0,actor,2);
  ASSERT (SELECT ticket_number FROM public.casa_entries WHERE polla_id=raffle AND user_id=player2)=3;
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,true,0,%L,2)',raffle,player3,actor),'NO_AVAILABLE_TICKETS');
  PERFORM public.casa_set_admin_player(raffle,player,true,2,actor,2);
  ASSERT (SELECT count(*) FROM public.casa_entries WHERE polla_id=raffle)=3;
  PERFORM public.casa_set_drawn_number_v2(raffle,2,2,actor,NULL);
  PERFORM public.casa_change_status_v2(raffle,'cerrar',2,actor,NULL);
  result:=public.casa_settle_polla_v2(raffle,2,actor,NULL);
  ASSERT (SELECT user_id=player AND amount_cop=14000 FROM public.casa_payouts WHERE polla_id=raffle);
  PERFORM pg_temp.expect_failure(format('SELECT public.casa_set_admin_player(%L,%L,false,3,%L,2)',raffle,player,actor),'POLLA_FINAL');
  RAISE NOTICE 'PASS raffle ownership, capacity, retained ticket and real prize eligibility';
END $$;
ROLLBACK;
