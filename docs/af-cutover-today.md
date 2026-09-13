# Corte de partidos a API-Football — runbook del 2026-09-13

> **Histórico.** El corte se ejecutó el 2026-09-13 a las 13:15 UTC. Después se borró
> el código de ESPN y football-data y el interruptor `data_provider_mode`: las
> secciones de rollback (R1/R2) ya no aplican. Este documento queda como registro
> de lo que se hizo y de cómo se verificó.

Decisión del dueño (13-sep-2026): el calendario, el vivo y la verificación de resultados
salen **solo de API-Football** (plan Pro, 7.000 solicitudes/día, vence el 2026-10-09 y se
renueva). ESPN y football-data dejan de escribir partidos. El interruptor es
`app_config.data_provider_mode` (`legacy` o `af`), leído por `lib/matches/provider-mode.ts`:
sin fila significa `legacy`.

Este documento es el orden exacto del corte. Cada paso dice qué correr, qué esperar y
cuándo parar. No te saltes pasos ni cambies el orden.

Archivos:

- `scripts/af-cutover-dryrun.sql`: solo lectura. Secciones 0–4 antes del corte y
  secciones 5–6 después de importar.
- `scripts/af-cutover-today.sql`: respaldo y borrado de filas legacy sin referencias.
  Es idempotente y sirve también como segunda pasada.
- `scripts/af-import.ts`: importación de la temporada completa desde API-Football.

## Qué toca y qué no toca

Se borra una fila de `matches` solo si cumple **todo** esto:

- está en uno de los 10 torneos de `CREATABLE_TOURNAMENT_SLUGS`;
- su `scheduled_at` es igual o posterior a **«desde»**;
- `final_verified_at IS NULL`, porque un resultado cerrado nunca se borra;
- no tiene identidad API-Football, ni en `external_id` ni en `source_external_ids`;
- tiene cero referencias en `predictions`, `casa_polla_matches`, `casa_picks`,
  `casa_match_issues`, `bracket_proposals`, `match_result_notifications`, `notifications`,
  `whatsapp_conversation_state` y `pollas.match_ids`.

**«desde»** es el mayor entre `2026-07-01` y `now() - 2 días`, calculado en la primera
pasada y guardado en el `COMMENT` de la tabla de respaldo. Las pasadas siguientes usan ese
mismo valor. Coincide con la ventana de `af-import` (kickoff desde hace dos días): lo
anterior no tiene reemplazo en API-Football, así que la historia legacy de julio a
septiembre **se conserva** y no se toca.

Antes de borrar, cada fila se copia a `public.matches_backup_20260913_af_cutover`.
Esa tabla tiene la misma forma que `matches`, PK en `id`, RLS con política deny-all y sin
permisos para `anon` ni `authenticated`. Si aparece una llave foránea hacia `matches` desde
una tabla no revisada, el bloque **aborta sin tocar nada**. Todo corre en un solo `DO`: si
una verificación falla, no queda nada a medias.

Bloqueos durante el bloque (menos de un segundo en producción): las filas candidatas sin
referencias, y `pollas` y `whatsapp_conversation_state` en modo `SHARE`. Los pronósticos,
picks e inscripciones de Casa **no esperan**, porque sus filas y tablas no se bloquean.
Si un chat del bot o una edición de polla está en curso, el bloque espera hasta 15 s y
aborta sin escribir. En ese caso reintenta.

Nunca se modifican `predictions`, usuarios, ni dinero o auditoría de Casa.

## Dry run en producción (2026-09-13 12:53 UTC, solo lectura)

**Guardia de FK (sección 0):** hay 7 tablas con FK hacia `matches` y todas están en la
lista revisada: `predictions` (RESTRICT), `casa_polla_matches` y `casa_picks` (NO ACTION),
`casa_match_issues`, `bracket_proposals` y `match_result_notifications` (CASCADE), y
`notifications` (SET NULL). Ninguna es desconocida. `whatsapp_conversation_state` y
`pollas.match_ids` no tienen FK, pero el script las revisa igual.

**Conjunto a borrar (sección 1), con «desde» = 2026-09-11 12:52 UTC:** 1.774 filas
(23 de los últimos dos días y 1.751 futuras). Se conservan 174 filas legacy sin verificar
anteriores a «desde» (78 con resultado final); API-Football no las reemplaza.

| Torneo | Borrar | Últimos 2 días | Futuro | Referenciadas | Historia conservada (con resultado) |
|---|---:|---:|---:|---:|---:|
| betplay_2026 | 89 | 5 | 84 | 0 | 11 (10) |
| bundesliga_2025 | 286 | 5 | 281 | 0 | 18 (1) |
| champions_2025 | 67 | 0 | 67 | 0 | 18 (18) |
| europa_2026 | 18 | 0 | 18 | 0 | 0 |
| laliga_2025 | 337 | 5 | 332 | 1 | 36 (13) |
| libertadores_2026 | 4 | 0 | 4 | 0 | 4 (4) |
| ligue1_2025 | 277 | 4 | 273 | 1 | 27 (10) |
| premier_2025 | 344 | 2 | 342 | 1 | 30 (11) |
| seriea_2025 | 348 | 2 | 346 | 1 | 30 (11) |
| sudamericana_2026 | 4 | 0 | 4 | 0 | 0 |

«Referenciadas» cuenta solo las filas sin verificar desde «desde». No hay filas
`apifootball:` ni filas ya ligadas a API-Football. Los números cambian con la hora a la
que corras la primera pasada.

**Filas referenciadas desde julio (sección 2):** 14, todas de Casa. Suman las 16 filas de
`casa_polla_matches` y las 5 de `casa_picks`.

| Torneo | Kickoff UTC | Partido | Estado | Verificada | Referencias |
|---|---|---|---|---|---|
| bundesliga | 09-11 18:30 | 1. FC Union Berlin – FC Schalke 04 | finished 1-3 | sí | cpm=1 |
| bundesliga | 09-12 13:30 | TSG 1899 Hoffenheim – VfB Stuttgart | finished 2-1 | sí | cpm=1 |
| laliga | 09-11 19:00 | Sevilla FC – Valencia CF | finished 1-0 | sí | cpm=1 |
| **laliga** | **09-13 16:30** | **Getafe CF – RC Deportivo La Coruña** | scheduled | **no** | cpm=1 |
| **ligue1** | **09-11 18:45** | **Stade Rennais FC 1901 – Olympique de Marseille** | scheduled 0-0 | **no** | cpm=2, picks=1 |
| ligue1 | 09-12 15:15 | RC Strasbourg Alsace – AS Monaco FC | finished 1-1 | sí | cpm=1 |
| premier | 09-12 14:00 | Liverpool FC – Fulham FC | finished 0-0 | sí | cpm=2, picks=1 |
| premier | 09-12 14:00 | Aston Villa FC – Nottingham Forest FC | finished 1-2 | sí | cpm=1 |
| premier | 09-12 14:00 | Crystal Palace FC – Ipswich Town FC | finished 2-3 | sí | cpm=1 |
| premier | 09-12 14:00 | Chelsea FC – Hull City AFC | finished 2-2 | sí | cpm=1, picks=1 |
| premier | 09-12 19:00 | Sunderland AFC – Arsenal FC | finished 0-2 | sí | cpm=1, picks=1 |
| **premier** | **09-13 15:30** | **Manchester United FC – Manchester City FC** | scheduled 0-0 | **no** | cpm=1, picks=1 |
| **seriea** | **09-11 18:45** | **Venezia FC – ACF Fiorentina** | scheduled 0-0 | **no** | cpm=1 |
| seriea | 09-12 13:00 | Genoa CFC – Frosinone Calcio | finished 1-1 | sí | cpm=1 |

Las únicas filas verificadas de los últimos 3,5 días en estos torneos son esas 10 de Casa.

**Duplicados exactos actuales (sección 3):** ninguno.

**Línea base (sección 4):** `predictions` 15.426 · `casa_pollas` 3 ·
`casa_polla_matches` 16 · `casa_picks` 5 · `casa_match_issues` 0 · `casa_entries` 2 ·
`casa_payouts` 0 · `bracket_proposals` 20 · notificaciones con partido 2.134 · `matches`
3.557 (1.338 verificadas) · `data_provider_mode` sin fila (legacy) · respaldo inexistente.

**Secciones 5 y 6 (antes de importar):** la 5 lista las 14 filas de Casa sin candidato
API-Football, y la 6 da `[]`. Es lo esperado mientras no haya filas `apifootball:`.

### Lo que debes saber antes de empezar

1. **Hay dos partidos de Casa hoy:** Manchester United – Manchester City a las 15:30 UTC
   (10:30 en Colombia) y Getafe – Deportivo a las 16:30 UTC (11:30 en Colombia). Termina los
   pasos 1–8 **antes de las 15:00 UTC**. Si no alcanzas, déjalo en `legacy` hasta que ambos
   partidos queden verificados (alrededor de las 18:30 UTC) y haz el corte después.
2. **La importación no liga sola todas las filas de Casa.** El escritor central empareja
   por nombres normalizados exactos, y varios no coinciden: `RC Deportivo La Coruña` frente
   a `Deportivo La Coruna`, `Stade Rennais FC 1901` frente a `Rennes` y `ACF Fiorentina`
   frente a `Fiorentina` (comprobado con `normalize_team_name`). Sin el paso 6, la
   importación crea una fila API-Football gemela, y la polla de Casa queda apuntando a una
   fila que en modo `af` no recibe vivo ni cierre.
3. **El paso 6 necesita el OK explícito del dueño.** No estaba en la secuencia aprobada y
   escribe `source_external_ids` y borra la gemela fuera de `upsert_match_safe`. Tiene
   guardias (abajo), pero es una decisión del dueño. Si no la aprueba, no hagas el corte
   mientras haya filas de Casa sin verificar con nombres que no coinciden.
4. **Rennes – Marseille y Venezia – Fiorentina (11-sep) siguen sin verificar,** con
   `scheduled 0-0`. La importación toma partidos desde hace dos días. Si corre después de
   las **18:45 UTC de hoy**, esos dos quedan fuera de la ventana y no habrá fila API-Football
   para fusionar; habrá que cerrarlos a mano con `finalize_verified_match_result`.
5. Haz el paso 4 **inmediatamente** después del paso 3. Los partidos no referenciados que
   empezaron hace dos días, entre la hora de la primera pasada y la de la importación, se
   borran y no vuelven. Son minutos de calendario si no te demoras.
6. Entre el paso 3 y el paso 7 los syncs legacy siguen vivos y pueden reinsertar filas. La
   segunda pasada (paso 8) las limpia con el mismo «desde». **No crees pollas de Casa hasta
   terminar el paso 9.**

## Preparación: checkout, entorno y runner de SQL

Los scripts del corte existen solo en la rama de API-Football (worktree
`C:/Users/STZTR/Downloads/la-polla-af-calendar`, o la rama ya mergeada). El checkout
principal está en otra rama y **no** los tiene. Las credenciales viven solo en el checkout
principal. Abre Git Bash y define las dos rutas:

```bash
REPO=/c/Users/STZTR/Downloads/la-polla-af-calendar            # checkout con los scripts (o la rama mergeada)
MAIN=/c/Users/STZTR/Desktop/claude-code-environment/apps/la-polla   # donde están .env y .env.local
cd "$REPO"
for f in scripts/af-cutover-today.sql scripts/af-cutover-dryrun.sql scripts/af-import.ts "$MAIN/.env" "$MAIN/.env.local"; do
  test -f "$f" && echo "ok  $f" || echo "FALTA  $f"
done
```

Si alguna línea dice `FALTA`, para: no sigas hasta tener los cinco archivos.

Todo el SQL de escritura va por la Management API con `SUPABASE_ACCESS_TOKEN` de
`$MAIN/.env`. El token nunca se imprime:

```bash
run_sql() {
  node --env-file="$MAIN/.env" -e '
    const sql = require("fs").readFileSync(0, "utf8");
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) { console.error("Falta SUPABASE_ACCESS_TOKEN en .env"); process.exit(2); }
    fetch("https://api.supabase.com/v1/projects/sgmygyrvytzaushiqrst/database/query", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    }).then(async (r) => {
      console.log("HTTP", r.status);
      console.log(await r.text());
      if (!r.ok) process.exit(1);
    }).catch((e) => { console.error(e.message); process.exit(1); });
  '
}
# Una sección del dry run (la API devuelve solo la última sentencia):
dry() { sed -n "/─── $1\./,\$p" scripts/af-cutover-dryrun.sql | sed "1!{/─── [0-9]\./,\$d}" | run_sql; }
```

Si recibes `HTTP 401`, el token venció. Pide uno nuevo; no uses otra vía.

## Pasos

### 1. Desplegar en `legacy`

Despliega a producción la rama con el interruptor. Antes de seguir, confirma:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lapollacolombiana.com/api/app-version   # 200
echo "SELECT key, value FROM public.app_config WHERE key = 'data_provider_mode';" | run_sql  # []
```

Sin fila, la app se comporta igual que antes.

### 2. Dry run y respaldo en disco

```bash
dry 0   # todas las filas deben tener known=true; si una es false, PARA
dry 1   # compara con la tabla de arriba
dry 2   # filas de Casa que se conservan
dry 3   # debe salir []
dry 4   # anota la línea base: predictions y casa_* no deben cambiar
(cd "$MAIN" && npx tsx scripts/export-backup.ts && npx tsx scripts/verify-backup.ts)
```

Para si la sección 0 tiene `known=false`, si `verify-backup` no cuadra o si la sección 1
se aleja mucho de 1.774 sin una razón clara.

### 3. Primera pasada del corte

```bash
run_sql < scripts/af-cutover-today.sql
```

Qué esperar: `HTTP 200` o `201` y un resumen con `desde` (hace dos días),
`filas_en_respaldo` igual a `respaldadas_y_ausentes` (cerca de 1.774),
`historia_sin_verificar_conservada` cerca de 174 y `predictions` en 15.426. En
`legacy_sin_verificar_conservadas` deben aparecer solo las 4 filas de Casa sin verificar,
más lo que los syncs legacy hayan reinsertado desde el dry run.

Si la respuesta es un error `af-cutover abortado: …` o `lock timeout`, no se escribió
nada. Lee el motivo:

- **FK nueva:** revisa esa tabla antes de seguir.
- **Bloqueo (`lock timeout`):** alguien tenía ocupada `pollas` o el estado del bot.
  Reintenta en 2 minutos.
- **COMMENT sin «desde»:** alguien tocó el comentario del respaldo. No lo inventes; avisa.

### 4. Importar la temporada desde API-Football

Hazlo inmediatamente después del paso 3.

```bash
npx tsx scripts/af-import.ts --all --apply --env "$MAIN/.env.local"
```

Revisa el reporte por liga: `fetched`, `inserted`, `updated`, `linked`, `errors`,
`aborted`. Para y repite solo esa liga (`--tournament <slug>`) si alguna sale con `aborted`
distinto de vacío o con `errors > 0`.

### 5. Buscar gemelas sin ligar

```bash
dry 5
```

Salen dos tipos de fila:

- **Pares con `puntaje_nombres` ≥ 1:** una fila legacy (referenciada o verificada) y una
  fila API-Football del mismo torneo a 36 h o menos, donde al menos un lado coincide como
  palabras completas (`rc deportivo la coruna` contiene `deportivo la coruna`; `milan` NO
  coincide con `internazionale milano`). Traen `par_para_fusionar` listo para copiar.
- **Filas referenciadas sin candidato:** ya quedaron ligadas por la importación, o
  API-Football no tiene esa fila (fuera de ventana; revisa el punto 4 de «Lo que debes
  saber»).

Antes de copiar un par, **léelo**: tiene que ser el mismo partido. El último valor de
`par_para_fusionar` es `max_horas`. Vale `3` si los kickoffs difieren 3 h o menos, y
`NULL::integer` si difieren más. En ese caso confirma la reprogramación y escribe las
horas a mano (máximo 36).

### 6. Fusionar los pares aprobados (requiere OK del dueño)

Por cada par, el bloque respalda y borra la fila API-Football **recién importada** (sin
referencias) y agrega su `apifootball:<id>` a `source_external_ids` de la fila legacy. La
fila de Casa conserva su uuid, sus picks y su polla. Desde ahí el escritor central la
encuentra por esa identidad y le pone nombres, escudos y estado de API-Football (en una
fila verificada solo cambian nombres y escudos; marcador y estado quedan protegidos).

Guardias: el bloque **aborta sin escribir nada** si en cualquier par:

- la fila legacy no se llama exactamente como dicen los nombres copiados;
- los kickoffs difieren más de `max_horas`, o `max_horas` está vacío o fuera de 0–36;
- ningún lado coincide (un par de partidos distintos a la misma hora da 0);
- hay otra fila del mismo torneo a 36 h que comparte un equipo con el par (ambigüedad);
- la fila API-Football está verificada o tiene referencias, o la legacy ya tiene
  identidad API-Football, o las dos son de torneos distintos;
- no pegaste ningún par.

Reemplaza la línea `(NULL::uuid, …)` por los `par_para_fusionar` aprobados, separados por
coma:

```bash
run_sql <<'SQL'
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
    (NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer)
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
SQL
```

El `SELECT` final debe listar las filas de Casa, ya con su `apifootball:<id>`. Si el bloque
aborta por ambigüedad, no fuerces: revisa las filas con `dry 5` y pregunta. Después corre
`dry 6`: solo pueden quedar pares que decidiste no fusionar, y ninguno puede ser de Casa.

### 7. Cambiar la fuente a API-Football

```bash
run_sql <<'SQL'
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('data_provider_mode', 'af', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
RETURNING key, value, updated_at;
SQL
```

La app lo lee con una caché de 30 s por instancia. Espera un minuto antes del paso 8.

### 8. Segunda pasada del corte

```bash
run_sql < scripts/af-cutover-today.sql
```

Usa el mismo `desde` de la primera pasada (míralo en el resumen) y borra lo que los syncs
legacy reinsertaron entre los pasos 3 y 7. En `legacy_sin_verificar_conservadas` solo deben
quedar filas de Casa, todas con `"ligada_af": true`. Si alguna sale en `false`, vuelve al
paso 5 para esa fila.

### 9. Verificación

**V1. Duplicados exactos por torneo, equipos normalizados y kickoff a 3 días o menos.**
Debe dar `[]`:

```bash
run_sql <<'SQL'
WITH r AS (
  SELECT id, tournament, scheduled_at, home_team, away_team, external_id,
         public.normalize_team_name(home_team) nh, public.normalize_team_name(away_team) na
    FROM public.matches
   WHERE tournament IN ('premier_2025','laliga_2025','seriea_2025','bundesliga_2025','ligue1_2025',
                        'champions_2025','europa_2026','libertadores_2026','sudamericana_2026','betplay_2026')
     AND scheduled_at >= now() - interval '3 days' AND home_team <> 'TBD')
SELECT a.tournament, a.home_team, a.away_team, a.scheduled_at, a.external_id, b.scheduled_at, b.external_id
  FROM r a JOIN r b ON b.tournament = a.tournament AND b.nh = a.nh AND b.na = a.na AND a.id < b.id
   AND b.scheduled_at BETWEEN a.scheduled_at - interval '3 days' AND a.scheduled_at + interval '3 days';
SQL
```

**V1b. Gemelas con nombres distintos.** V1 no ve `Deportivo` frente a `RC Deportivo`, ni
filas verificadas de Casa con gemela. Esta sección sí. Debe dar `[]`:

```bash
dry 6
```

**V2. Una identidad API-Football por fila.** Debe dar `[]`:

```bash
run_sql <<'SQL'
SELECT af_id, count(DISTINCT id) AS filas, array_agg(DISTINCT id) AS ids
  FROM (SELECT id, external_id AS af_id FROM public.matches WHERE external_id LIKE 'apifootball:%'
        UNION ALL
        SELECT id, s FROM public.matches, unnest(source_external_ids) s WHERE s LIKE 'apifootball:%') t
 GROUP BY af_id HAVING count(DISTINCT id) > 1;
SQL
```

Para V1, V1b y V2 no se permite ninguna fila: un duplicado se resuelve fusionándolo
(paso 6), nunca borrando a ciegas.

**V3. Cobertura frente a API-Football.** Por torneo, las filas API-Football desde hace dos
días deben coincidir con lo que `af-import` reportó como escrito o sin cambios para esa
ventana. `hasta` debe coincidir con la última fecha que API-Football ya publicó para la
temporada. Según los payloads guardados el 13-sep: BetPlay llega al 2026-11-08, Champions
al 2027-01-27 (fase de liga), La Liga al 2027-05-30 y Libertadores al 2026-09-18. Las fases
que todavía no se sortean no tienen partidos. Referencia de tamaño desde hace dos días:
BetPlay 106, La Liga 339, Champions 126 y Libertadores 4.

```bash
run_sql <<'SQL'
SELECT tournament,
       count(*) AS filas_af,
       count(*) FILTER (WHERE NOT scheduled_at_confirmed) AS hora_por_confirmar,
       min(scheduled_at) AS desde, max(scheduled_at) AS hasta,
       count(*) FILTER (WHERE COALESCE(external_id, '') NOT LIKE 'apifootball:%') AS legacy_ligadas
  FROM public.matches
 WHERE scheduled_at >= now() - interval '2 days'
   AND (external_id LIKE 'apifootball:%'
        OR EXISTS (SELECT 1 FROM unnest(source_external_ids) s WHERE s LIKE 'apifootball:%'))
 GROUP BY tournament ORDER BY tournament;
SQL
```

**V4. Sin legacy suelto.** Cualquier fila futura sin identidad API-Football debe tener
referencias. Debe dar `[]`:

```bash
run_sql <<'SQL'
SELECT id, tournament, scheduled_at, home_team, away_team, external_id
  FROM public.matches m
 WHERE tournament IN ('premier_2025','laliga_2025','seriea_2025','bundesliga_2025','ligue1_2025',
                      'champions_2025','europa_2026','libertadores_2026','sudamericana_2026','betplay_2026')
   AND scheduled_at >= now() AND final_verified_at IS NULL
   AND COALESCE(external_id, '') NOT LIKE 'apifootball:%'
   AND NOT EXISTS (SELECT 1 FROM unnest(source_external_ids) s WHERE s LIKE 'apifootball:%');
SQL
```

**V5. Datos sagrados intactos.** Compara con la línea base del paso 2:

```bash
dry 4
```

Deben coincidir `predictions` (15.426), `casa_pollas`, `casa_polla_matches`, `casa_picks`,
`casa_match_issues`, `casa_entries`, `casa_payouts` y `bracket_proposals`, y
`data_provider_mode` debe ser `af`. `notificaciones con partido` puede subir porque la app
sigue viva, pero nunca bajar.

**V6. En la app.** En `/admin/pollas/crear`, abre el calendario de BetPlay y de la Premier.
Deben verse los partidos hasta el final de la temporada, sin gemelos, con «hora por
confirmar» donde API-Football no tiene hora fija. En `/casa`, las 3 pollas existentes deben
mostrar sus partidos con escudo.

Solo después de V1–V6 se pueden crear pollas de Casa nuevas.

## Rollback

### R1. Volver a `legacy`

```bash
run_sql <<'SQL'
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('data_provider_mode', 'legacy', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
RETURNING key, value, updated_at;
SQL
```

ESPN y football-data vuelven a escribir en unos 30 s. Es inmediato, pero **no es gratis**:

- Las filas API-Football se quedan con nombres de API-Football. El escritor legacy solo las
  encuentra si los nombres normalizados son idénticos. Donde no lo son (Deportivo, Rennes,
  Fiorentina y cualquier club con nombre distinto), los syncs legacy **insertan una gemela
  nueva**. Una polla creada en modo `af` sobre esa fila API-Football no recibe vivo ni
  cierre legacy.
- Si quedan dos filas candidatas para el mismo partido, el escritor lanza
  `Ambiguous fixture identity` y ese partido deja de actualizarse hasta resolverlo a mano.
- Las filas de Casa fusionadas conservan su identidad ESPN/football-data en
  `source_external_ids` y `espn_id`, así que el vivo legacy las sigue encontrando.

Después de R1 corre V1 y V1b (`dry 6`) y resuelve lo que salga antes de crear pollas.

### R2. Restaurar las filas borradas

Solo tiene sentido después de R1. Se restaura lo que no choque con una fila existente, ya
sea por uuid o por `external_id`. Las filas API-Football del respaldo, que son las gemelas
fusionadas en el paso 6, **no** se restauran: volverían a duplicar partidos de Casa.

```bash
run_sql <<'SQL'
INSERT INTO public.matches
SELECT b.* FROM public.matches_backup_20260913_af_cutover b
 WHERE COALESCE(b.external_id, '') NOT LIKE 'apifootball:%'
   AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = b.id OR m.external_id = b.external_id)
ON CONFLICT DO NOTHING
RETURNING id, tournament, scheduled_at, home_team, away_team;
SQL
```

Consecuencias:

- Cada fila restaurada queda **al lado** de su fila API-Football, porque tienen
  `external_id` distinto. Es un duplicado visible hasta que se resuelva.
- Mientras convivan, un sync legacy de ese partido puede encontrar dos candidatas y lanzar
  `Ambiguous fixture identity`.

Por eso, después de R2 corre V1 y `dry 6`. Donde una fila restaurada duplique una fila
API-Football, hay que decidir cuál conservar. Si la fila API-Football **no** tiene
referencias, se puede borrar, **pero pregúntale antes al dueño**. Si ya tiene referencias,
por ejemplo una polla creada en modo `af`, se conserva y se borra la restaurada, que no
tiene referencias.

No se borra la tabla de respaldo: sirve de evidencia. Si alguna vez sobra, decide el dueño.
