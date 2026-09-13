-- Limpieza aprobada por el dueño el 2026-09-13 (chat: "sí" a la lista cerrada 1-4).
-- Ejecutada UNA vez en prod por el MCP de Supabase dentro de un solo DO (atómico).
-- Respaldo completo previo: backups/2026-09-13-09-09 (contiene las 18 filas) +
-- tabla matches_backup_20260913_owner_cleanup creada acá mismo.
--
-- 1) 2 filas "TBD Home vs TBD Away" de Libertadores que fusionaban dos semifinales.
-- 2) 13 duplicados football-data de Champions 13-14 oct (se conserva la gemela ESPN,
--    mismos equipos y misma hora, verificado fila por fila).
-- 3) Final UCL PSG–Arsenal: se cierra la fila ESPN que tiene los 2 pronósticos
--    (1-1 a los 90', 0-0 alargue, 4-3 penales PSG — API-Football fixture 1544371)
--    y se borra la gemela football-data 552096 sin referencias. Los puntos los
--    calcula el trigger de scoring; ningún pronóstico se toca a mano. No cambia el
--    ganador de primos-champions-league-20k (líder único 9 pts).
-- 4) Sevilla–Valencia 564669: se jugó 2026-09-11 19:00 UTC, 1-0 (API-Football
--    1570381). Se corrige por el escritor central y se cierra el resultado.
DO $$
DECLARE
  del_ids uuid[] := ARRAY[
    'ef6edaf5-2a24-4e20-9a0f-2c5c50f5fa6a','d59515d1-9955-40ec-9db5-d193a8f2f623',  -- TBD Libertadores
    '3c2aeae7-1a0a-4450-ba9a-8696fc4834c7','9a0e6aff-7024-4d3c-8dc2-ac1718947352',
    '8274a160-f5e1-4fbe-aad7-d61ebbb3266a','332f0666-863a-4fa9-9070-dab2062c0df0',
    '3cc870a3-c824-4e17-a086-035f3af13432','bb793755-7b6a-4578-be23-c086b6d8567c',
    '2639a5dc-edac-475d-b429-492668ab79d6','3f6e8012-612d-4b73-abc2-295465b963b7',
    '72ae893b-5758-4dce-b389-285703b07d13','2ec852c7-d1ae-456b-b3f0-0ec9b956c954',
    'd1ae637d-5c11-4248-8367-caede345e75e','5a399782-723c-48d5-9100-e7df4c90731c',
    '8da248ee-a00c-4e34-8bd4-b6fc92c00ae2',                                          -- 13 dups FD Champions
    '4551ab2d-132c-4282-b8f3-a4386bed80c6'                                           -- FD final 552096
  ]::uuid[];
  psg uuid := '95955b64-fd1f-44d1-bd99-7b1ca68a7cb3';
  sev uuid := '685a58fd-ebec-4d93-aad5-4b791438d313';
  n integer; refs bigint; ok boolean; sev_after uuid;
BEGIN
  CREATE TABLE public.matches_backup_20260913_owner_cleanup AS
    SELECT * FROM public.matches WHERE id = ANY(del_ids || ARRAY[psg, sev]);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 18 THEN RAISE EXCEPTION 'backup esperaba 18 filas, hay %', n; END IF;
  ALTER TABLE public.matches_backup_20260913_owner_cleanup ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.matches_backup_20260913_owner_cleanup FROM PUBLIC, anon, authenticated;
  CREATE POLICY deny_all ON public.matches_backup_20260913_owner_cleanup FOR ALL USING (false) WITH CHECK (false);

  SELECT (SELECT count(*) FROM public.predictions WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.match_result_notifications WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.notifications WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.bracket_proposals WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.casa_polla_matches WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.casa_picks WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.casa_match_issues WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.whatsapp_conversation_state WHERE match_id = ANY(del_ids))
       + (SELECT count(*) FROM public.pollas WHERE match_ids && del_ids)
    INTO refs;
  IF refs <> 0 THEN RAISE EXCEPTION 'las filas a borrar tienen % referencias', refs; END IF;

  DELETE FROM public.matches
   WHERE id = ANY(del_ids)
     AND final_verified_at IS NULL
     AND (home_team = 'TBD Home'
          OR (tournament = 'champions_2025' AND external_id IN
              ('575341','575342','575343','575344','575346','575348','575349','575351',
               '575354','575355','575356','575357','575358','552096')));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 16 THEN RAISE EXCEPTION 'delete esperaba 16 filas, borró %', n; END IF;

  ok := public.finalize_verified_match_result(psg, 1, 1,
    'Cierre manual aprobado por el dueño 2026-09-13: 1-1 a los 90'', 0-0 alargue, 4-3 penales PSG (API-Football 1544371). Gemela FD 552096 eliminada.',
    1, 1, 4, 3, 'home');
  IF NOT ok THEN RAISE EXCEPTION 'no se pudo cerrar la final PSG–Arsenal'; END IF;

  sev_after := public.upsert_match_safe('564669', 'laliga_2025', 5, 'group_stage',
    'Sevilla FC', 'Valencia CF', 'https://crests.football-data.org/559.png', 'https://crests.football-data.org/95.png',
    '2026-09-11 19:00:00+00', NULL, 1, 0, 'finished', NULL, NULL, NULL, true);
  IF sev_after IS DISTINCT FROM sev THEN RAISE EXCEPTION 'Sevilla–Valencia resolvió a otra fila: %', sev_after; END IF;
  PERFORM 1 FROM public.matches WHERE id = sev AND scheduled_at = '2026-09-11 19:00:00+00';
  IF NOT FOUND THEN RAISE EXCEPTION 'el escritor no movió la fecha de Sevilla–Valencia'; END IF;
  ok := public.finalize_verified_match_result(sev, 1, 0,
    'Cierre manual aprobado por el dueño 2026-09-13: jugado 2026-09-11 19:00 UTC, 1-0 (API-Football 1570381).');
  IF NOT ok THEN RAISE EXCEPTION 'no se pudo cerrar Sevilla–Valencia'; END IF;
END $$;
