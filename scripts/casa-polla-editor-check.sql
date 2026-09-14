-- LOCAL ONLY. Regresión de la migración 122: editor administrativo de pollas
-- Casa. Todo corre dentro de BEGIN...ROLLBACK: partidos, pollas, inscripciones y
-- pronósticos que se crean acá no sobreviven. Nunca contra producción.
--
-- Uso con 118 y 122 todavía sin aplicar (migraciones y regresión en la misma transacción):
--   ( echo 'BEGIN;'; cat supabase/migrations/118_casa_auto_close_follows_calendar.sql \
--       supabase/migrations/122_casa_polla_editor.sql; \
--     sed '/^BEGIN;$/d;/^ROLLBACK;$/d' scripts/casa-polla-editor-check.sql; echo 'ROLLBACK;' ) \
--     | docker exec -i supabase_db_la-polla psql -U postgres -d postgres -v ON_ERROR_STOP=1
BEGIN;

-- Ejecuta una sentencia y exige que falle con ese mensaje (y detalle, si se da).
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_message text, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_message text; v_detail text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_message IS DISTINCT FROM p_message OR (p_detail IS NOT NULL AND v_detail IS DISTINCT FROM p_detail) THEN
      RAISE EXCEPTION 'Expected % (%) but got % (%) for: %', p_message, p_detail, v_message, v_detail, p_sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected % but the statement succeeded: %', p_message, p_sql;
END $$;

DO $$
DECLARE
  base timestamptz := date_trunc('hour', now()) + interval '3 days';
  v_admin uuid; v_player uuid; v_polla uuid; v_manual uuid; v_entry uuid;
  m0 uuid; m1 uuid; m2 uuid; m_soon uuid; m_live uuid; extra uuid[] := '{}';
  res jsonb; v_slug text; v_picks integer; i integer; fn text;
BEGIN
  -- Permisos: nada de esto se ejecuta desde el cliente.
  FOREACH fn IN ARRAY ARRAY[
    'public.casa_polla_edit_block(public.casa_pollas)',
    'public.casa_polla_editor_v2(uuid,uuid)',
    'public.casa_edit_polla_v2(uuid,jsonb,uuid[],uuid[],uuid,integer)',
    'public.casa_auto_close_after_unlink()'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon executes ' || fn;
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), 'authenticated executes ' || fn;
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role cannot execute ' || fn;
  END LOOP;

  SELECT id INTO v_admin FROM public.users WHERE is_admin LIMIT 1;
  SELECT id INTO v_player FROM public.users WHERE NOT coalesce(is_admin, false) LIMIT 1;
  ASSERT v_admin IS NOT NULL AND v_player IS NOT NULL, 'The local database needs one admin and one player';
  PERFORM set_config('app.casa_contract', '2', true);

  m0 := public.upsert_match_safe('editor-122:0', 'editor_122', 1, 'regular_season',
    'Editor Local 0', 'Editor Visitante 0', null, null, base + interval '1 day', null, null, null, 'scheduled', null, null, null, true);
  m1 := public.upsert_match_safe('editor-122:1', 'editor_122', 1, 'regular_season',
    'Editor Local 1', 'Editor Visitante 1', null, null, base + interval '2 days', null, null, null, 'scheduled', null, null, null, true);
  m2 := public.upsert_match_safe('editor-122:2', 'editor_122', 1, 'regular_season',
    'Editor Local 2', 'Editor Visitante 2', null, null, base + interval '3 days', null, null, null, 'scheduled', null, null, null, true);
  m_soon := public.upsert_match_safe('editor-122:soon', 'editor_122', 1, 'regular_season',
    'Editor Local P', 'Editor Visitante P', null, null, now() + interval '3 minutes', null, null, null, 'scheduled', null, null, null, true);
  m_live := public.upsert_match_safe('editor-122:live', 'editor_122', 1, 'regular_season',
    'Editor Local V', 'Editor Visitante V', null, null, base + interval '4 days', null, 0, 0, 'live', 10, null, null, true);

  res := public.casa_create_polla_v2(jsonb_build_object(
    'kind', 'partidos', 'name', 'Editor 122', 'entryPriceCop', 0, 'houseCutPct', 0,
    'closesAt', to_char(base + interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'closeMode', 'auto',
    'prizeKind', 'pozo', 'potMode', 'proporcional', 'publicationMode', 'oculta',
    'tournament', 'premier_2025', 'scoringMode', '1x2', 'matchIds', jsonb_build_array(m1, m2)
  ), 'editor-122', v_admin, 2);
  v_polla := (res->>'id')::uuid;
  SELECT slug INTO v_slug FROM public.casa_pollas WHERE id = v_polla;
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_polla) = base + interval '2 days' - interval '5 minutes',
    'Creation did not set the automatic close';

  -- Autorización y contrato.
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"name":"Otro nombre"}', v_player), 'ADMIN_REQUIRED');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 1)',
    v_polla, '{"name":"Otro nombre"}', v_admin), 'UPDATE_REQUIRED');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_polla_editor_v2(%L, %L)', v_polla, v_player), 'ADMIN_REQUIRED');

  -- Estado del editor.
  res := public.casa_polla_editor_v2(v_polla, v_admin);
  ASSERT res->>'block' IS NULL, 'A new pool must be editable';
  ASSERT (res->>'entries')::int = 0 AND jsonb_array_length(res->'matches') = 2, 'Editor state counts are wrong';

  -- Nombre y descripción; el slug no cambia.
  res := public.casa_edit_polla_v2(v_polla, '{"name":"  Editor renombrada  ","description":"Fin de semana"}', NULL, NULL, v_admin, 2);
  ASSERT (res->>'changed')::boolean AND res->>'slug' = v_slug, 'Rename did not report the change';
  ASSERT (SELECT name = 'Editor renombrada' AND description = 'Fin de semana' AND slug = v_slug
    FROM public.casa_pollas WHERE id = v_polla), 'Name/description were not saved or the slug moved';
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"name":"ab"}', v_admin), 'INVALID_NAME');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"slug":"otro"}', v_admin), 'INVALID_CONFIG', 'slug');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"scoringMode":"goles"}', v_admin), 'INVALID_CONFIG', 'scoringMode');

  -- Sin inscripciones cambian las condiciones.
  res := public.casa_edit_polla_v2(v_polla, '{"scoringMode":"marcador","entryPriceCop":5000,"houseCutPct":20}', NULL, NULL, v_admin, 2);
  ASSERT (SELECT scoring_mode::text = 'marcador' AND entry_price_cop = 5000 AND house_cut_pct = 20
    FROM public.casa_pollas WHERE id = v_polla), 'Locked fields did not change without entries';
  res := public.casa_edit_polla_v2(v_polla, '{"potMode":"fijo","fixedPrizeCop":100000}', NULL, NULL, v_admin, 2);
  ASSERT (SELECT pot_mode = 'fijo' AND fixed_prize_cop = 100000 FROM public.casa_pollas WHERE id = v_polla), 'Fixed prize not saved';
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"potMode":"fijo","fixedPrizeCop":0}', v_admin), 'INVALID_FIXED_PRIZE');
  res := public.casa_edit_polla_v2(v_polla, '{"potMode":"proporcional","entryPriceCop":0,"houseCutPct":0}', NULL, NULL, v_admin, 2);
  ASSERT (SELECT fixed_prize_cop IS NULL FROM public.casa_pollas WHERE id = v_polla), 'Proportional pot kept a fixed prize';

  -- Agregar partidos: al final, en orden, y el cierre automático los sigue.
  res := public.casa_edit_polla_v2(v_polla, NULL, ARRAY[m0, m0], NULL, v_admin, 2);
  ASSERT (res->>'added')::int = 1 AND (res->>'matches')::int = 3, 'Adding a match (with a duplicate id) failed';
  ASSERT (SELECT order_index FROM public.casa_polla_matches WHERE polla_id = v_polla AND match_id = m0) = 2,
    'A new match must go last';
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_polla) = base + interval '1 day' - interval '5 minutes',
    'Adding an earlier match did not move the automatic close';
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, ARRAY[%L]::uuid[], NULL, %L, 2)',
    v_polla, m_soon, v_admin), 'MATCH_TOO_SOON', m_soon::text);
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, ARRAY[%L]::uuid[], NULL, %L, 2)',
    v_polla, m_live, v_admin), 'MATCH_TOO_SOON', m_live::text);
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, ARRAY[%L]::uuid[], NULL, %L, 2)',
    v_polla, gen_random_uuid(), v_admin), 'INVALID_MATCHES');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, ARRAY[%L]::uuid[], ARRAY[%L]::uuid[], %L, 2)',
    v_polla, m1, m1, v_admin), 'INVALID_MATCHES');

  -- Quitar partidos sin pronósticos: el orden queda contiguo y el cierre vuelve.
  res := public.casa_edit_polla_v2(v_polla, NULL, NULL, ARRAY[m1], v_admin, 2);
  ASSERT (res->>'removed')::int = 1, 'Removing a match without picks failed';
  ASSERT (SELECT array_agg(order_index::int ORDER BY order_index) FROM public.casa_polla_matches WHERE polla_id = v_polla) = ARRAY[0, 1],
    'order_index is not contiguous after a removal';
  ASSERT (SELECT array_agg(match_id ORDER BY order_index) FROM public.casa_polla_matches WHERE polla_id = v_polla) = ARRAY[m2, m0],
    'Removal changed the order of the remaining matches';
  res := public.casa_edit_polla_v2(v_polla, NULL, NULL, ARRAY[m0], v_admin, 2);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_polla) = base + interval '3 days' - interval '5 minutes',
    'Removing the first match did not move the automatic close to the next one';
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, NULL, ARRAY[%L]::uuid[], %L, 2)',
    v_polla, m2, v_admin), 'MATCHES_REQUIRED');

  -- El trigger AFTER DELETE también recalcula una desvinculación directa.
  res := public.casa_edit_polla_v2(v_polla, NULL, ARRAY[m0, m1], NULL, v_admin, 2);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_polla) = base + interval '1 day' - interval '5 minutes', 'Re-adding failed';
  DELETE FROM public.casa_polla_matches WHERE polla_id = v_polla AND match_id = m0;
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_polla) = base + interval '2 days' - interval '5 minutes',
    'AFTER DELETE trigger did not recompute the automatic close';
  UPDATE public.casa_polla_matches SET order_index = 1 WHERE polla_id = v_polla AND match_id = m1;

  -- Tope de 30 partidos.
  FOR i IN 1..29 LOOP
    extra := extra || public.upsert_match_safe('editor-122:x' || i, 'editor_122', 1, 'regular_season',
      'Editor Local X' || i, 'Editor Visitante X' || i, null, null, base + interval '5 days' + i * interval '1 hour',
      null, null, null, 'scheduled', null, null, null, true);
  END LOOP;
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, %L::uuid[], NULL, %L, 2)',
    v_polla, extra, v_admin), 'MATCH_LIMIT');

  -- Publicar desde el editor (entrada 0: no necesita cuenta de cobro).
  res := public.casa_edit_polla_v2(v_polla, '{"publicationMode":"ahora"}', NULL, NULL, v_admin, 2);
  ASSERT (SELECT status::text = 'abierta' AND publication_mode = 'ahora' FROM public.casa_pollas WHERE id = v_polla), 'Publish failed';

  -- Una inscripción y un pronóstico en m2.
  INSERT INTO public.casa_entries (polla_id, user_id, status, amount_cop) VALUES (v_polla, v_player, 'pagada', 0)
    RETURNING id INTO v_entry;
  INSERT INTO public.casa_picks (entry_id, polla_id, user_id, match_id, pick_1x2) VALUES (v_entry, v_polla, v_player, m2, 'L');
  SELECT count(*) INTO v_picks FROM public.casa_picks WHERE polla_id = v_polla;

  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, NULL, NULL, ARRAY[%L]::uuid[], %L, 2)',
    v_polla, m2, v_admin), 'MATCH_HAS_PICKS', m2::text);
  res := public.casa_polla_editor_v2(v_polla, v_admin);
  ASSERT (res->>'entries')::int = 1, 'Editor did not count the entry';
  ASSERT (SELECT (x->>'picks')::int FROM jsonb_array_elements(res->'matches') x WHERE x->>'match_id' = m2::text) = 1,
    'Editor did not count the picks of a match';

  -- Con inscripciones: condiciones bloqueadas; reenviar lo mismo no cuenta.
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"entryPriceCop":1000}', v_admin), 'POLLA_HAS_ENTRIES');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"scoringMode":"1x2"}', v_admin), 'POLLA_HAS_ENTRIES');
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"publicationMode":"oculta"}', v_admin), 'POLLA_HAS_ENTRIES');
  res := public.casa_edit_polla_v2(v_polla, '{"entryPriceCop":0,"scoringMode":"marcador","publicationMode":"ahora","name":"Con gente"}',
    NULL, NULL, v_admin, 2);
  ASSERT (SELECT name FROM public.casa_pollas WHERE id = v_polla) = 'Con gente', 'Name must stay editable with entries';
  -- Agregar y quitar un partido sin pronósticos sigue permitido con inscripciones.
  res := public.casa_edit_polla_v2(v_polla, NULL, ARRAY[m0], ARRAY[m1], v_admin, 2);
  ASSERT (res->>'added')::int = 1 AND (res->>'removed')::int = 1, 'Match edits with entries failed';
  ASSERT (SELECT count(*) FROM public.casa_picks WHERE polla_id = v_polla) = v_picks, 'Editing touched casa_picks';
  ASSERT EXISTS(SELECT 1 FROM public.casa_picks WHERE polla_id = v_polla AND match_id = m2 AND pick_1x2 = 'L'), 'A pick changed';

  -- Operación en pausa.
  UPDATE public.casa_operation_control SET mode = 'paused' WHERE singleton;
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"name":"En pausa"}', v_admin), 'OPERATIONS_PAUSED');
  UPDATE public.casa_operation_control SET mode = 'v2' WHERE singleton;

  -- Después del cierre no se edita nada.
  UPDATE public.casa_pollas SET closes_at = now() - interval '1 minute' WHERE id = v_polla;
  ASSERT public.casa_polla_editor_v2(v_polla, v_admin)->>'block' = 'CLOSED', 'Closed pool must report CLOSED';
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"name":"Tarde"}', v_admin), 'POLLA_NOT_EDITABLE', 'CLOSED');
  UPDATE public.casa_pollas SET closes_at = base + interval '1 day', status = 'cerrada' WHERE id = v_polla;
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"name":"Tarde"}', v_admin), 'POLLA_NOT_EDITABLE', 'CLOSED');
  UPDATE public.casa_pollas SET archived_at = now(), archived_by = v_admin WHERE id = v_polla;
  ASSERT public.casa_polla_editor_v2(v_polla, v_admin)->>'block' = 'ARCHIVED', 'Archived pool must report ARCHIVED';
  PERFORM pg_temp.expect_error(format('SELECT public.casa_edit_polla_v2(%L, %L, NULL, NULL, %L, 2)',
    v_polla, '{"name":"Tarde"}', v_admin), 'POLLA_FINAL');

  -- Cierre manual: agregar un partido no mueve el cierre.
  res := public.casa_create_polla_v2(jsonb_build_object(
    'kind', 'partidos', 'name', 'Editor manual 122', 'entryPriceCop', 0, 'houseCutPct', 0,
    'closesAt', to_char(base + interval '6 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'closeMode', 'manual',
    'prizeKind', 'pozo', 'potMode', 'proporcional', 'publicationMode', 'oculta',
    'tournament', 'premier_2025', 'scoringMode', '1x2', 'matchIds', jsonb_build_array(m1)
  ), 'editor-manual-122', v_admin, 2);
  v_manual := (res->>'id')::uuid;
  res := public.casa_edit_polla_v2(v_manual, NULL, ARRAY[m0], NULL, v_admin, 2);
  ASSERT (SELECT closes_at FROM public.casa_pollas WHERE id = v_manual) = base + interval '6 hours', 'Manual close moved';

  -- Instalar 122 no escribió nada fuera de estas pruebas y tampoco borró pronósticos.
  RAISE NOTICE 'Migration 122: permissions, rename, locked fields, add/remove matches, auto close, pick protection, limits, pause and close lock passed';
END $$;
ROLLBACK;
