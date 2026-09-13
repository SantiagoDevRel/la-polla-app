-- Corte de calendario a API-Football (aprobado por el dueño el 2026-09-13).
-- Runbook completo: docs/af-cutover-today.md. Dry run previo, solo lectura:
-- scripts/af-cutover-dryrun.sql (usa el MISMO criterio; si cambias uno, cambia el otro).
--
-- Qué hace: respalda y borra las filas de `matches` que dejó el calendario legacy
-- (ESPN / football-data) y que nadie usa, para que la importación de API-Football
-- no conviva con gemelas de otro proveedor. Es idempotente: la segunda pasada, después
-- de poner data_provider_mode='af', vuelve a correr este mismo archivo y limpia lo que
-- los syncs legacy alcanzaron a reinsertar mientras tanto.
--
-- Conjunto a borrar (todas las condiciones):
--   · torneo en los 10 de CREATABLE_TOURNAMENT_SLUGS
--   · scheduled_at >= «desde». «desde» = el mayor entre 2026-07-01 y now() - 2 días,
--     calculado en la PRIMERA pasada y guardado en el COMMENT de la tabla de respaldo;
--     las pasadas siguientes reutilizan ese mismo valor. Coincide con la ventana de
--     scripts/af-import.ts (kickoff >= now - 2 días): lo anterior no tiene reemplazo
--     de API-Football, así que la historia legacy de julio a septiembre se conserva.
--   · final_verified_at IS NULL (un resultado cerrado jamás se borra)
--   · external_id NO es 'apifootball:%' y source_external_ids no tiene ningún
--     'apifootball:%' (una fila que el escritor central ya ligó a API-Football es la
--     identidad vigente de ese partido; borrarla solo obligaría a reinsertarla)
--   · cero referencias en predictions, casa_polla_matches, casa_picks,
--     casa_match_issues, bracket_proposals, match_result_notifications, notifications,
--     whatsapp_conversation_state y pollas.match_ids
--
-- Garantías:
--   · Aborta si aparece una llave foránea hacia matches desde una tabla no revisada.
--   · Bloquea solo las filas candidatas SIN referencias (FOR UPDATE: un insert con FK
--     hacia ellas espera y luego falla contra la fila borrada) y las dos tablas que
--     referencian partidos sin FK (pollas.match_ids y whatsapp_conversation_state).
--     No bloquea filas de Casa ni tablas con FK: un pick concurrente no hace deadlock.
--   · Todo va en un solo DO: si cualquier verificación falla, no queda nada a medias.
--   · El respaldo guarda la última versión de cada fila borrada, con RLS deny-all.
--   · No toca predictions, usuarios, dinero ni auditoría de Casa.
DO $$
DECLARE
  c_slugs CONSTANT text[] := ARRAY[
    'premier_2025','laliga_2025','seriea_2025','bundesliga_2025','ligue1_2025',
    'champions_2025','europa_2026','libertadores_2026','sudamericana_2026','betplay_2026'];
  c_known_fk CONSTANT text[] := ARRAY[
    'predictions','casa_polla_matches','casa_picks','casa_match_issues',
    'bracket_proposals','match_result_notifications','notifications'];
  c_floor CONSTANT timestamptz := timestamptz '2026-07-01 00:00:00+00';
  v_unknown text;
  v_desde timestamptz;
  v_locked_ids uuid[];
  v_ids uuid[];
  v_set integer;
  v_cols_matches text[];
  v_cols_backup text[];
  v_set_list text;
  v_written integer;
  v_in_backup integer;
  v_deleted integer;
  v_kept_ref integer;
  v_kept_af integer;
  v_kept_hist integer;
BEGIN
  -- Un bloqueo que no llega en 15 s aborta el bloque en vez de hacer fila detrás de
  -- él a toda la app. Se reintenta en unos minutos.
  PERFORM set_config('lock_timeout', '15s', true);

  -- (1) Guardia de llaves foráneas. Una tabla nueva que apunte a matches puede tener
  -- filas que no se deben perder: hay que revisarla antes de borrar nada.
  SELECT string_agg(c.conrelid::regclass::text || ' (' || c.conname || ')', ', ')
    INTO v_unknown
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.matches'::regclass
     AND c.conrelid <> ALL (ARRAY(
           SELECT to_regclass('public.' || t) FROM unnest(c_known_fk) t
            WHERE to_regclass('public.' || t) IS NOT NULL));
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'af-cutover abortado: tabla no revisada referencia matches: %', v_unknown;
  END IF;

  -- (2) Tabla de respaldo y «desde». Misma forma que matches, PK en id, RLS deny-all y
  -- sin permisos para PUBLIC/anon/authenticated (Supabase los auto-otorga al crearla).
  IF to_regclass('public.matches_backup_20260913_af_cutover') IS NULL THEN
    CREATE TABLE public.matches_backup_20260913_af_cutover (LIKE public.matches);
    v_desde := GREATEST(c_floor, date_trunc('minute', now() - interval '2 days'));
    EXECUTE format('COMMENT ON TABLE public.matches_backup_20260913_af_cutover IS %L',
      'af-cutover desde=' || to_char(v_desde AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      || ' · respaldo de filas legacy borradas y gemelas API-Football fusionadas');
  ELSE
    v_desde := substring(obj_description('public.matches_backup_20260913_af_cutover'::regclass, 'pg_class')
                         FROM 'desde=([0-9T:Z-]+)')::timestamptz;
    IF v_desde IS NULL OR v_desde < c_floor THEN
      RAISE EXCEPTION 'af-cutover abortado: el respaldo existe pero su COMMENT no trae un «desde» válido';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.matches_backup_20260913_af_cutover'::regclass
                    AND contype = 'p') THEN
    ALTER TABLE public.matches_backup_20260913_af_cutover ADD PRIMARY KEY (id);
  END IF;
  ALTER TABLE public.matches_backup_20260913_af_cutover ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.matches_backup_20260913_af_cutover FROM PUBLIC, anon, authenticated;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public'
                    AND tablename = 'matches_backup_20260913_af_cutover'
                    AND policyname = 'deny_all') THEN
    CREATE POLICY deny_all ON public.matches_backup_20260913_af_cutover
      FOR ALL USING (false) WITH CHECK (false);
  END IF;

  -- Si matches ganó o cambió columnas desde la primera pasada, el respaldo perdería
  -- datos en silencio: mejor abortar y agregar la columna al respaldo a mano.
  SELECT array_agg(attname || ':' || format_type(atttypid, atttypmod) ORDER BY attnum)
    INTO v_cols_matches FROM pg_attribute
   WHERE attrelid = 'public.matches'::regclass AND attnum > 0 AND NOT attisdropped;
  SELECT array_agg(attname || ':' || format_type(atttypid, atttypmod) ORDER BY attnum)
    INTO v_cols_backup FROM pg_attribute
   WHERE attrelid = 'public.matches_backup_20260913_af_cutover'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols_matches IS DISTINCT FROM v_cols_backup THEN
    RAISE EXCEPTION 'af-cutover abortado: las columnas de matches y del respaldo difieren';
  END IF;

  -- (3a) Bloquea las filas candidatas que HOY no tienen referencias, en orden de id.
  -- Las filas de Casa/pronósticos no se bloquean: así un pick o un pronóstico
  -- concurrente sobre ellas nunca espera ni choca con este bloque.
  SELECT COALESCE(array_agg(s.id), '{}') INTO v_locked_ids FROM (
    SELECT m.id
      FROM public.matches m
     WHERE m.tournament = ANY (c_slugs)
       AND m.scheduled_at >= v_desde
       AND m.final_verified_at IS NULL
       AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
       AND NOT EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%')
       AND NOT EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)
     ORDER BY m.id
       FOR UPDATE OF m
  ) s;

  -- (3b) Congela las dos fuentes de referencia sin FK hasta el COMMIT. Las tablas con
  -- FK no hace falta bloquearlas: el FOR UPDATE de arriba ya impide referenciar las
  -- filas bloqueadas (el insert pide FOR KEY SHARE sobre la fila y espera).
  LOCK TABLE public.whatsapp_conversation_state, public.pollas IN SHARE MODE;

  -- (3c) Conjunto definitivo, recalculado con todo bloqueado y limitado a las filas
  -- efectivamente bloqueadas (una fila que ganó o perdió referencias entre 3a y 3c
  -- queda fuera o se descarta aquí).
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}') INTO v_ids
    FROM public.matches m
   WHERE m.id = ANY (v_locked_ids)
     AND m.tournament = ANY (c_slugs)
     AND m.scheduled_at >= v_desde
     AND m.final_verified_at IS NULL
     AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
     AND NOT EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%')
     AND NOT EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.pollas x WHERE m.id = ANY (x.match_ids));
  v_set := cardinality(v_ids);

  -- (4) Respaldo. Si una fila ya estaba respaldada (se restauró y se vuelve a borrar),
  -- se refresca con la versión actual: el respaldo guarda lo último que existió.
  SELECT string_agg(format('%I = EXCLUDED.%I', attname, attname), ', ' ORDER BY attnum)
    INTO v_set_list FROM pg_attribute
   WHERE attrelid = 'public.matches'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'id';
  EXECUTE format(
    'INSERT INTO public.matches_backup_20260913_af_cutover AS b
       SELECT m.* FROM public.matches m WHERE m.id = ANY ($1)
     ON CONFLICT (id) DO UPDATE SET %s
       WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(EXCLUDED)', v_set_list)
    USING v_ids;
  GET DIAGNOSTICS v_written = ROW_COUNT;

  SELECT count(*) INTO v_in_backup
    FROM public.matches_backup_20260913_af_cutover b
    JOIN public.matches m ON m.id = b.id
   WHERE b.id = ANY (v_ids) AND to_jsonb(b) = to_jsonb(m);
  IF v_in_backup <> v_set THEN
    RAISE EXCEPTION 'af-cutover abortado: respaldo con % filas idénticas, se esperaban %', v_in_backup, v_set;
  END IF;

  -- (5) Borrado con el criterio repetido (defensa en profundidad).
  DELETE FROM public.matches m
   WHERE m.id = ANY (v_ids)
     AND m.tournament = ANY (c_slugs)
     AND m.scheduled_at >= v_desde
     AND m.final_verified_at IS NULL
     AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
     AND NOT EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%')
     AND NOT EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.pollas x WHERE m.id = ANY (x.match_ids));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_set THEN
    RAISE EXCEPTION 'af-cutover abortado: borró % filas, el respaldo cubre %', v_deleted, v_set;
  END IF;

  -- (6) Lo que se conserva (no se toca): con referencias o identidad API-Football
  -- desde «desde», e historia legacy sin verificar anterior a «desde».
  SELECT count(*) FILTER (WHERE k.scheduled_at >= v_desde AND k.referenced),
         count(*) FILTER (WHERE k.scheduled_at >= v_desde AND NOT k.referenced AND k.af_linked),
         count(*) FILTER (WHERE k.scheduled_at < v_desde)
    INTO v_kept_ref, v_kept_af, v_kept_hist
    FROM (
      SELECT m.scheduled_at,
             EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%') AS af_linked,
             (EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id)
              OR EXISTS (SELECT 1 FROM public.pollas x WHERE m.id = ANY (x.match_ids))) AS referenced
        FROM public.matches m
       WHERE m.tournament = ANY (c_slugs)
         AND m.scheduled_at >= c_floor
         AND m.final_verified_at IS NULL
         AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
    ) k;

  RAISE NOTICE 'af-cutover desde %: bloqueadas %, borradas % (respaldo: % escritas o refrescadas), conservadas con referencias %, ligadas a API-Football %, historia anterior sin verificar %',
    v_desde, cardinality(v_locked_ids), v_deleted, v_written, v_kept_ref, v_kept_af, v_kept_hist;
END $$;

-- Resumen legible (la Management API devuelve solo esta última sentencia).
WITH d AS (
  SELECT substring(obj_description('public.matches_backup_20260913_af_cutover'::regclass, 'pg_class')
                   FROM 'desde=([0-9T:Z-]+)')::timestamptz AS desde
)
SELECT now() AS ejecutado_en,
       d.desde,
       (SELECT count(*) FROM public.matches_backup_20260913_af_cutover) AS filas_en_respaldo,
       (SELECT count(*) FROM public.matches_backup_20260913_af_cutover b
         WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = b.id)) AS respaldadas_y_ausentes,
       (SELECT count(*) FROM public.matches) AS matches_total,
       (SELECT count(*) FROM public.matches WHERE external_id LIKE 'apifootball:%') AS matches_api_football,
       (SELECT count(*) FROM public.predictions) AS predictions,
       (SELECT count(*) FROM public.matches m
         WHERE m.tournament IN ('premier_2025','laliga_2025','seriea_2025','bundesliga_2025','ligue1_2025',
                                'champions_2025','europa_2026','libertadores_2026','sudamericana_2026','betplay_2026')
           AND m.scheduled_at >= timestamptz '2026-07-01 00:00:00+00' AND m.scheduled_at < d.desde
           AND m.final_verified_at IS NULL
           AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%') AS historia_sin_verificar_conservada,
       (SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'torneo', m.tournament, 'kickoff', m.scheduled_at,
                 'local', m.home_team, 'visitante', m.away_team, 'external_id', m.external_id,
                 'ligada_af', EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%'))
               ORDER BY m.scheduled_at)
          FROM public.matches m
         WHERE m.tournament IN ('premier_2025','laliga_2025','seriea_2025','bundesliga_2025','ligue1_2025',
                                'champions_2025','europa_2026','libertadores_2026','sudamericana_2026','betplay_2026')
           AND m.scheduled_at >= d.desde
           AND m.final_verified_at IS NULL
           AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%') AS legacy_sin_verificar_conservadas
  FROM d;

-- ─── Paso aparte (NO se ejecuta con este archivo) ───────────────────────────────
-- Cambiar la fuente de datos. Se corre solo, en el paso que indica el runbook:
--
--   INSERT INTO public.app_config (key, value, updated_at)
--   VALUES ('data_provider_mode', 'af', now())
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
--   RETURNING key, value, updated_at;
--
-- Rollback: el mismo statement con 'legacy'.
