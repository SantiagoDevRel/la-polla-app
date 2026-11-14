-- Owner-authorized data correction, 2026-11-13: Carlos paid numbers 62 and 63
-- before closing but did not register them in the app. Record them against the
-- existing raffle creator account. Do not reopen sales or backdate timestamps.
BEGIN;
DO $$
DECLARE raffle record; actor uuid; actors integer; added integer[];
BEGIN
  SELECT r.id,r.creator_id,r.status,r.winning_number,r.resolved_at,r.number_count,u.display_name
    INTO raffle FROM public.rifas r JOIN public.users u ON u.id=r.creator_id
    WHERE r.id='495aa5b1-767c-47bb-8487-15223ab44f63'
      AND r.slug='rifa-solidaria-la-iguana-camiseta' FOR UPDATE OF r;
  IF NOT FOUND THEN RETURN; END IF;
  IF lower(btrim(raffle.display_name)) <> 'carlos' OR raffle.number_count <= 63 THEN
    RAISE EXCEPTION 'Unexpected raffle owner or number range';
  END IF;
  IF (SELECT count(*) FROM public.rifa_tickets WHERE rifa_id=raffle.id AND number IN (62,63)
      AND buyer_id=raffle.creator_id AND origin='app' AND state='pagado')=2 THEN RETURN; END IF;
  IF raffle.status<>'abierta' OR raffle.winning_number IS NOT NULL OR raffle.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Do not change tickets after a raffle result';
  END IF;
  IF EXISTS(SELECT 1 FROM public.rifa_tickets WHERE rifa_id=raffle.id AND number IN (62,63)
      AND state<>'liberado' AND NOT (state='pagado' AND origin='app' AND buyer_id=raffle.creator_id)) THEN
    RAISE EXCEPTION 'A requested number is already assigned';
  END IF;
  SELECT count(*), (array_agg(m.user_id))[1] INTO actors,actor
    FROM public.rifa_managers m JOIN public.users u ON u.id=m.user_id
    WHERE m.rifa_id=raffle.id AND u.is_admin;
  IF actors<>1 THEN RAISE EXCEPTION 'Expected the authorizing administrator in this raffle team'; END IF;
  WITH inserted AS (
    INSERT INTO public.rifa_tickets(rifa_id,number,state,origin,buyer_id,paid_at,paid_by,created_by)
    SELECT raffle.id,n,'pagado','app',raffle.creator_id,now(),actor,actor
      FROM unnest(ARRAY[62,63]) n
      WHERE NOT EXISTS(SELECT 1 FROM public.rifa_tickets t WHERE t.rifa_id=raffle.id AND t.number=n AND t.state<>'liberado')
    RETURNING number
  ) SELECT array_agg(number ORDER BY number) INTO added FROM inserted;
  IF added IS NOT NULL THEN
    INSERT INTO public.rifa_events(rifa_id,actor_id,subject_user_id,kind,detail)
      VALUES(raffle.id,actor,raffle.creator_id,'venta_por_fuera',jsonb_build_object(
        'numbers',to_jsonb(added),'paid',true,'manual_registration',true,
        'reason','Owner confirmed Carlos paid before closing and explicitly requested late registration of 62 and 63.'));
  END IF;
END $$;
COMMIT;
