-- Explicit winner disclosure, controlled by the raffle creator/team.
-- Existing results stay private. Public responses expose only name + pollito.
BEGIN;

ALTER TABLE public.rifas ADD COLUMN show_winner_public boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.rifa_set_result_v2(
  p_actor uuid, p_rifa uuid, p_number integer, p_unsold_action text,
  p_new_draw_at timestamptz, p_new_lottery text, p_show_winner_public boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_show_winner_public IS NULL THEN
    PERFORM public.rifa_fail('INVALID_INPUT', NULL, '22023');
  END IF;
  -- v1 serializes the raffle and enforces team, draw time, payment and unsold
  -- number rules. Its lock remains held until disclosure is saved atomically.
  result := public.rifa_set_result_v1(p_actor, p_rifa, p_number, p_unsold_action, p_new_draw_at, p_new_lottery);
  UPDATE public.rifas SET show_winner_public = p_show_winner_public AND status = 'resuelta'
    WHERE id = p_rifa;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
    VALUES (p_rifa, p_actor, 'ganador_publico', jsonb_build_object('show', p_show_winner_public AND result->>'outcome' = 'ganador'));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.rifa_set_result_v2(uuid,uuid,integer,text,timestamptz,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rifa_set_result_v2(uuid,uuid,integer,text,timestamptz,text,boolean) TO service_role;

CREATE FUNCTION public.rifa_set_winner_public_v1(p_actor uuid, p_rifa uuid, p_show boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE raffle public.rifas;
BEGIN
  raffle := public.rifa_lock(p_rifa);
  PERFORM public.rifa_require_owner(raffle, p_actor);
  IF raffle.status <> 'resuelta' OR p_show IS NULL THEN
    PERFORM public.rifa_fail('INVALID_INPUT', NULL, '22023');
  END IF;
  UPDATE public.rifas SET show_winner_public = p_show WHERE id = p_rifa;
  INSERT INTO public.rifa_events (rifa_id, actor_id, kind, detail)
    VALUES (p_rifa, p_actor, 'ganador_publico', jsonb_build_object('show', p_show));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.rifa_set_winner_public_v1(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rifa_set_winner_public_v1(uuid,uuid,boolean) TO service_role;

-- Preserve the existing private-raffle access checks and manager fixes.
DO $$
DECLARE definition text; needle text; replacement text;
BEGIN
  needle := $old$'winning_number', r.winning_number, 'hidden', r.hidden_at IS NOT NULL,$old$;
  replacement := $new$'winning_number', r.winning_number, 'show_winner_public', r.show_winner_public,
    'winner', CASE WHEN r.status = 'resuelta' AND r.show_winner_public THEN (
      SELECT jsonb_build_object('name', coalesce(t.buyer_name, u.display_name), 'avatar_url', u.avatar_url)
      FROM public.rifa_tickets t LEFT JOIN public.users u ON u.id = t.buyer_id
      WHERE t.id = r.winner_ticket_id AND t.rifa_id = r.id AND t.state = 'pagado'
    ) END, 'hidden', r.hidden_at IS NOT NULL,$new$;
  SELECT pg_get_functiondef('public.rifa_public_view_v1(text,uuid)'::regprocedure) INTO definition;
  IF position(needle IN definition) = 0 THEN RAISE EXCEPTION 'Public raffle view changed; review migration 186'; END IF;
  EXECUTE replace(definition, needle, replacement);

  SELECT pg_get_functiondef('public.rifa_creator_view_v1(uuid,text)'::regprocedure) INTO definition;
  IF position(needle IN definition) = 0 THEN RAISE EXCEPTION 'Creator raffle view changed; review migration 186'; END IF;
  EXECUTE replace(definition, needle,
    $new$'winning_number', r.winning_number, 'show_winner_public', r.show_winner_public, 'hidden', r.hidden_at IS NOT NULL,$new$);
END $$;

COMMIT;
