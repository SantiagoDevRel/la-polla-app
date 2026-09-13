-- Dry run del corte a API-Football (2026-09-13). SOLO LECTURA: cada bloque es un
-- SELECT independiente y ninguno escribe. Se corre antes de scripts/af-cutover-today.sql
-- para saber qué filas de `matches` se van a respaldar y borrar, cuáles se conservan
-- porque tienen referencias y qué duplicados existen hoy.
--
-- El criterio del conjunto a borrar es el MISMO de af-cutover-today.sql; si cambias
-- uno, cambia el otro. Torneos = CREATABLE_TOURNAMENT_SLUGS de lib/tournaments.ts
-- (los 10 de RESULT_LEAGUES en lib/api-football/leagues.ts).
--
-- «desde» = el valor guardado en el COMMENT del respaldo si el corte ya corrió; si no,
-- el mayor entre 2026-07-01 y now() - 2 días (lo que usará la primera pasada).
--
-- Cómo correrlo: pega cada bloque por separado (el MCP y la Management API devuelven
-- solo el resultado de la última sentencia).

-- ─── 0. Guardia de llaves foráneas ──────────────────────────────────────────────
-- Cualquier fila con known=false aborta el corte: hay una tabla nueva que apunta a
-- `matches` y todavía nadie revisó si sus filas se pueden perder.
SELECT c.conrelid::regclass::text AS tabla,
       c.conname,
       pg_get_constraintdef(c.oid) AS definicion,
       c.conrelid::regclass::text = ANY (ARRAY[
         'predictions','casa_polla_matches','casa_picks','casa_match_issues',
         'bracket_proposals','match_result_notifications','notifications']) AS known
  FROM pg_constraint c
 WHERE c.contype = 'f' AND c.confrelid = 'public.matches'::regclass
 ORDER BY known, tabla;

-- ─── 1. Conjunto a borrar por torneo (ventana / historia conservada) ───────────
WITH slugs(s) AS (VALUES ('premier_2025'),('laliga_2025'),('seriea_2025'),('bundesliga_2025'),
  ('ligue1_2025'),('champions_2025'),('europa_2026'),('libertadores_2026'),
  ('sudamericana_2026'),('betplay_2026')),
d AS (
  SELECT GREATEST(timestamptz '2026-07-01 00:00:00+00', COALESCE(
           substring(obj_description(to_regclass('public.matches_backup_20260913_af_cutover'), 'pg_class')
                     FROM 'desde=([0-9T:Z-]+)')::timestamptz,
           date_trunc('minute', now() - interval '2 days'))) AS desde
),
cand AS (
  SELECT m.id, m.tournament, m.scheduled_at, m.status, m.home_score,
         EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)                 AS r_pred,
         EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)          AS r_cpm,
         EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)                  AS r_pick,
         EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)           AS r_issue,
         EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)           AS r_bp,
         EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)  AS r_mrn,
         EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)               AS r_notif,
         EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id) AS r_wa,
         EXISTS (SELECT 1 FROM public.pollas x WHERE m.id = ANY (x.match_ids))               AS r_polla,
         EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%') AS af_linked
    FROM public.matches m
   WHERE m.tournament IN (SELECT s FROM slugs)
     AND m.scheduled_at >= '2026-07-01'
     AND m.final_verified_at IS NULL
     AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
),
c AS (
  SELECT cand.*, d.desde,
         (r_pred OR r_cpm OR r_pick OR r_issue OR r_bp OR r_mrn OR r_notif OR r_wa OR r_polla) AS referenced
    FROM cand CROSS JOIN d
)
SELECT tournament,
       min(desde)                                                                                     AS desde,
       count(*) FILTER (WHERE scheduled_at >= desde AND NOT referenced AND NOT af_linked)             AS borrar_total,
       count(*) FILTER (WHERE scheduled_at >= desde AND scheduled_at < now() AND NOT referenced AND NOT af_linked) AS borrar_ultimos_2_dias,
       count(*) FILTER (WHERE scheduled_at >= now() AND NOT referenced AND NOT af_linked)             AS borrar_futuro,
       count(*) FILTER (WHERE scheduled_at >= desde AND referenced)                                   AS conservar_referenciadas,
       count(*) FILTER (WHERE scheduled_at >= desde AND NOT referenced AND af_linked)                 AS conservar_ligadas_af,
       count(*) FILTER (WHERE scheduled_at < desde)                                                   AS historia_conservada,
       count(*) FILTER (WHERE scheduled_at < desde AND status = 'finished' AND home_score IS NOT NULL) AS historia_con_resultado,
       (SELECT count(*) FROM public.matches a WHERE a.tournament = c.tournament
          AND a.external_id LIKE 'apifootball:%')                                                     AS filas_af_ya
  FROM c
 GROUP BY tournament
 ORDER BY tournament;

-- ─── 2. Filas referenciadas desde 2026-07-01 (sobreviven al corte) ─────────────
-- Incluye verificadas: sirven para ver qué filas legacy quedan vivas y quiénes las usan.
-- Las no verificadas y futuras son las que la importación de API-Football debe ligar
-- (source_external_ids) para que el vivo y el cierre las sigan en modo 'af'.
WITH slugs(s) AS (VALUES ('premier_2025'),('laliga_2025'),('seriea_2025'),('bundesliga_2025'),
  ('ligue1_2025'),('champions_2025'),('europa_2026'),('libertadores_2026'),
  ('sudamericana_2026'),('betplay_2026'))
SELECT m.tournament, m.scheduled_at, m.scheduled_at_confirmed AS hora_confirmada,
       m.home_team, m.away_team, m.status, m.home_score, m.away_score,
       m.final_verified_at IS NOT NULL AS verificada,
       m.external_id, m.source_external_ids,
       concat_ws(', ',
         CASE WHEN p.n > 0 THEN 'predictions=' || p.n END,
         CASE WHEN cpm.n > 0 THEN 'casa_polla_matches=' || cpm.n END,
         CASE WHEN pk.n > 0 THEN 'casa_picks=' || pk.n END,
         CASE WHEN ci.n > 0 THEN 'casa_match_issues=' || ci.n END,
         CASE WHEN bp.n > 0 THEN 'bracket_proposals=' || bp.n END,
         CASE WHEN mrn.n > 0 THEN 'match_result_notifications=' || mrn.n END,
         CASE WHEN nt.n > 0 THEN 'notifications=' || nt.n END,
         CASE WHEN wa.n > 0 THEN 'whatsapp_conversation_state=' || wa.n END,
         CASE WHEN po.n > 0 THEN 'pollas.match_ids=' || po.n END) AS referencias
  FROM public.matches m
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.predictions x WHERE x.match_id = m.id) p
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.casa_polla_matches x WHERE x.match_id = m.id) cpm
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.casa_picks x WHERE x.match_id = m.id) pk
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.casa_match_issues x WHERE x.match_id = m.id) ci
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.bracket_proposals x WHERE x.match_id = m.id) bp
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.match_result_notifications x WHERE x.match_id = m.id) mrn
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.notifications x WHERE x.match_id = m.id) nt
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id) wa
  CROSS JOIN LATERAL (SELECT count(*) n FROM public.pollas x WHERE m.id = ANY (x.match_ids)) po
 WHERE m.tournament IN (SELECT s FROM slugs)
   AND m.scheduled_at >= '2026-07-01'
   AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
   AND (p.n + cpm.n + pk.n + ci.n + bp.n + mrn.n + nt.n + wa.n + po.n) > 0
 ORDER BY m.tournament, m.scheduled_at;

-- ─── 3. Duplicados exactos que existen hoy ─────────────────────────────────────
-- Mismo torneo, mismos equipos normalizados y kickoff a 3 días o menos.
-- sobrevive_* = la fila NO está en el conjunto a borrar (referenciada, verificada, AF
-- o historia anterior a «desde»).
WITH slugs(s) AS (VALUES ('premier_2025'),('laliga_2025'),('seriea_2025'),('bundesliga_2025'),
  ('ligue1_2025'),('champions_2025'),('europa_2026'),('libertadores_2026'),
  ('sudamericana_2026'),('betplay_2026')),
d AS (
  SELECT GREATEST(timestamptz '2026-07-01 00:00:00+00', COALESCE(
           substring(obj_description(to_regclass('public.matches_backup_20260913_af_cutover'), 'pg_class')
                     FROM 'desde=([0-9T:Z-]+)')::timestamptz,
           date_trunc('minute', now() - interval '2 days'))) AS desde
),
rows AS (
  SELECT m.id, m.tournament, m.scheduled_at, m.home_team, m.away_team, m.external_id,
         public.normalize_team_name(m.home_team) AS nh,
         public.normalize_team_name(m.away_team) AS na,
         (m.scheduled_at < d.desde
          OR m.final_verified_at IS NOT NULL
          OR COALESCE(m.external_id, '') LIKE 'apifootball:%'
          OR EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%')
          OR EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id)
          OR EXISTS (SELECT 1 FROM public.pollas x WHERE m.id = ANY (x.match_ids))) AS sobrevive
    FROM public.matches m CROSS JOIN d
   WHERE m.tournament IN (SELECT s FROM slugs)
     AND m.scheduled_at >= '2026-07-01'
     AND m.home_team <> 'TBD'
)
SELECT a.tournament, a.home_team, a.away_team,
       a.scheduled_at AS kickoff_a, a.external_id AS ext_a, a.sobrevive AS sobrevive_a,
       b.scheduled_at AS kickoff_b, b.external_id AS ext_b, b.sobrevive AS sobrevive_b,
       (a.sobrevive AND b.sobrevive) AS queda_duplicado_tras_corte
  FROM rows a
  JOIN rows b ON b.tournament = a.tournament AND b.nh = a.nh AND b.na = a.na AND a.id < b.id
             AND b.scheduled_at BETWEEN a.scheduled_at - interval '3 days' AND a.scheduled_at + interval '3 days'
 ORDER BY a.tournament, a.scheduled_at;

-- ─── 4. Línea base para verificar después del corte ────────────────────────────
-- Anota estos números: predictions y las tablas casa_* NO deben cambiar.
SELECT now() AS medido_en,
       (SELECT count(*) FROM public.predictions)               AS predictions,
       (SELECT count(*) FROM public.casa_pollas)               AS casa_pollas,
       (SELECT count(*) FROM public.casa_polla_matches)        AS casa_polla_matches,
       (SELECT count(*) FROM public.casa_picks)                AS casa_picks,
       (SELECT count(*) FROM public.casa_match_issues)         AS casa_match_issues,
       (SELECT count(*) FROM public.casa_entries)              AS casa_entries,
       (SELECT count(*) FROM public.casa_payouts)              AS casa_payouts,
       (SELECT count(*) FROM public.bracket_proposals)         AS bracket_proposals,
       (SELECT count(*) FROM public.notifications WHERE match_id IS NOT NULL) AS notifications_con_partido,
       (SELECT count(*) FROM public.matches)                   AS matches,
       (SELECT count(*) FROM public.matches WHERE final_verified_at IS NOT NULL) AS matches_verificadas,
       (SELECT value FROM public.app_config WHERE key = 'data_provider_mode') AS data_provider_mode,
       to_regclass('public.matches_backup_20260913_af_cutover') IS NOT NULL AS backup_existe,
       obj_description(to_regclass('public.matches_backup_20260913_af_cutover'), 'pg_class') AS backup_comment;

-- ─── 5. Pares para fusionar (correr DESPUÉS de la importación) ─────────────────
-- Filas legacy sin identidad API-Football que la importación no pudo ligar porque los
-- nombres no normalizan igual ("RC Deportivo La Coruña" vs "Deportivo La Coruna"):
-- todas las referenciadas, y las verificadas que tienen una gemela API-Football. Al
-- lado, los candidatos API-Football del mismo torneo a 36 h o menos.
-- puntaje_nombres cuenta los lados (local, visitante) donde un nombre normalizado
-- contiene al otro como palabras completas (≥ 3 letras): «milan» NO coincide con
-- «internazionale milano». Solo salen pares con puntaje ≥ 1, más una fila sin candidato
-- por cada fila referenciada que no tiene ninguno. El último valor de par_para_fusionar
-- (max_horas) es 3 si el kickoff difiere 3 h o menos, y NULL::integer si difiere más:
-- en ese caso el bloque de fusión aborta hasta que alguien escriba las horas a mano.
WITH slugs(s) AS (VALUES ('premier_2025'),('laliga_2025'),('seriea_2025'),('bundesliga_2025'),
  ('ligue1_2025'),('champions_2025'),('europa_2026'),('libertadores_2026'),
  ('sudamericana_2026'),('betplay_2026')),
d AS (
  SELECT GREATEST(timestamptz '2026-07-01 00:00:00+00', COALESCE(
           substring(obj_description(to_regclass('public.matches_backup_20260913_af_cutover'), 'pg_class')
                     FROM 'desde=([0-9T:Z-]+)')::timestamptz,
           date_trunc('minute', now() - interval '2 days'))) AS desde
),
legacy AS (
  SELECT m.id, m.tournament, m.home_team, m.away_team, m.scheduled_at, m.final_verified_at,
         public.normalize_team_name(m.home_team) AS nh, public.normalize_team_name(m.away_team) AS na,
         (EXISTS (SELECT 1 FROM public.predictions x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.casa_polla_matches x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.casa_picks x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.casa_match_issues x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.bracket_proposals x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.match_result_notifications x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.notifications x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.whatsapp_conversation_state x WHERE x.match_id = m.id)
       OR EXISTS (SELECT 1 FROM public.pollas x WHERE m.id = ANY (x.match_ids))) AS referenced
    FROM public.matches m CROSS JOIN d
   WHERE m.tournament IN (SELECT s FROM slugs)
     AND m.scheduled_at >= d.desde - interval '36 hours'
     AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
     AND NOT EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%')
),
af AS (
  SELECT a.id, a.tournament, a.external_id, a.home_team, a.away_team, a.scheduled_at,
         public.normalize_team_name(a.home_team) AS nh, public.normalize_team_name(a.away_team) AS na
    FROM public.matches a
   WHERE a.external_id LIKE 'apifootball:%'
     AND a.tournament IN (SELECT s FROM slugs)
),
pairs AS (
  SELECT r.*, a.id AS af_id, a.external_id AS af_external_id, a.home_team AS af_local,
         a.away_team AS af_visitante, a.scheduled_at AS af_kickoff,
         round(extract(epoch FROM (a.scheduled_at - r.scheduled_at)) / 60) AS diferencia_min,
         CASE WHEN a.id IS NULL THEN NULL ELSE
           (CASE WHEN length(r.nh) >= 3 AND length(a.nh) >= 3
                  AND (strpos(' ' || r.nh || ' ', ' ' || a.nh || ' ') > 0
                    OR strpos(' ' || a.nh || ' ', ' ' || r.nh || ' ') > 0) THEN 1 ELSE 0 END
          + CASE WHEN length(r.na) >= 3 AND length(a.na) >= 3
                  AND (strpos(' ' || r.na || ' ', ' ' || a.na || ' ') > 0
                    OR strpos(' ' || a.na || ' ', ' ' || r.na || ' ') > 0) THEN 1 ELSE 0 END) END AS puntaje_nombres
    FROM legacy r
    LEFT JOIN af a ON a.tournament = r.tournament
                  AND a.scheduled_at BETWEEN r.scheduled_at - interval '36 hours' AND r.scheduled_at + interval '36 hours'
)
SELECT tournament, id AS legacy_id, home_team AS legacy_local, away_team AS legacy_visitante,
       scheduled_at AS legacy_kickoff, final_verified_at IS NOT NULL AS legacy_verificada, referenced AS legacy_referenciada,
       af_id, af_external_id, af_local, af_visitante, af_kickoff, diferencia_min, puntaje_nombres,
       format('(%L::uuid, %L::uuid, %L, %L, %s)', id, af_id, home_team, away_team,
              CASE WHEN abs(diferencia_min) <= 180 THEN '3' ELSE 'NULL::integer' END) AS par_para_fusionar
  FROM pairs
 WHERE puntaje_nombres >= 1
UNION ALL
-- Filas referenciadas sin ningún candidato con un equipo en común: ya quedaron ligadas
-- por la importación, o no hay fila API-Football para ellas (fuera de ventana).
SELECT r.tournament, r.id, r.home_team, r.away_team, r.scheduled_at, r.final_verified_at IS NOT NULL, r.referenced,
       NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::numeric, NULL::integer, NULL::text
  FROM legacy r
 WHERE r.referenced
   AND NOT EXISTS (SELECT 1 FROM pairs p WHERE p.id = r.id AND p.puntaje_nombres >= 1)
 ORDER BY 1, 5, 14 DESC NULLS LAST, 13;

-- ─── 6. Gate: gemelas sin fusionar (correr DESPUÉS de la importación) ──────────
-- Debe dar []. Cada fila es una fila legacy sin identidad API-Football con una fila
-- API-Football del mismo torneo a 36 h o menos cuyo nombre coincide en al menos un
-- lado (mismo puntaje que la sección 5). A diferencia de la comparación exacta de
-- normalize_team_name, esto sí detecta Deportivo, Rennes y Fiorentina, y cubre también
-- las filas verificadas de Casa. Se resuelve con la fusión del runbook, nunca borrando.
WITH slugs(s) AS (VALUES ('premier_2025'),('laliga_2025'),('seriea_2025'),('bundesliga_2025'),
  ('ligue1_2025'),('champions_2025'),('europa_2026'),('libertadores_2026'),
  ('sudamericana_2026'),('betplay_2026')),
d AS (
  SELECT GREATEST(timestamptz '2026-07-01 00:00:00+00', COALESCE(
           substring(obj_description(to_regclass('public.matches_backup_20260913_af_cutover'), 'pg_class')
                     FROM 'desde=([0-9T:Z-]+)')::timestamptz,
           date_trunc('minute', now() - interval '2 days'))) AS desde
),
legacy AS (
  SELECT m.id, m.tournament, m.home_team, m.away_team, m.scheduled_at, m.final_verified_at,
         public.normalize_team_name(m.home_team) AS nh, public.normalize_team_name(m.away_team) AS na
    FROM public.matches m CROSS JOIN d
   WHERE m.tournament IN (SELECT s FROM slugs)
     AND m.scheduled_at >= d.desde - interval '36 hours'
     AND COALESCE(m.external_id, '') NOT LIKE 'apifootball:%'
     AND NOT EXISTS (SELECT 1 FROM unnest(m.source_external_ids) s WHERE s LIKE 'apifootball:%')
),
af AS (
  SELECT a.id, a.tournament, a.external_id, a.home_team, a.away_team, a.scheduled_at,
         public.normalize_team_name(a.home_team) AS nh, public.normalize_team_name(a.away_team) AS na
    FROM public.matches a
   WHERE a.external_id LIKE 'apifootball:%'
     AND a.tournament IN (SELECT s FROM slugs)
)
SELECT r.tournament, r.id AS legacy_id, r.home_team, r.away_team, r.scheduled_at,
       r.final_verified_at IS NOT NULL AS legacy_verificada,
       a.id AS af_id, a.external_id, a.home_team AS af_local, a.away_team AS af_visitante, a.scheduled_at AS af_kickoff
  FROM legacy r
  JOIN af a ON a.tournament = r.tournament
           AND a.scheduled_at BETWEEN r.scheduled_at - interval '36 hours' AND r.scheduled_at + interval '36 hours'
 WHERE (CASE WHEN length(r.nh) >= 3 AND length(a.nh) >= 3
              AND (strpos(' ' || r.nh || ' ', ' ' || a.nh || ' ') > 0
                OR strpos(' ' || a.nh || ' ', ' ' || r.nh || ' ') > 0) THEN 1 ELSE 0 END
      + CASE WHEN length(r.na) >= 3 AND length(a.na) >= 3
              AND (strpos(' ' || r.na || ' ', ' ' || a.na || ' ') > 0
                OR strpos(' ' || a.na || ' ', ' ' || r.na || ' ') > 0) THEN 1 ELSE 0 END) >= 1
 ORDER BY r.tournament, r.scheduled_at;
