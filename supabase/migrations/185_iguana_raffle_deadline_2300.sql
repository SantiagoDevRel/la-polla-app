-- Owner request, 2026-11-13: keep La Iguana number sales open until 23:00
-- America/Bogota today, replacing the previously configured 22:30 deadline.
-- Raffle sales and the management UI already share rifas.draw_at as their lock.
-- This changes only that raffle's deadline; tickets and payments stay intact.
BEGIN;

DO $$
DECLARE
  raffle record;
  deadline timestamptz := timestamptz '2026-11-13 23:00:00 America/Bogota';
BEGIN
  SELECT id, draw_at, status, resolved_at, winning_number INTO raffle FROM public.rifas
  WHERE id = '495aa5b1-767c-47bb-8487-15223ab44f63'
    AND slug = 'rifa-solidaria-la-iguana-camiseta'
  FOR UPDATE;

  -- Synthetic databases have no production raffle. Historical replays must
  -- never reopen a raffle that has since been resolved or rescheduled.
  IF NOT FOUND OR raffle.draw_at = deadline OR raffle.status <> 'abierta'
     OR raffle.resolved_at IS NOT NULL OR raffle.winning_number IS NOT NULL THEN
    RETURN;
  END IF;
  IF raffle.draw_at <> timestamptz '2026-11-13 22:30:00 America/Bogota' THEN
    RAISE EXCEPTION 'La Iguana deadline changed; review before applying migration 185';
  END IF;

  UPDATE public.rifas SET draw_at = deadline WHERE id = raffle.id;
END $$;

COMMIT;
