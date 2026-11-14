-- Isolated synthetic fixtures only; every write is rolled back.
BEGIN;
DO $$
DECLARE
  owner_id uuid := '77777777-7777-4777-8777-000000001861';
  buyer_id uuid := '77777777-7777-4777-8777-000000001862';
  manager_id uuid := '77777777-7777-4777-8777-000000001863';
  raffle_id uuid;
  ticket_id uuid;
  view jsonb;
  failure text;
BEGIN
  INSERT INTO auth.users(id, phone) VALUES
    (owner_id, '15550101861'), (buyer_id, '15550101862'), (manager_id, '15550101863');
  INSERT INTO public.users(id, whatsapp_number, display_name, avatar_url) VALUES
    (owner_id, '15550101861', 'Synthetic Creator', 'millos'),
    (buyer_id, '15550101862', 'Synthetic Winner', 'junior'),
    (manager_id, '15550101863', 'Synthetic Manager', 'millos')
    ON CONFLICT (id) DO UPDATE SET display_name=excluded.display_name, avatar_url=excluded.avatar_url;
  INSERT INTO public.rifas(slug, creator_id, name, prize_kind, prize_text, price_cop,
    lottery_name, draw_at, visibility, payment_method, payment_account, payment_holder)
    VALUES ('winner-check-186', owner_id, 'Synthetic winner check', 'texto', 'Synthetic prize', 5000,
      'Synthetic lottery', now() + interval '1 hour', 'publica', 'nequi', '15550101861', 'Synthetic Creator')
    RETURNING id INTO raffle_id;
  INSERT INTO public.rifa_tickets(rifa_id, number, state, origin, buyer_id, paid_at, created_by)
    VALUES (raffle_id, 0, 'pagado', 'app', buyer_id, now(), owner_id) RETURNING id INTO ticket_id;
  INSERT INTO public.rifa_managers(rifa_id,user_id,added_by) VALUES(raffle_id,manager_id,owner_id);

  ASSERT NOT (SELECT show_winner_public FROM public.rifas WHERE id=raffle_id), 'Disclosure must default to private';
  BEGIN
    PERFORM public.rifa_set_result_v2(owner_id,raffle_id,0,NULL,NULL,NULL,true);
  EXCEPTION WHEN OTHERS THEN failure:=SQLERRM; END;
  ASSERT failure='TOO_EARLY', 'Results must wait until draw time';
  UPDATE public.rifas SET draw_at=now()-interval '1 minute' WHERE id=raffle_id;
  failure:=NULL;
  BEGIN
    PERFORM public.rifa_set_result_v2(buyer_id,raffle_id,0,NULL,NULL,NULL,true);
  EXCEPTION WHEN OTHERS THEN failure:=SQLERRM; END;
  ASSERT failure='CREATOR_ONLY', 'Players must not set the result';
  failure:=NULL;
  BEGIN
    PERFORM public.rifa_set_result_v2(owner_id,raffle_id,99,NULL,NULL,NULL,true);
  EXCEPTION WHEN OTHERS THEN failure:=SQLERRM; END;
  ASSERT failure='UNSOLD_CHOICE_REQUIRED', 'Unsold numbers must retain existing safeguards';

  PERFORM public.rifa_set_result_v2(manager_id,raffle_id,0,NULL,NULL,NULL,true);
  view:=public.rifa_public_view_v1('winner-check-186',NULL);
  ASSERT view->>'winning_number'='0', '00 must be a valid winner';
  ASSERT view->'winner'=jsonb_build_object('name','Synthetic Winner','avatar_url','junior'), 'Public identity must contain only name and pollito';
  ASSERT (public.rifa_creator_view_v1(owner_id,'winner-check-186')->>'show_winner_public')::boolean, 'Management must read disclosure';
  failure:=NULL;
  BEGIN
    PERFORM public.rifa_set_winner_public_v1(buyer_id,raffle_id,false);
  EXCEPTION WHEN OTHERS THEN failure:=SQLERRM; END;
  ASSERT failure='CREATOR_ONLY', 'Players must not change disclosure';
  PERFORM public.rifa_set_winner_public_v1(manager_id,raffle_id,false);
  ASSERT public.rifa_public_view_v1('winner-check-186',NULL)->'winner'='null'::jsonb, 'No must omit identity server-side';
  ASSERT (SELECT count(*) FROM public.rifa_draws WHERE rifa_id=raffle_id)=1, 'Disclosure must not create another draw';
  PERFORM public.rifa_set_winner_public_v1(owner_id,raffle_id,true);
  -- Offline buyers may have no account/pollito; their recorded name still works.
  UPDATE public.rifa_tickets SET origin='fuera',buyer_id=NULL,buyer_name='Synthetic Offline',buyer_phone='+15550101864' WHERE id=ticket_id;
  ASSERT public.rifa_public_view_v1('winner-check-186',NULL)->'winner'=jsonb_build_object('name','Synthetic Offline','avatar_url',NULL), 'Offline winners must work without an account';
  ASSERT NOT has_function_privilege('anon','public.rifa_set_result_v2(uuid,uuid,integer,text,timestamptz,text,boolean)','EXECUTE'), 'Anonymous result writes must be denied';
  ASSERT NOT has_function_privilege('authenticated','public.rifa_set_winner_public_v1(uuid,uuid,boolean)','EXECUTE'), 'Authenticated direct disclosure writes must be denied';
END $$;
ROLLBACK;
