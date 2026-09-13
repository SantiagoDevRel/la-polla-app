-- LOCAL ONLY. Suite de regresión de identidad de partidos (migración 110).
-- Todo vive dentro de BEGIN … ROLLBACK: nada persiste.
-- Correr desde la raíz del repo (el \i es relativo):
--   psql -X -v ON_ERROR_STOP=1 -f scripts/match-identity-check.sql
-- Las filas "legacy" se insertan directo en matches a propósito: reproducen
-- estados de prod que el escritor 103 ya no generaría (duplicados viejos).
BEGIN;
SELECT to_regclass('public.match_provider_ids') IS NULL AS need_110 \gset
\if :need_110
\i supabase/migrations/110_match_identity_crosswalk.sql
\endif

DO $$
DECLARE
  fd_lens uuid; espn_lens uuid; unique_row uuid; linked uuid; leg1 uuid; leg2 uuid;
  par_a uuid; par_b uuid; fd_final uuid; espn_final uuid; bar_fd uuid; bsc uuid;
  league_a uuid; league_b uuid; merged_tbd uuid; merged_real uuid; clean_espn uuid;
  name_only uuid; stale_row uuid;
  k text; r record; n integer; alerts_before integer;
BEGIN
  -- Crosswalk sintético con los ids reales de los casos del plan.
  INSERT INTO team_provider_ids(provider, provider_team_id, af_team_id, source, anchors) VALUES
    ('football-data','546',116,'check',2), ('espn','175',116,'check',2),      -- Lens
    ('football-data','498',228,'check',2), ('espn','2250',228,'check',2),     -- Sporting CP
    ('football-data','81',529,'check',2),  ('espn','83',529,'check',2),       -- FC Barcelona
    ('espn','2686',1152,'check',2),                                           -- Barcelona SC
    ('football-data','524',85,'check',2),  ('football-data','57',42,'check',2), -- PSG, Arsenal
    ('espn','9001',9001,'check',2), ('espn','9002',9002,'check',2),
    ('espn','9003',9003,'check',2), ('espn','9004',9004,'check',2),
    ('football-data','721',173,'check',2), ('espn','11420',173,'check',2),   -- RB Leipzig
    ('espn','148',197,'check',2);                                              -- PSV (FD 674 sin mapear)

  -- 1) Lens FD 546 y ESPN 175 = misma identidad, aunque los nombres no normalicen igual.
  ASSERT canonical_team_key('identity_test','Racing Club de Lens','football-data',NULL,'https://crests.football-data.org/546.png') = 'af:116',
    'FD 546 should resolve to AF 116';
  ASSERT canonical_team_key('identity_test','Lens','espn',NULL,'https://a.espncdn.com/i/teamlogos/soccer/500/175.png') = 'af:116',
    'ESPN 175 should resolve to AF 116';
  ASSERT canonical_team_key('identity_test','Lens','api-football','116',NULL) = 'af:116', 'AF explicit id';
  -- Bandera de otro host = desconocida.
  ASSERT canonical_team_key('identity_test','Lens','football-data',NULL,'https://a.espncdn.com/i/teamlogos/soccer/500/175.png') = 'n:lens',
    'Cross-host flag must not derive an id';
  ASSERT canonical_team_key('identity_test','TBD Home','espn',NULL,NULL) IS NULL, 'Placeholder has no key';
  ASSERT (SELECT provider FROM provider_team_id_from_flag('https://crests.football-data.org/546.png?x=1')) IS NULL,
    'Flag parser must match the exact URL';

  fd_lens := upsert_match_safe('990000101','identity_test',2,'league_stage','Racing Club de Lens','Sporting Clube de Portugal',
    'https://crests.football-data.org/546.png','https://crests.football-data.org/498.png','2030-10-13 16:45Z',null,null,null,'scheduled',null,null,null,true);
  r := plan_match_upsert('espn','990000102','identity_test','league_stage',NULL,'Lens','Sporting CP',NULL,NULL,
    'https://a.espncdn.com/i/teamlogos/soccer/500/175.png','https://a.espncdn.com/i/teamlogos/soccer/500/2250.png',
    '2030-10-13 16:45Z',true,'scheduled');
  ASSERT r.decision = 'link' AND r.match_id = fd_lens, format('Lens ESPN observation should link to the FD row: %s', r);

  -- Duplicado legacy (dos filas del mismo partido, como los 13 pares de Champions).
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('espn:990000102','identity_test','league_stage','Lens','Sporting CP',
    'https://a.espncdn.com/i/teamlogos/soccer/500/175.png','https://a.espncdn.com/i/teamlogos/soccer/500/2250.png','2030-10-13 16:45Z','scheduled')
  RETURNING id INTO espn_lens;
  r := plan_match_upsert('api-football','990000103','identity_test','league_stage',2,'Lens','Sporting CP','116','228',NULL,NULL,
    '2030-10-13 16:45Z',true,'NS');
  ASSERT r.decision = 'ambiguous' AND r.candidate_count = 2, format('Duplicate pair must be ambiguous: %s', r);

  -- 8) link_match_provider_id rechaza ambiguos y alerta; no escribe vínculo.
  SELECT count(*) INTO alerts_before FROM admin_alerts WHERE dedupe_key = 'fixture_link_refused:api-football:990000103';
  linked := link_match_provider_id('api-football','990000103','identity_test','league_stage',2,'Lens','Sporting CP','116','228',NULL,NULL,
    '2030-10-13 16:45Z',true,'NS');
  ASSERT linked IS NULL, 'Ambiguous link must be refused';
  ASSERT NOT EXISTS (SELECT 1 FROM match_provider_ids WHERE provider='api-football' AND provider_match_id='990000103'), 'Refused link wrote a row';
  ASSERT (SELECT count(*) FROM admin_alerts WHERE dedupe_key = 'fixture_link_refused:api-football:990000103') = 1, 'Refusal alert missing';

  -- Un vínculo único con claves af: iguales sí se registra, y es idempotente.
  unique_row := upsert_match_safe('990000201','identity_test',3,'league_stage','FC Barcelona','Racing Club de Lens',
    'https://crests.football-data.org/81.png','https://crests.football-data.org/546.png','2030-10-21 19:00Z',null,null,null,'scheduled',null,null,null,true);
  linked := link_match_provider_id('api-football','990000202','identity_test','league_stage',3,'Barcelona','Lens','529','116',NULL,NULL,
    '2030-10-21 19:00Z',true,'NS');
  ASSERT linked = unique_row, 'Unique af: candidate should link';
  ASSERT link_match_provider_id('api-football','990000202','identity_test','league_stage',3,'Barcelona','Lens','529','116',NULL,NULL,
    '2030-10-21 19:05Z',true,'NS') = unique_row, 'Re-link should be idempotent';
  r := resolve_match_identity('identity_test','api-football','990000202','af:529','af:116','Barcelona','Lens','2030-12-01 19:00Z',true,'league_stage',3);
  ASSERT r.outcome = 'linked' AND r.teams_agree, 'Known provider id resolves at any time difference';
  r := resolve_match_identity('other_test','api-football','990000202','af:529','af:116','Barcelona','Lens','2030-10-21 19:00Z',true,'league_stage',3);
  ASSERT r.outcome = 'conflict', 'Provider id is tournament-scoped';
  -- Sin claves af: no hay vínculo (nombres solos no deciden identidad).
  ASSERT link_match_provider_id('api-football','990000203','identity_test','league_stage',3,'FC Barcelona','Racing Club de Lens',NULL,NULL,NULL,NULL,
    '2030-10-21 19:00Z',true,'NS') IS NULL, 'Name-only link must be refused';
  -- Un segundo id del mismo proveedor para la misma fila se rechaza.
  ASSERT link_match_provider_id('api-football','990000204','identity_test','league_stage',3,'Barcelona','Lens','529','116',NULL,NULL,
    '2030-10-21 19:00Z',true,'NS') IS NULL, 'Second provider id for the same match must be refused';

  -- 8b) Crítica #6 en sus dos guardas. Fila sin banderas (claves n:) con nombres
  --     iguales: plan_match_upsert la encuentra por nombre, pero un vínculo exige
  --     claves af: iguales en la fila, no solo en la observación entrante.
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, scheduled_at, status)
  VALUES ('990000251','identity_test','league_stage','Le Mans FC','Omega Town','2032-02-07 18:00Z','scheduled')
  RETURNING id INTO name_only;
  r := plan_match_upsert('api-football','990000252','identity_test','league_stage',NULL,'Le Mans','Omega Town','111','222',NULL,NULL,
    '2032-02-07 18:00Z',true,'NS');
  ASSERT r.decision = 'link' AND r.match_id = name_only, format('Plan should find the n:-keyed row by names: %s', r);
  ASSERT link_match_provider_id('api-football','990000252','identity_test','league_stage',NULL,'Le Mans','Omega Town','111','222',NULL,NULL,
    '2032-02-07 18:00Z',true,'NS') IS NULL, 'af: observation must not link to an n:-keyed row';
  ASSERT NOT EXISTS (SELECT 1 FROM match_provider_ids WHERE match_id = name_only), 'Refused af-vs-n: link wrote a row';
  ASSERT (SELECT body FROM admin_alerts WHERE dedupe_key = 'fixture_link_refused:api-football:990000252') LIKE '%keys_not_equal_af%',
    'af-vs-n: refusal must alert with keys_not_equal_af';
  -- Observación sin ids (claves n: también de este lado) y nombres iguales: nada.
  ASSERT link_match_provider_id('espn','990000253','identity_test','league_stage',NULL,'Le Mans FC','Omega Town',NULL,NULL,NULL,NULL,
    '2032-02-07 18:00Z',true,'scheduled') IS NULL, 'n:-vs-n: link must be refused';
  ASSERT NOT EXISTS (SELECT 1 FROM match_provider_ids WHERE match_id = name_only), 'n:-vs-n: link wrote a row';
  ASSERT NOT EXISTS (SELECT 1 FROM admin_alerts WHERE dedupe_key = 'fixture_link_refused:espn:990000253'),
    'Keyless observations are normal without crosswalk and must not alert';

  -- 8c) Clave guardada vieja: un escritor cambió la bandera sin recalcular la
  --     clave (af:116 guardada, n: recalculada). No sirve para vincular.
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_key, away_team_key, scheduled_at, status)
  VALUES ('990000261','identity_test','league_stage','Racing Club de Lens','Sporting Clube de Portugal','af:116','af:228',
    '2032-03-06 18:00Z','scheduled')
  RETURNING id INTO stale_row;
  ASSERT link_match_provider_id('api-football','990000262','identity_test','league_stage',NULL,'Lens','Sporting CP','116','228',NULL,NULL,
    '2032-03-06 18:00Z',true,'NS') IS NULL, 'Stale stored key must not link';
  ASSERT NOT EXISTS (SELECT 1 FROM match_provider_ids WHERE match_id = stale_row), 'Stale-key link wrote a row';
  ASSERT (SELECT body FROM admin_alerts WHERE dedupe_key = 'fixture_link_refused:api-football:990000262') LIKE '%stale_team_key%',
    'Stale-key refusal must alert with stale_team_key';

  -- 2) Barcelona y Barcelona SC nunca se fusionan.
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('990000301','identity_test','league_stage','FC Barcelona','Real Madrid CF',
    'https://a.espncdn.com/i/teamlogos/soccer/500/2686.png','https://crests.football-data.org/86.png','2030-11-01 20:00Z','scheduled')
  RETURNING id INTO bar_fd;
  k := match_team_key('identity_test','990000301','FC Barcelona','https://a.espncdn.com/i/teamlogos/soccer/500/2686.png');
  ASSERT k = 'n:barcelona', format('FD row with the ESPN 2686 logo must not get Barcelona SC identity: %s', k);
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('990000302','identity_test','league_stage','FC Barcelona','Real Madrid CF',
    'https://crests.football-data.org/81.png','https://crests.football-data.org/86.png','2030-11-08 20:00Z','scheduled');
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('espn:990000303','identity_test','league_stage','Barcelona SC','Emelec',
    'https://a.espncdn.com/i/teamlogos/soccer/500/2686.png',NULL,'2030-11-08 21:00Z','scheduled')
  RETURNING id INTO bsc;
  ASSERT NOT team_side_match('af:529','barcelona','af:1152','barcelona'), 'Different af: keys never fall back to names';
  r := plan_match_upsert('espn','990000304','identity_test','league_stage',NULL,'Barcelona SC','Emelec',NULL,NULL,
    'https://a.espncdn.com/i/teamlogos/soccer/500/2686.png',NULL,'2030-11-08 20:00Z',true,'scheduled');
  -- La única fila compatible es la de Barcelona SC (la de FC Barcelona es af:529).
  ASSERT r.decision = 'link' AND r.match_id = bsc, format('Barcelona SC must never link to FC Barcelona: %s', r);
  ASSERT NOT EXISTS (SELECT 1 FROM fixture_duplicate_pairs() p
                      WHERE bsc IN (p.match_a, p.match_b)), 'Detector must not pair Barcelona with Barcelona SC';

  -- 3) Dos partidos paralelos con el mismo saque nunca se fusionan.
  par_a := upsert_match_safe('espn:990000401','identity_test',4,'league_stage','Alpha FC','Beta FC',
    'https://a.espncdn.com/i/teamlogos/soccer/500/9001.png','https://a.espncdn.com/i/teamlogos/soccer/500/9002.png','2030-11-15 18:00Z',null,null,null,'scheduled',null,null,null,true);
  par_b := upsert_match_safe('espn:990000402','identity_test',4,'league_stage','Gamma FC','Delta FC',
    'https://a.espncdn.com/i/teamlogos/soccer/500/9003.png','https://a.espncdn.com/i/teamlogos/soccer/500/9004.png','2030-11-15 18:00Z',null,null,null,'scheduled',null,null,null,true);
  ASSERT par_a <> par_b, 'Parallel fixtures collapsed by the writer';
  r := plan_match_upsert('api-football','990000403','identity_test','league_stage',4,'Gamma','Delta','9003','9004',NULL,NULL,'2030-11-15 18:00Z',true,'NS');
  ASSERT r.decision = 'link' AND r.match_id = par_b, format('Parallel fixture resolved to the wrong row: %s', r);
  ASSERT NOT EXISTS (SELECT 1 FROM fixture_duplicate_pairs() p WHERE par_a IN (p.match_a, p.match_b)), 'Parallel fixtures flagged as duplicates';

  -- 4) Ida y vuelta con local/visitante invertidos: filas distintas.
  leg1 := upsert_match_safe('espn:990000501','identity_test',null,'round_of_16','Alpha FC','Beta FC',
    'https://a.espncdn.com/i/teamlogos/soccer/500/9001.png','https://a.espncdn.com/i/teamlogos/soccer/500/9002.png','2030-12-01 19:00Z',null,null,null,'scheduled',null,null,null,true);
  leg2 := upsert_match_safe('espn:990000502','identity_test',null,'round_of_16','Beta FC','Alpha FC',
    'https://a.espncdn.com/i/teamlogos/soccer/500/9002.png','https://a.espncdn.com/i/teamlogos/soccer/500/9001.png','2030-12-08 19:00Z',null,null,null,'scheduled',null,null,null,true);
  ASSERT leg1 <> leg2, 'Two-legged tie collapsed';
  r := plan_match_upsert('api-football','990000503','identity_test','round_of_16',NULL,'Beta','Alpha','9002','9001',NULL,NULL,'2030-12-08 19:30Z',true,'NS');
  ASSERT r.decision = 'link' AND r.match_id = leg2, format('Second leg resolved to the wrong row: %s', r);
  r := plan_match_upsert('api-football','990000504','identity_test','round_of_16',NULL,'Beta','Alpha','9002','9001',NULL,NULL,'2030-12-02 19:00Z',true,'NS');
  ASSERT r.decision = 'insert', format('Reversed leg a day after leg 1 must not link: %s', r);
  ASSERT NOT EXISTS (SELECT 1 FROM fixture_duplicate_pairs() p WHERE leg1 IN (p.match_a, p.match_b)), 'Legs flagged as duplicates';

  -- 5) Final PSG–Arsenal: FD 16:00 y ESPN 19:00 (logos FD heredados en la fila ESPN).
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('990000601','identity_test','final','Paris Saint-Germain FC','Arsenal FC',
    'https://crests.football-data.org/524.png','https://crests.football-data.org/57.png','2031-05-30 16:00Z','finished')
  RETURNING id INTO fd_final;
  INSERT INTO matches(external_id, tournament, phase, match_day, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('espn:990000602','identity_test','final',1,'Paris Saint-Germain','Arsenal',
    'https://crests.football-data.org/524.png','https://crests.football-data.org/57.png','2031-05-30 19:00Z','scheduled')
  RETURNING id INTO espn_final;
  ASSERT EXISTS (SELECT 1 FROM fixture_duplicate_pairs() p
                  WHERE ARRAY[p.match_a, p.match_b] @> ARRAY[fd_final, espn_final]), 'PSG–Arsenal final not detected';
  -- Con claves af: en ambos lados, una final invertida a 2 días también es la misma.
  ASSERT fixture_identity_rule('af:85','af:42','psg','arsenal','2031-05-30 16:00Z',true,'final',NULL,
    'af:42','af:85','arsenal','psg','2031-06-01 16:00Z',true,'final',NULL,interval '2 hours',false) = 'final_any_order_7d',
    'Final any-order rule';
  ASSERT fixture_identity_rule('af:85','af:42','psg','arsenal','2031-05-30 16:00Z',true,'semi_finals',NULL,
    'af:42','af:85','arsenal','psg','2031-06-01 16:00Z',true,'semi_finals',NULL,interval '2 hours',false) IS NULL,
    'Any-order rule is only for finals';
  -- Cualquier orden exige claves af: en los cuatro lados: con n: no aplica.
  ASSERT fixture_identity_rule('n:psg','n:arsenal','psg','arsenal','2031-05-30 16:00Z',true,'final',NULL,
    'n:arsenal','n:psg','arsenal','psg','2031-06-01 16:00Z',true,'final',NULL,interval '2 hours',false) IS NULL,
    'Reversed final with n: keys must not match';
  ASSERT fixture_identity_rule('af:85','af:42','psg','arsenal','2031-05-30 16:00Z',true,'final',NULL,
    'n:arsenal','af:85','arsenal','psg','2031-06-01 16:00Z',true,'final',NULL,interval '2 hours',false) IS NULL,
    'Reversed final with one n: key must not match';

  -- 5a) Fecha provisional: mismo par a ≤3 d coincide; a 4 d ya no.
  ASSERT fixture_identity_rule('n:omega','n:sigma','omega','sigma','2031-04-01 18:00Z',false,'round_of_16',NULL,
    'n:omega','n:sigma','omega','sigma','2031-04-03 18:00Z',true,'round_of_16',NULL,interval '2 hours',false) = 'provisional_3d',
    'Provisional pair 2 days apart should match';
  ASSERT fixture_identity_rule('n:omega','n:sigma','omega','sigma','2031-04-01 18:00Z',false,'round_of_16',NULL,
    'n:omega','n:sigma','omega','sigma','2031-04-05 18:00Z',true,'round_of_16',NULL,interval '2 hours',false) IS NULL,
    'Provisional pair 4 days apart must not match';

  -- 5c) Alias: solo los revisados cuentan (en otro torneo para no afectar al resto).
  INSERT INTO team_name_aliases(scope, name_key, af_team_id, reviewed, source)
  VALUES ('alias_test', normalize_team_name('Le Mans FC'), 111, false, 'check');
  k := canonical_team_key('alias_test','Le Mans FC','football-data',NULL,NULL);
  ASSERT k = 'n:le mans', format('Unreviewed alias must be ignored: %s', k);
  UPDATE team_name_aliases SET reviewed = true WHERE scope = 'alias_test';
  k := canonical_team_key('alias_test','Le Mans FC','football-data',NULL,NULL);
  ASSERT k = 'af:111', format('Reviewed alias should apply: %s', k);
  ASSERT canonical_team_key('identity_test','Le Mans FC','football-data',NULL,NULL) = 'n:le mans', 'Tournament alias leaked to another tournament';

  -- 5b) Rival sin id (FD 674 "PSV" vs ESPN "PSV Eindhoven"): el detector alerta por
  --     equipo compartido a <6 h, pero el resolvedor NO lo usa para vincular.
  INSERT INTO matches(external_id, tournament, phase, match_day, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('990000651','identity_test','league_stage',2,'RB Leipzig','PSV',
    'https://crests.football-data.org/721.png','https://crests.football-data.org/674.png','2030-10-13 19:00Z','scheduled')
  RETURNING id INTO par_a;
  INSERT INTO matches(external_id, tournament, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('espn:990000652','identity_test','league_stage','RB Leipzig','PSV Eindhoven',
    'https://a.espncdn.com/i/teamlogos/soccer/500/11420.png','https://a.espncdn.com/i/teamlogos/soccer/500/148.png','2030-10-13 19:00Z','scheduled')
  RETURNING id INTO par_b;
  ASSERT (SELECT p.rule FROM fixture_duplicate_pairs() p
           WHERE ARRAY[p.match_a, p.match_b] @> ARRAY[par_a, par_b]) = 'shared_team_window', 'Shared-team duplicate not detected';
  r := resolve_match_identity('identity_test','api-football','990000653','af:173','af:197','RB Leipzig','PSV Eindhoven','2030-10-13 19:00Z',true,'league_stage',2);
  ASSERT r.outcome = 'matched' AND r.match_id = par_b, format('Shared-team rule must not affect linking: %s', r);

  -- 6) Fase de liga: jornada NULL nunca ensancha; jornada igual en ambos sí.
  INSERT INTO matches(external_id, tournament, phase, match_day, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('espn:990000701','identity_test','league_stage',NULL,'Gamma FC','Alpha FC',
    'https://a.espncdn.com/i/teamlogos/soccer/500/9003.png','https://a.espncdn.com/i/teamlogos/soccer/500/9001.png','2031-01-10 18:00Z','scheduled')
  RETURNING id INTO league_a;
  INSERT INTO matches(external_id, tournament, phase, match_day, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, status)
  VALUES ('espn:990000702','identity_test','league_stage',6,'Gamma FC','Alpha FC',
    'https://a.espncdn.com/i/teamlogos/soccer/500/9003.png','https://a.espncdn.com/i/teamlogos/soccer/500/9001.png','2031-01-16 18:00Z','scheduled')
  RETURNING id INTO league_b;
  ASSERT NOT EXISTS (SELECT 1 FROM fixture_duplicate_pairs() p
                      WHERE ARRAY[p.match_a, p.match_b] @> ARRAY[league_a, league_b]), 'NULL match_day widened the league window';
  r := resolve_match_identity('identity_test',NULL,NULL,'af:9003','af:9001','Gamma','Alpha','2031-01-11 18:00Z',true,'league_stage',NULL);
  ASSERT r.outcome = 'none', format('NULL match_day must not match a confirmed row 1 day away: %s', r);
  r := resolve_match_identity('identity_test',NULL,NULL,'af:9003','af:9001','Gamma','Alpha','2031-01-22 18:00Z',true,'league_stage',NULL);
  ASSERT r.outcome = 'none', format('NULL incoming match_day widened: %s', r);
  r := resolve_match_identity('identity_test',NULL,NULL,'af:9003','af:9001','Gamma','Alpha','2031-01-22 18:00Z',true,'league_stage',6);
  ASSERT r.outcome = 'matched' AND r.match_id = league_b AND r.rule = 'league_matchday_8d', format('Equal match_day should widen: %s', r);
  r := plan_match_upsert('api-football','990000703','identity_test','league_stage',6,'Gamma','Alpha','9003','9001',NULL,NULL,'2031-03-01 18:00Z',true,'NS');
  ASSERT r.decision = 'block' AND r.reason = 'same_pair_same_matchday', format('Same pair + same match_day must block insert: %s', r);
  r := plan_match_upsert('api-football','990000704','identity_test','league_stage',7,'Gamma','Alpha','9003','9001',NULL,NULL,'2031-03-01 18:00Z',false,'TBD');
  ASSERT r.decision = 'block' AND r.reason = 'unconfirmed_or_postponed', format('AF must not insert TBD fixtures: %s', r);
  r := plan_match_upsert('api-football','990000705','identity_test',NULL,7,'Gamma','Alpha','9003','9001',NULL,NULL,'2031-03-01 18:00Z',true,'NS');
  ASSERT r.decision = 'block' AND r.reason = 'unknown_phase', format('AF must not insert unknown rounds: %s', r);

  -- 7) El backfill salta las filas TBD fusionadas y las de espn_id ≠ external_id.
  INSERT INTO matches(external_id, espn_id, tournament, phase, home_team, away_team, scheduled_at, status)
  VALUES ('espn:990000801','990000802','identity_test','semi_finals','TBD Home','TBD Away','2031-02-01 18:00Z','scheduled')
  RETURNING id INTO merged_tbd;
  INSERT INTO matches(external_id, espn_id, tournament, phase, home_team, away_team, scheduled_at, status)
  VALUES ('espn:990000803','990000804','identity_test','semi_finals','Omega FC','Sigma FC','2031-02-08 18:00Z','scheduled')
  RETURNING id INTO merged_real;
  INSERT INTO matches(external_id, espn_id, source_external_ids, tournament, phase, home_team, away_team, scheduled_at, status)
  VALUES ('990000805','990000806',ARRAY['990000805','espn:990000806'],'identity_test','semi_finals','Kappa FC','Lambda FC','2031-02-15 18:00Z','scheduled')
  RETURNING id INTO clean_espn;
  PERFORM backfill_match_provider_ids();
  ASSERT NOT EXISTS (SELECT 1 FROM match_provider_ids WHERE match_id IN (merged_tbd, merged_real)), 'Merged TBD rows must be skipped';
  ASSERT (SELECT count(*) FROM match_provider_ids WHERE match_id = clean_espn) = 2, 'FD row with a linked ESPN id should get both links';
  ASSERT (SELECT source FROM match_provider_ids WHERE provider='espn' AND provider_match_id='990000806') = 'backfill:source_external_ids';
  PERFORM backfill_match_provider_ids();
  ASSERT (SELECT count(*) FROM match_provider_ids WHERE match_id = clean_espn) = 2, 'Backfill must be idempotent';
  r := resolve_match_identity('identity_test','espn','990000804','n:omega','n:sigma','Omega FC','Sigma FC','2031-02-08 18:00Z',true,'semi_finals',NULL);
  ASSERT r.outcome = 'matched' AND r.rule = 'same_pair_window', format('Merged row id must not act as a provider link: %s', r);

  -- Re-key revisado: n:→af: se aplica solo; af:→otra af: solo con permiso.
  PERFORM refresh_match_team_keys('identity_test', true, false);
  ASSERT (SELECT home_team_key FROM matches WHERE id = fd_lens) = 'af:116', 'Initial key not applied';
  ASSERT (SELECT home_team_key FROM matches WHERE id = bar_fd) = 'n:barcelona', 'Cross-host Barcelona row got an af: key';
  UPDATE team_provider_ids SET af_team_id = 99116 WHERE provider = 'football-data' AND provider_team_id = '546';
  SELECT count(*) INTO n FROM refresh_match_team_keys('identity_test', true, false) WHERE change = 'rekey' AND NOT applied;
  ASSERT n >= 1, 'Re-key must be reported and not applied by default';
  ASSERT (SELECT home_team_key FROM matches WHERE id = fd_lens) = 'af:116', 'Re-key applied without p_allow_rekey';
  UPDATE team_provider_ids SET af_team_id = 116 WHERE provider = 'football-data' AND provider_team_id = '546';

  -- 9) El detector encuentra los duplicados sintéticos y no repite alertas.
  PERFORM detect_duplicate_fixtures();
  ASSERT EXISTS (SELECT 1 FROM admin_alerts WHERE kind = 'fixture_duplicate'
                  AND dedupe_key IN ('fixture_duplicate:' || least(fd_lens, espn_lens) || ':' || greatest(fd_lens, espn_lens))),
    'Lens duplicate alert missing';
  ASSERT EXISTS (SELECT 1 FROM admin_alerts WHERE kind = 'fixture_duplicate'
                  AND dedupe_key = 'fixture_duplicate:' || least(fd_final, espn_final) || ':' || greatest(fd_final, espn_final)),
    'Final duplicate alert missing';
  SELECT alerts_created INTO n FROM detect_duplicate_fixtures();
  ASSERT n = 0, 'Detector re-created alerts';

  -- 10) Permisos: anon/authenticated sin EXECUTE ni acceso a tablas nuevas.
  ASSERT NOT has_function_privilege('anon', 'public.link_match_provider_id(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.link_match_provider_id(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.detect_duplicate_fixtures()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.plan_match_upsert(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,boolean,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.refresh_match_team_keys(text,boolean,boolean)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.resolve_match_identity(text,text,text,text,text,text,text,timestamptz,boolean,text,integer)', 'EXECUTE');
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public'
     AND p.proname IN ('is_placeholder_team_name','provider_team_id_from_flag','match_provider_from_external_id','provider_external_id',
       'canonical_team_key','match_team_key','team_side_match','fixture_identity_rule','resolve_match_identity','plan_match_upsert',
       'link_match_provider_id','refresh_match_team_keys','fixture_duplicate_pairs','detect_duplicate_fixtures',
       'match_provider_id_candidates','backfill_match_provider_ids')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR NOT p.prosecdef OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));
  ASSERT n = 0, format('%s new functions are executable by anon/authenticated or lack SECURITY DEFINER/search_path', n);
  ASSERT NOT has_table_privilege('anon', 'public.match_provider_ids', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.team_provider_ids', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.match_schedule_observations', 'INSERT');
  -- Supabase otorga por defecto privilegios de secuencia (local: UPDATE; prod: USAGE/SELECT/UPDATE).
  ASSERT NOT has_sequence_privilege('anon', pg_get_serial_sequence('public.match_schedule_observations', 'id'), 'USAGE, SELECT, UPDATE')
     AND NOT has_sequence_privilege('authenticated', pg_get_serial_sequence('public.match_schedule_observations', 'id'), 'USAGE, SELECT, UPDATE'),
    'Observation identity sequence still granted to anon/authenticated';
  ASSERT (SELECT bool_and(relrowsecurity) FROM pg_class
           WHERE oid IN ('public.team_provider_ids'::regclass, 'public.team_name_aliases'::regclass,
                         'public.match_provider_ids'::regclass, 'public.match_schedule_observations'::regclass)), 'RLS disabled';

  RAISE NOTICE 'Match identity: crosswalk keys, Barcelona/Barcelona SC, parallel fixtures, legs, PSG final, league match_day, merged TBD backfill, link refusal, detector, re-key and permissions passed';
END $$;

-- service_role puede escribir la bitácora (identity column sin grants de secuencia).
SET LOCAL ROLE service_role;
INSERT INTO public.match_schedule_observations (provider, provider_match_id, tournament, decision)
VALUES ('api-football', '990000999', 'identity_test', 'would_insert');
RESET ROLE;
ROLLBACK;
