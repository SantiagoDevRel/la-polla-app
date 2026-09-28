-- LOCAL ONLY. Objects that exist in production but were created by hand
-- (SQL editor / dashboard) before the repo recorded them. 055–078 alter or
-- revoke them; here they are recreated empty or as no-op bodies, only when
-- missing, so the chain replays. Later migrations (061 snapshot) replace the
-- bodies that the repo does record.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['matches_backup_dedup_20260505','matches_backup_dedup_v2_20260505',
    '_backup_dedup_matches_20260506','matches_backup_2026_05_12','_backup_zero_scores_20260610',
    'matches_backup_r32_20260628'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      EXECUTE format('CREATE TABLE public.%I (LIKE public.matches)', t);
    END IF;
  END LOOP;
  IF to_regclass('public._backup_dedup_pollas_match_ids_20260506') IS NULL THEN
    CREATE TABLE public._backup_dedup_pollas_match_ids_20260506 (id uuid, match_ids uuid[]);
  END IF;
  IF to_regclass('public._backup_dedup_predictions_20260506') IS NULL THEN
    CREATE TABLE public._backup_dedup_predictions_20260506 (LIKE public.predictions);
  END IF;
END $$;

DO $$
DECLARE spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['matches_prevent_status_regress()', 'trigger', 'BEGIN RETURN NEW; END'],
    ['notify_on_perfect_pick()', 'trigger', 'BEGIN RETURN NEW; END'],
    ['notify_on_rank_change()', 'trigger', 'BEGIN RETURN NEW; END'],
    ['notify_last_place(uuid)', 'void', 'BEGIN RETURN; END'],
    ['notify_polla_finished(uuid)', 'void', 'BEGIN RETURN; END'],
    ['flip_stale_live_matches()', 'integer', 'BEGIN RETURN 0; END'],
    ['update_match_live_espn(uuid,text,text,integer,integer,integer)', 'boolean', 'BEGIN RETURN false; END']
  ] LOOP
    IF to_regprocedure('public.' || spec[1]) IS NULL THEN
      EXECUTE format('CREATE FUNCTION public.%s RETURNS %s LANGUAGE plpgsql AS $f$%s$f$', spec[1], spec[2], spec[3]);
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_rank_change') THEN
    CREATE TRIGGER trg_notify_rank_change AFTER UPDATE OF rank ON public.polla_participants
      FOR EACH ROW EXECUTE FUNCTION public.notify_on_rank_change();
  END IF;
END $$;
