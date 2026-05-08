-- 049_fix_normalize_country_aliases — Fix bug en migration 048.
--
-- En 048 escribí los aliases de país con `\busa\b`. PostgreSQL ARE NO
-- usa \b para word boundary (es backspace). Por eso normalize_team_name
-- nunca aplicó las reglas de USA/Czechia/Bosnia/Türkiye y el lookup #3
-- de upsert_match_safe siguió creando duplicados cuando los proveedores
-- usaban variaciones de país.
--
-- Fix: cambiar \b → \m / \M (PostgreSQL ARE word boundaries) + replace()
-- literal para casos con caracteres no-word (& y -).
-- Re-cleanup al final, ahora sí matchea.

CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
RETURNS text AS $$
DECLARE
  v text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v := lower(unaccent(p_name));
  v := regexp_replace(v, '\m(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\M', ' ', 'g');
  v := replace(v, 'munchen', 'munich');
  v := replace(v, 'paris saint germain', 'psg');
  v := replace(v, 'paris saintgermain', 'psg');
  v := replace(v, 'paris saint-germain', 'psg');
  -- País aliases. \m\M (PostgreSQL ARE word boundaries) en vez del \b
  -- erróneo de migration 048.
  v := regexp_replace(v, '\munited states of america\M', 'united states', 'g');
  v := regexp_replace(v, '\musa\M', 'united states', 'g');
  v := regexp_replace(v, '\mczechia\M', 'czech republic', 'g');
  v := regexp_replace(v, '\mbosnia and herzegovina\M', 'bosnia herzegovina', 'g');
  -- & y - no son word chars, así que \m/\M no aplica — usamos replace literal.
  v := replace(v, 'bosnia & herzegovina', 'bosnia herzegovina');
  v := replace(v, 'bosnia-herzegovina', 'bosnia herzegovina');
  v := regexp_replace(v, '\mcote d''ivoire\M', 'ivory coast', 'g');
  v := regexp_replace(v, '\mcote divoire\M', 'ivory coast', 'g');
  v := regexp_replace(v, '\mcabo verde\M', 'cape verde', 'g');
  v := regexp_replace(v, '\msouth korea\M', 'korea republic', 'g');
  v := regexp_replace(v, '\mrepublic of korea\M', 'korea republic', 'g');
  v := regexp_replace(v, '\mnorth korea\M', 'korea dpr', 'g');
  v := replace(v, 'curazao', 'curacao');
  v := replace(v, 'turkiye', 'turkey');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);
  RETURN v;
END;
$$ LANGUAGE plpgsql STABLE;

-- Re-cleanup. Ahora normalize_team_name agrupa USA/United States,
-- Czechia/Czech Republic, Bosnia variants, Türkiye/Turkey.
DO $$
DECLARE
  rec RECORD;
  keeper_id uuid;
  loser_espn_id text;
BEGIN
  FOR rec IN
    WITH groups AS (
      SELECT
        tournament,
        scheduled_at::date AS dia,
        public.normalize_team_name(home_team) AS norm_home,
        public.normalize_team_name(away_team) AS norm_away,
        array_agg(id ORDER BY created_at ASC) AS ids,
        array_agg(external_id ORDER BY created_at ASC) AS external_ids
      FROM public.matches
      WHERE home_team <> 'TBD'
      GROUP BY tournament, scheduled_at::date,
               public.normalize_team_name(home_team),
               public.normalize_team_name(away_team)
      HAVING COUNT(*) > 1
    )
    SELECT * FROM groups
  LOOP
    keeper_id := rec.ids[1];

    SELECT
      COALESCE(
        (SELECT espn_id FROM public.matches WHERE id = ANY(rec.ids[2:]) AND espn_id IS NOT NULL LIMIT 1),
        (SELECT substring(external_id from 6) FROM public.matches WHERE id = ANY(rec.ids[2:]) AND external_id LIKE 'espn:%' LIMIT 1)
      )
    INTO loser_espn_id;

    IF loser_espn_id IS NOT NULL THEN
      UPDATE public.matches SET espn_id = loser_espn_id
       WHERE id = keeper_id AND (espn_id IS NULL OR espn_id IS DISTINCT FROM loser_espn_id);
    END IF;

    UPDATE public.predictions SET match_id = keeper_id WHERE match_id = ANY(rec.ids[2:]);
    DELETE FROM public.matches WHERE id = ANY(rec.ids[2:]);
  END LOOP;
END $$;
