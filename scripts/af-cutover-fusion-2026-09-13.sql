DO $$
DECLARE
  p record;
  leg public.matches%ROWTYPE;
  af public.matches%ROWTYPE;
  n integer := 0;
  lh text; la text; ah text; aa text;
  v_puntaje integer;
  v_rivales integer;
BEGIN
  PERFORM set_config('lock_timeout', '15s', true);
  IF to_regclass('public.matches_backup_20260913_af_cutover') IS NULL THEN
    RAISE EXCEPTION 'fusión abortada: el respaldo no existe; corre primero el paso 3';
  END IF;
  FOR p IN SELECT * FROM (VALUES
    -- PARES: pega aquí los par_para_fusionar aprobados, separados por coma, en lugar de la línea NULL.
    ('c108a803-163b-461a-8460-77e67df75a3b'::uuid, '1f7cb3e8-9fec-4e06-b9fd-c01500fd7ddb'::uuid, '1. FC Union Berlin', 'FC Schalke 04', 3),
    ('0565a6de-a9cf-4612-a67a-2eed95cc7ba3'::uuid, 'c16dabc7-6c7d-4a78-ad8d-fc9bd3c685be'::uuid, 'TSG 1899 Hoffenheim', 'VfB Stuttgart', 3),
    ('4f9166dc-5201-4c61-83db-b53acb765cf1'::uuid, '84d88f45-f90f-4b5d-9fc7-820ef7832803'::uuid, 'Getafe CF', 'RC Deportivo La Coruña', 3),
    ('bd9f0bdc-c482-442f-aedf-c31649d035aa'::uuid, '0dc4ff94-eeb6-47bd-a548-665952b4a960'::uuid, 'Stade Rennais FC 1901', 'Olympique de Marseille', 3),
    ('9dc97b39-0f30-4132-bdd3-7dc5244120d6'::uuid, '77cacc40-ba4b-4145-a294-88c10874328d'::uuid, 'RC Strasbourg Alsace', 'AS Monaco FC', 3),
    ('7d5e2302-31d4-4fca-8ed1-4e7a236a3317'::uuid, '0e6c0a0e-3e3c-4703-8afa-06907d415074'::uuid, 'Crystal Palace FC', 'Ipswich Town FC', 3),
    ('d3b9a14d-a018-4150-aed6-ad2b4e5b8761'::uuid, 'a6620840-bff9-4236-ba8d-fd5589246351'::uuid, 'Venezia FC', 'ACF Fiorentina', 3),
    ('aea492ab-6149-42f2-bc3c-fdff57673691'::uuid, '39b7db84-9299-4c45-9523-4eca925ab951'::uuid, 'Genoa CFC', 'Frosinone Calcio', 3)
  ) v(legacy_id, af_id, legacy_local, legacy_visitante, max_horas)
  WHERE v.legacy_id IS NOT NULL OR v.af_id IS NOT NULL LOOP
    IF p.max_horas IS NULL OR p.max_horas < 0 OR p.max_horas > 36 THEN
      RAISE EXCEPTION 'fusión abortada: el par (%, %) necesita max_horas entre 0 y 36 escrito a mano', p.legacy_id, p.af_id;
    END IF;
    SELECT * INTO leg FROM public.matches WHERE id = p.legacy_id FOR UPDATE;
    SELECT * INTO af  FROM public.matches WHERE id = p.af_id FOR UPDATE;
    IF leg.id IS NULL OR af.id IS NULL THEN
      RAISE EXCEPTION 'fusión abortada: falta la fila legacy % o la API-Football %', p.legacy_id, p.af_id;
    END IF;
    -- El par trae los nombres que el operador vio: si la fila legacy no es esa, es un error de copia.
    IF leg.home_team IS DISTINCT FROM p.legacy_local OR leg.away_team IS DISTINCT FROM p.legacy_visitante THEN
      RAISE EXCEPTION 'fusión abortada: la fila legacy % es «% – %», no «% – %»',
        p.legacy_id, leg.home_team, leg.away_team, p.legacy_local, p.legacy_visitante;
    END IF;
    IF COALESCE(af.external_id, '') NOT LIKE 'apifootball:%' OR af.final_verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'fusión abortada: % no es una fila API-Football sin verificar', p.af_id;
    END IF;
    IF COALESCE(leg.external_id, '') LIKE 'apifootball:%'
       OR EXISTS (SELECT 1 FROM unnest(leg.source_external_ids) s WHERE s LIKE 'apifootball:%') THEN
      RAISE EXCEPTION 'fusión abortada: la fila legacy % ya tiene identidad API-Football', p.legacy_id;
    END IF;
    IF leg.tournament <> af.tournament
       OR abs(extract(epoch FROM (leg.scheduled_at - af.scheduled_at))) > p.max_horas * 3600 THEN
      RAISE EXCEPTION 'fusión abortada: % y % no son del mismo torneo o están a más de % h', p.legacy_id, p.af_id, p.max_horas;
    END IF;
    -- Al menos un lado (local con local, visitante con visitante) debe coincidir como
    -- palabras completas de ≥ 3 letras. Un par de partidos distintos da 0 y aborta.
    lh := public.normalize_team_name(leg.home_team); la := public.normalize_team_name(leg.away_team);
    ah := public.normalize_team_name(af.home_team);  aa := public.normalize_team_name(af.away_team);
    v_puntaje :=
        CASE WHEN length(lh) >= 3 AND length(ah) >= 3
              AND (strpos(' ' || lh || ' ', ' ' || ah || ' ') > 0 OR strpos(' ' || ah || ' ', ' ' || lh || ' ') > 0) THEN 1 ELSE 0 END
      + CASE WHEN length(la) >= 3 AND length(aa) >= 3
              AND (strpos(' ' || la || ' ', ' ' || aa || ' ') > 0 OR strpos(' ' || aa || ' ', ' ' || la || ' ') > 0) THEN 1 ELSE 0 END;
    IF v_puntaje < 1 THEN
      RAISE EXCEPTION 'fusión abortada: «% – %» y «% – %» no comparten ningún equipo',
        leg.home_team, leg.away_team, af.home_team, af.away_team;
    END IF;
    -- Ambigüedad: cualquier otra fila del mismo torneo a 36 h que comparta un equipo con el par.
    SELECT count(*) INTO v_rivales
      FROM public.matches o
     WHERE o.tournament = leg.tournament AND o.id NOT IN (leg.id, af.id)
       AND o.scheduled_at BETWEEN leg.scheduled_at - interval '36 hours' AND leg.scheduled_at + interval '36 hours'
       AND (CASE WHEN length(public.normalize_team_name(o.home_team)) >= 3 AND length(ah) >= 3
                  AND (strpos(' ' || public.normalize_team_name(o.home_team) || ' ', ' ' || ah || ' ') > 0
                    OR strpos(' ' || ah || ' ', ' ' || public.normalize_team_name(o.home_team) || ' ') > 0
                    OR strpos(' ' || public.normalize_team_name(o.home_team) || ' ', ' ' || lh || ' ') > 0
                    OR strpos(' ' || lh || ' ', ' ' || public.normalize_team_name(o.home_team) || ' ') > 0) THEN 1 ELSE 0 END
          + CASE WHEN length(public.normalize_team_name(o.away_team)) >= 3 AND length(aa) >= 3
                  AND (strpos(' ' || public.normalize_team_name(o.away_team) || ' ', ' ' || aa || ' ') > 0
                    OR strpos(' ' || aa || ' ', ' ' || public.normalize_team_name(o.away_team) || ' ') > 0
                    OR strpos(' ' || public.normalize_team_name(o.away_team) || ' ', ' ' || la || ' ') > 0
                    OR strpos(' ' || la || ' ', ' ' || public.normalize_team_name(o.away_team) || ' ') > 0) THEN 1 ELSE 0 END) >= 1;
    IF v_rivales > 0 THEN
      RAISE EXCEPTION 'fusión abortada: «% – %» tiene % filas más con un equipo en común a 36 h; resuélvelo a mano',
        leg.home_team, leg.away_team, v_rivales;
    END IF;
    IF EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = af.id)
       OR EXISTS (SELECT 1 FROM public.pollas x WHERE af.id = ANY (x.match_ids)) THEN
      RAISE EXCEPTION 'fusión abortada: la fila API-Football % ya tiene referencias', p.af_id;
    END IF;

    INSERT INTO public.matches_backup_20260913_af_cutover
      SELECT * FROM public.matches WHERE id = af.id
    ON CONFLICT (id) DO NOTHING;
    DELETE FROM public.matches WHERE id = af.id;
    UPDATE public.matches
       SET source_external_ids = ARRAY(
             SELECT DISTINCT x FROM unnest(leg.source_external_ids || af.external_id || af.source_external_ids) x
              WHERE x IS NOT NULL)
     WHERE id = leg.id;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE EXCEPTION 'fusión abortada: no pegaste ningún par';
  END IF;
  RAISE NOTICE 'fusión: % pares aplicados', n;
END $$;
SELECT id, tournament, home_team, away_team, external_id, source_external_ids
  FROM public.matches
 WHERE EXISTS (SELECT 1 FROM unnest(source_external_ids) s WHERE s LIKE 'apifootball:%')
   AND COALESCE(external_id, '') NOT LIKE 'apifootball:%'
 ORDER BY scheduled_at;
