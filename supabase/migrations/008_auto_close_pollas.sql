-- 008_auto_close_pollas.sql
-- When every match in a polla is finished, mark the polla as ended.
-- Also update the pollas SELECT RLS so ended pollas remain visible.

CREATE OR REPLACE FUNCTION public.check_polla_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_polla_id uuid;
BEGIN
  FOR v_polla_id IN
    SELECT id FROM pollas
    WHERE match_ids @> ARRAY[NEW.id]
      AND status = 'active'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM matches
      WHERE id = ANY(
        SELECT unnest(match_ids) FROM pollas WHERE id = v_polla_id
      )
      AND status != 'finished'
    ) THEN
      UPDATE pollas SET status = 'ended' WHERE id = v_polla_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_check_polla_completion ON matches;
CREATE TRIGGER trigger_check_polla_completion
  AFTER UPDATE ON matches
  FOR EACH ROW
  WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM 'finished')
  EXECUTE FUNCTION check_polla_completion();

-- Allow visibility of ended pollas (was limited to status='active')
DROP POLICY IF EXISTS "pollas_select_active" ON pollas;
CREATE POLICY "pollas_select_active" ON pollas
  FOR SELECT USING (status IN ('active', 'ended'));
