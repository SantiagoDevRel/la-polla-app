# La Polla ⚽🇨🇴

App de pollas de fútbol. La Casa publica las pollas disponibles; los participantes
se inscriben con un comprobante de pago, pronostican y compiten en el ranking.
El modelo histórico de grupos privados permanece disponible.

Producción: **[lapollacolombiana.com](https://lapollacolombiana.com)**

### Horarios y torneos (2026-09-13)

Sudamericana y Europa League (`europa_2026`, liga 3 de API-Football)
están habilitadas para estadísticas, creación de pollas y sincronización.
Sus logos y escudos son archivos locales; Europa incluye 76 clubes de la temporada.

El calendario de Casa se actualiza **antes** de responder al administrador, aunque
ya tenga partidos guardados. `refreshTournamentSchedule` comparte una reserva SQL
de 15 minutos con `/api/matches` y el cron de descubrimiento existente (cada seis
horas). Desde el 2026-09-13 trae la temporada completa de API-Football, la única
fuente (ver «Calendario» abajo). Las ligas se actualizan independientemente de las
pollas P2P antiguas.
Una actualización fallida o en curso no se presenta como exitosa; el cliente recibe
un aviso y usa `private, no-store`.

Migración **103**: `scheduled_at_confirmed` distingue una fecha provisional de un
pitazo confirmado. Los partidos sin hora fija de API-Football (antes `SCHEDULED` de
football-data y `timeValid=false` de ESPN) conservan la fecha sin convertirla al día
anterior y se muestran como «hora por confirmar».
Una hora confirmada sí se convierte a Colombia. El RPC central conserva identidades de proveedor,
promueve fechas provisionales sin crear otro UUID y rechaza identidades ambiguas;
una observación provisional no reemplaza un horario confirmado. Mantiene compatible
la firma anterior del RPC y no recalcula pronósticos, puntos ni resultados.

El incidente Barcelona–Racing / Atlético–Osasuna se debía a fechas antiguas
`2026-09-16T00:00Z` de football-data guardadas como horas reales, que en Colombia se
veían como martes 15. Los horarios verificados son miércoles 16, 14:30 y 12:00 en
Colombia, respectivamente. La migración corrige esos registros con el mismo RPC.
Los proveedores todavía pueden reprogramar o equivocarse: la reserva no equivale
a una garantía en tiempo real ni a que todos los horarios futuros sean definitivos.

Verificación local:

```powershell
Get-Content -Raw scripts/match-schedule-check.sql | docker exec -i supabase_db_la-polla psql -U postgres -d postgres -X -v ON_ERROR_STOP=1
npm test -- tests/match-schedule.test.ts tests/tournament-availability.test.ts tests/football-media.test.ts
```

Info por polla, cuenta personal de pago, revisión de comprobantes, pozo fijo,
publicación programada y fechas en Colombia: [contrato y pruebas de Casa](docs/casa-admin-rules.md)
(migraciones 104–109 y 125; requieren Casa v2). Desde la 125, el pozo fijo crece
solo cuando lo recaudado supera el doble del premio garantizado.

## Fútbol: calendario, partidos y equipos (API-Football Pro)

### Torneos disponibles (2026-09-18)

Veintiuno, todos de **API-Football** y todos con cobertura completa del proveedor
(eventos, estadísticas y alineaciones), verificada contra `/leagues?current=true`:

| Región | Torneos |
|---|---|
| Colombia | Liga BetPlay · Copa Colombia |
| Copas de Europa | Champions · Europa League · Conference League · Nations League |
| Ligas de Europa | Premier · LaLiga · Serie A · Bundesliga · Ligue 1 · Eredivisie · Primeira Liga |
| Sudamérica | Libertadores · Sudamericana · Brasileirão · Copa do Brasil · Liga Argentina · Copa Argentina |
| Norteamérica | Liga MX · MLS |

Para agregar otro: entrada en `RESULT_LEAGUES` (`lib/api-football/leagues.ts`),
en `TOURNAMENTS` y `TOURNAMENT_GROUPS` (`lib/tournaments.ts`), en
`TOURNAMENT_STRUCTURE`, en `TOURNAMENTS_SEO`, un nombre genérico en
`tournament-name-ios.ts`, y correr `scripts/bake-team-crests.mjs`. Los tests
`tournament-availability` y `football-media` fallan si falta alguno de esos pasos.

**Rondas.** `classifyRound` (`lib/api-football/calendar-model.ts`) traduce
`league.round` a una fase del repo con coincidencia EXACTA; una ronda sin mapear
NO se escribe y deja una alerta en `/admin`. Dos nombres son ambiguos entre
torneos y por eso la función recibe también el id de liga: «Play-offs» es fase
real en la Copa Colombia y previa descartada en la UEFA, y un «3» pelado solo es
jornada en la Nations League. `tests/fixtures/api-football/rounds-observed.json`
guarda las 418 etiquetas que el proveedor emitió de verdad en cada torneo, en la
temporada vigente y en la anterior, y el test las clasifica todas.

La pestaña **Fútbol** (`/futbol`) presenta los veintiún torneos con sus logos,
escudos, marcadores y acceso al detalle. El partido muestra goles, jugadas,
estadísticas, titulares y suplentes. Tocar un escudo abre la ficha del club:
plantel por posición, fotos, dorsales, edades, resultados, próximos partidos
e información e imagen del estadio. Desde el plantel se abre la última alineación.
Las estadísticas individuales se consultan dentro de cada alineación.
La ficha del club usa Próximos (inicial), Pasados, Plantel y Club en una barra
horizontal. El partido presenta ambos equipos con nombre y escudo centrados,
enlaces «Ver equipo» y marcador central, tomando como referencia la navegación
de [365Scores](https://www.365scores.com/es). Estadísticas agrupa General,
Ataque, Pases y Defensa; Más conserva métricas desconocidas del proveedor.
Las alineaciones permiten alternar Titulares/Suplentes además del equipo.

La propuesta visual se trabajó en [Lovable](https://lovable.dev/projects/4c4f70a0-dc3c-48d1-93af-6907944caabf)
con referencias de Tribuna Caliente. Conserva Bebas Neue/Outfit, vidrio oscuro,
controles con texto visible y secciones que se abren bajo demanda.

Aplicar las migraciones **092–095** en orden. Con las variables de abajo,
`/status` detecta automáticamente el plan: no hay un flag de Pro en el cliente.
El mes aprobado el 9 de septiembre de 2026 vence el 9 de octubre de 2026;
la autoridad es la fecha que devuelve el proveedor. Al vencer, las reservas
vuelven a los límites gratuitos y el detalle conserva la última información.

- Filtros: **Torneos** (lista) y **Equipos** (búsqueda). Buscar un equipo filtra
  los partidos del día y lista hasta seis clubes del catálogo local
  (`lib/teams/crest-coverage.json`, armado en el servidor, sin consultas a la API)
  con enlace a su ficha. La ficha solo carga equipos con partidos en caché de
  los últimos o próximos siete días.
- Calendario de Fútbol: ±6 días, agrupados por **día de Colombia** (dos feeds UTC).
  Los equipos agregan sus últimos cinco y próximos cinco partidos, filtrados
  a los torneos configurados. No se fija un año de temporada para estas consultas.
  Agregar un torneo NO agrega llamadas acá: el calendario se pide por FECHA
  (`/fixtures?date=`) y `RESULT_LEAGUES` solo decide qué partidos de esa
  respuesta se conservan.
- Pro: límite propio de 7.000 llamadas/día UTC frente a las 7.500 contratadas.
  El detalle y los equipos paran a las 6.000 para reservar capacidad a resultados.
  Un calendario cercano se comparte durante 60 segundos; el detalle activo,
  60 segundos; equipos y partidos finalizados, una hora. Cada ficha de equipo
  reserva cuatro llamadas antes de consultar. No se multiplican por espectador.
- Contador fiel al proveedor (migración 123, 2026-09-14): `/status` se pide sin
  caché de Next (`cache: 'no-store'`) y `record_api_football_account` guarda
  **valor del proveedor + reservas hechas después de esa lectura**, sin el
  `GREATEST` anterior. Un `/status` viejo tras el cambio de día UTC había dejado
  el contador +1.133 sobre el real, y los topes de 6.000/7.000 se activaban antes.
  Lecturas de hace más de 50 s o fuera de orden solo actualizan el plan. La
  reserva atómica antes de cada llamada no cambia. Regresión local:
  `scripts/af-quota-accuracy-check.sql`.
- El vivo excluye filas `finished`/`cancelled`: los partidos terminados de ayer
  ya no mantienen una consulta por minuto al feed de su fecha. Las filas `live`
  siguen hasta que el proveedor las cierre; `flip_stale_live_matches` cubre el resto.
- El cliente actualiza el marcador cada 30 segundos y el calendario cada minuto;
  pausa las consultas con la pestaña oculta. Esto es actualización periódica,
  no streaming. La caché compartida decide si hace falta consultar al proveedor.
- API-Football es la única fuente del vivo (el respaldo ESPN se eliminó el
  2026-09-13). `update_match_live_provider` rechaza lecturas viejas y permite
  correcciones de VAR. Un resultado verificado no se modifica por un tick de vivo.
- Las rutas `/api/football/**` validan sesión antes de leer datos. Las tablas
  `api_football_details` y `api_football_teams` tienen RLS y acceso de servicio.
  Los endpoints y `/futbol/**` usan NetworkOnly; las respuestas son privadas.
- Los logos y fotos de API-Sports son imágenes públicas sin key en el cliente.
  Las alineaciones y el plantel también resuelven la foto por el ID confirmado
  de API-Football cuando falta en las estadísticas; esto no consume consultas
  adicionales a la API. Nunca se mezclan IDs de ESPN/FIFA con los de API-Football.
  Se cargan bajo demanda, con respaldo local para logos y dorsal/icono cuando
  falla una foto. Se evita Image Optimization. La cobertura de fotos, alineaciones
  y estadísticas depende del partido; los datos ausentes no se inventan.

Código: `lib/api-football/{account,feed,details,teams,live}.ts`,
`components/football/`, `app/api/football/`, `app/(app)/futbol/`.
Pruebas del modelo: `npm test -- tests/api-football-detail.test.ts`.

### Cobertura de escudos y logos

El detalle del partido abre **Estadísticas** por defecto. La barra horizontal
ofrece Estadísticas, Alineaciones y Resumen, con navegación por teclado y
etiquetas completas. Resumen contiene todos los eventos en una lista con scroll
interno cuando supera 55 % de la pantalla (máximo 28 rem); los goles llevan un
balón y las tarjetas, cambios y estadísticas tienen íconos acompañados de texto.
Los enlaces de última alineación conservan su apertura directa en Alineaciones.

La navegación presenta **ESTADÍSTICAS** con un balón clásico blanco y negro. El calendario usa un único
selector de fecha con el mes completo («Septiembre 08»), dentro de la ventana
vigente de seis días antes/después; no presenta atajos Ayer/Hoy/Mañana ni meses
numéricos ambiguos. El valor enviado a la API sigue siendo ISO.

La creación es exclusivamente administrativa (`/admin/pollas/crear`). Los
enlaces antiguos a `/pollas/crear` redirigen directamente a `/casa`, sin aviso
de transición ni formulario para jugadores. El POST P2P continúa bloqueado.

El catálogo incluye **705 clubes y selecciones de las temporadas actuales**, los
**385 nombres de equipos observados en 3.778 partidos históricos** y los
veintiún logos de las competiciones. Todos tienen imágenes locales; las selecciones
conservan sus banderas. `crest-coverage.json` registra el inventario completo
para comprobar faltantes; nunca se importa en el cliente.

`TeamCrest` comparte la resolución en Fútbol, Casa, el creador y las vistas
históricas. `crest-overrides.json` corrige identidades revisadas: Club Brugge
tenía una URL histórica de Espanyol; Recoleta usa el escudo actual. La excepción
de Brugge se aplica al nombre del club, para no cambiar el logo de Espanyol.

Los escudos se muestran sin placas blancas. Sportivo Trinidense tiene una
variante transparente de ESPN. Champions, Premier, Bundesliga y Libertadores
usan las variantes `500-dark` de ESPN, descargadas a 192 px desde su CDN.
Serie A usa [el vector de su marca](https://commons.wikimedia.org/wiki/File:Serie_A.svg),
con el rectángulo de fondo eliminado y el texto claro; sus trazados y colores
del símbolo se conservan. Ligue 1 y Sudamericana tienen tratamiento monocromo
claro mediante `getTournamentLogoClassName`. `league-logo-overrides.json` y
`crest-overrides.json` conservan estas decisiones cuando se regenera el catálogo.

Actualizar al incorporar equipos/temporadas:

```bash
node --experimental-strip-types scripts/bake-team-crests.mjs
npm test -- tests/football-media.test.ts
```

El script verifica la temporada vigente con `/leagues`, inventaría `/teams`
para cada torneo (1 + 2 por liga: 43 llamadas con los veintiún actuales), lee los partidos paginados y
genera WebP de hasta 96 px. No escribe en la DB ni elimina assets anteriores.
`--inventory <json> --fixtures <json>` permite repetir un inventario auditado
sin más consultas. Aborta ante imágenes vacías, clubes sin escudo o imágenes
idénticas para IDs de clubes diferentes. Los logos quedan en `league-logos.json`.

Cuando el proveedor sirve la MISMA imagen para dos clubes reales distintos, el
escudo se queda con su dueño verificado y el otro club va **sin escudo**: nunca
con el ajeno. Cada caso se revisa a mano (id, fundación y estadio) y se anota en
`lib/teams/shared-crests.json` indicando cuál lo conserva; un duplicado que no
esté anotado aborta la corrida. Hoy hay uno: API-Football le da al Vasco da Gama
AC de Rio Branco (Acre, 1952) el escudo del CR Vasco da Gama de Río (1898).
Revisar visualmente cualquier proveedor nuevo o cambio de identidad antes de
publicar: una imagen válida puede pertenecer al club equivocado.

Los escudos se sirven desde el mismo origen y entran a la caché al usarlos;
no se descargan cientos de imágenes durante la instalación del service worker.
Los proveedores se conservan como respaldo. Las restricciones preexistentes
de la app nativa iOS en las pantallas históricas permanecen separadas de la web.

## Resultados API-Football

API-Football es la **única** fuente de calendario, vivo y resultados desde el
2026-09-13; ESPN y football-data se eliminaron del código. El cierre automático
cubre BetPlay, Libertadores, Sudamericana, Champions, Europa League, Premier,
Ligue 1, Bundesliga, La Liga y Serie A.
Guarda el marcador de **90 minutos + adición**; el 1X2 se deriva de ese marcador.
Alargue y penales se conservan aparte para los modos de puntaje existentes.

Configuración server-side, después de aplicar las migraciones 092 y 093:

```dotenv
# Obtener la clave en https://dashboard.api-football.com/profile?access
API_FOOTBALL_KEY=<clave privada>
```

`API_FOOTBALL_FINALS_ENABLED` ya no se lee: sin `API_FOOTBALL_KEY` no hay verificación.

El plan gratuito acepta `/fixtures?date=YYYY-MM-DD` para fechas actuales aunque
rechace pedir la temporada completa. La integración consulta hoy/ayer en UTC,
filtra los torneos configurados y comparte una caché de 20 minutos. Solo consulta cuando
un partido vinculado a una polla necesita resultado. Una reserva atómica en la
DB limita esta integración a **80 solicitudes/día UTC**, sin reintentos HTTP;
quedan 20 de las 100 gratuitas para otras consultas. Con dos fechas activas y
uso continuo puede alcanzar el límite (histórico del plan Free; con Pro rigen los
topes de la sección Fútbol). No hay otra fuente: al agotarse la cuota la verificación
espera al siguiente tick o a la resolución manual.

**Cierres atascados (migración 123):** un partido que ya debería tener resultado
(fila `finished`, lectura final del proveedor o saque hace más de 4 h) y no se
confirma suma un intento por **lectura nueva del proveedor** en
`api_football_verify_attempts`; releer la caché dentro del TTL de la reserva
(20 min del feed en Free, 1 h del detalle por id) no cuenta. Desde el
quinto intento su fecha se consulta cada 15 minutos (antes, cada minuto: ~940
consultas/día por fecha) y el admin recibe un aviso `verification_timeout` una
sola vez por partido. Mientras está espaciado sigue usando el feed que otro
proceso refrescó en los últimos 3 minutos, sin gastar cuota. El cierre normal
(dos lecturas) y los minutos de juego o alargue no cuentan intentos.

El cron existente `/api/matches/sync-live` ejecuta la verificación. Se exigen ambos
equipos, torneo y horario para identificar un partido. Una discrepancia bloquea
el cierre; sin corroboración se requieren dos respuestas nuevas del proveedor
(releer la caché no cuenta). La verificación y la resolución administrativa
pasan por `finalize_verified_match_result` → `finalize_match_result` (093),
sin escribir pronósticos directamente ni importar partidos duplicados.
El resultado verificado es inmutable para los syncs: el candado de fila serializa
actualizaciones en vivo y cierres. La importación se serializa por identidad
normalizada para evitar duplicados entre proveedores concurrentes. La DB no cuenta
como una segunda fuente de su propio proveedor.

Filas vinculadas (`apifootball:<id>` en `external_id` o `source_external_ids`) se
emparejan por id de fixture + competición + saque ±2 h; las demás, por nombres. Los
puntos usan `score.fulltime` (90'); `goals` es el marcador de 120' y `score.penalty`
la tanda. Un snapshot `regulation_*` distinto veta el cierre.

`/admin/discrepancias` acepta `{source:"api-football"}` (confirma la última lectura
en caché, sin gastar cuota) o `{source:"manual",home,away}`; `espn` y `fd` responden 400.

**Calendario (desde 2026-09-13, solo API-Football):** el creador ofrece
«Próximos 10 días», «30 días» y «Toda la temporada», agrupados por fecha en hora de
Colombia. La temporada completa de cada liga se importa desde API-Football
(`lib/api-football/calendar.ts`, 1 solicitud por liga) y el cron la refresca por
diferencias. **Actualizar calendario** fuerza ese refresco. Los partidos sin hora
fija muestran «hora por confirmar». Un partido aplazado (PST) cuyo saque sigue en
el futuro se muestra con la hora que trae API-Football y se puede elegir; uno con
fecha vieja no entra hasta que el proveedor publique la nueva.

Desde la migración **118** los partidos provisionales se pueden meter en pollas con
cierre automático: el cierre usa su hora provisional (la misma del candado de
pronósticos) y se recalcula solo cada vez que el calendario confirma o reprograma
un partido de la polla, o cuando se vincula un partido. Nunca reabre una polla cuyo
cierre ya pasó. Regresión: `scripts/casa-auto-close-check.sql` (encadenada con la
migración en una transacción que termina en ROLLBACK; ver el encabezado del script).
Corte: `docs/af-cutover-today.md`. La fila `app_config.data_provider_mode` quedó en la
DB pero ningún código la lee: no hay vuelta a ESPN/football-data.

**Escudos:** TeamCrest usa el catálogo estático WebP. Una URL histórica de ESPN
es identidad, nunca imagen; el proxy `/api/teams/crest` se eliminó el 2026-09-13.
No usa keys, DB ni Image Optimization de Vercel.
Para actualizar el catálogo: `node --experimental-strip-types scripts/bake-team-crests.mjs`.

Regresión de concurrencia: aplicar 093 en el PostgreSQL local de Supabase y ejecutar
`node scripts/test-result-concurrency.mjs`. Crea y retira solo sus fixtures sintéticos;
no ejecutarlo contra producción.

Diagnóstico (solo lectura, acceso de servicio):

```sql
SELECT request_day, requests_used, last_attempt_at FROM api_football_budget;
SELECT fixture_date, fetched_at, jsonb_array_length(fixtures) AS fixtures
FROM api_football_cache ORDER BY fixture_date DESC;
```

Pruebas: `npm test -- lib/api-football/results.test.ts tests/api-football-cache.test.ts tests/api-football-verification.test.ts`.

## Directorio de administración

En `/admin`, **Buscar un usuario** abre una lista con nombres y teléfonos.
Puedes buscar por cualquiera de los dos; al bajar se cargan más usuarios en
grupos de 50. El botón **Hacer admin** conserva la asignación de acceso global.
`GET /api/admin/promote?directory=1&page=0` sirve este directorio únicamente
a administradores autenticados, con respuestas privadas sin caché. La búsqueda
viaja codificada con `encodeURIComponent` en el header `X-User-Search` para no
incluir teléfonos en URLs. El panel
`/admin/*` y las API también usan `NetworkOnly` en el service worker.

## Crear y administrar pollas

**Pronosticar y compartir (2026-09-14).** 1X2 compacto (escudo + nombre como botón, «Empate» al centro), auto-jump en marcador exacto, badge rojo en POLLAS con pollas por pronosticar, texto para compartir con premio cuando es fijo u objeto, botón para copiar la cuenta de pago y vista previa de enlaces con los pollitos (`app/og-la-polla-colombiana.jpg`, regenerable con `node scripts/bake-og-image.cjs app/og-la-polla-colombiana.jpg`).

- `/admin/pollas/crear`: formulario independiente para crear una polla.
  Puedes combinar hasta 30 partidos de distintas ligas; cambiar el torneo
  visible conserva la selección. Cada liga muestra su cantidad de elegidos y
  el resumen permite quitar partidos. El cierre automático usa el primer
  partido de toda la selección, sin importar qué liga estás mirando.
  Los partidos se agrupan en semanas plegables de lunes a domingo («Esta semana»,
  «Próxima semana», «Semana del…»), cerradas al entrar, y **Buscar equipo** filtra
  la lista cargada y abre las semanas con resultados. Cada fila muestra la jornada.
  El modo de puntaje se elige con «Acierta ganador del partido» o «Acierta marcador
  exacto», el mismo texto que ven los jugadores.
- `/admin/pollas`: una card desplegable por polla, con su cantidad de pagos
  pendientes. Al abrirla puedes ver cada comprobante y aprobar o rechazar el
  pago. Los conteos se actualizan cada 30 segundos mientras el panel está visible;
  la cola se carga por polla en páginas de 25.
- `GET /api/casa/admin/entries?summary=1`: conteos completos, solo administradores.
  `?pollaId=<uuid>`: comprobantes de esa polla, con respuestas privadas
  sin caché y URLs firmadas para las imágenes. La siguiente página usa
  `&cursor=<nextCursor>`; así revisar pagos desde otra sesión no salta filas.
- Compartir incluye el nombre, el valor de entrada y el enlace público directo.
- **Eliminar polla** aparece al final del detalle y en cada card administrativa.
  Exige rol de administrador y un clic de confirmación, sin escribir el nombre. Archiva con `archived_at`
  y `archived_by`: conserva pagos, pronósticos, estado y premios; no hace
  devoluciones ni transferencias. El enlace archivado responde 404.

Aplicar `supabase/migrations/091_casa_archive_and_lifecycle_guards.sql` antes
de desplegar. El bloqueo de la fila de la polla serializa revisiones de pagos,
archivo y reparto, también para Telegram. No permite repartir con comprobantes
pendientes ni cambiar inscripciones después del reparto o del archivo.

### Issues sin datos del proveedor y correo (2026-09-14, migración 121)

- **Detección.** Si un partido de una polla Casa activa sigue `scheduled` 30 minutos
  después de su inicio confirmado (30 horas si la hora es provisional), se abre un
  caso «Sin datos del proveedor» en `/admin/issues`. Se cierra solo cuando llegan
  datos, se verifica el resultado o el inicio pasa al futuro; un inicio nuevo que
  vuelve a vencer sin datos abre otro caso.
- **Resolución.** En la tarjeta: «Poner resultado de los 90 minutos» (POST
  `/api/casa/admin/match-issues/[id]/resultado`, admin validado antes de la base,
  RPC `casa_resolve_sin_datos_with_result`), «Anular» o «Mantener y esperar los
  datos». Mientras esté abierto, `casa_settle_polla_v2` responde `OPEN_MATCH_ISSUES`.
- **Correo.** `/api/matches/sync-live` (pg_cron cada minuto) barre los casos y envía
  un correo por cada caso nuevo de cualquier tipo, con reserva atómica, reintentos
  con backoff y máximo 8 intentos. Variables en Vercel: `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL` y `CASA_ISSUES_NOTIFY_EMAIL` (cae a `ADMIN_ALERT_EMAIL` o
  `FEEDBACK_NOTIFY_EMAIL`).
- **Pruebas.** `scripts/casa-issues-sin-datos-check.sql` (Docker local, con ROLLBACK)
  y `npx vitest run tests/casa-issue-notifications.test.ts`.

### Resolver y repartir sin el bot (2026-09-12)

- **Polla manual:** al abrir su card en `/admin/pollas` aparecen sus preguntas.
  Cada una se resuelve eligiendo la opción correcta o escribiendo la respuesta
  libre; al guardar se repuntúa la polla completa y se indica cuántas faltan.
- **Rifa:** la misma card pide el número que salió y dice en el momento si esa
  boleta se vendió o no, antes de repartir.
- Los comandos `/resolver`, `/respuesta` y `/numero` del bot siguen vigentes y
  escriben exactamente lo mismo, con los mismos guardas: una pregunta ya
  resuelta no se sobrescribe (`resolved_at IS NULL`) y el número respeta el
  rango de boletas. Ninguna de las dos vías toca una polla repartida,
  anulada o eliminada.

### Editar una polla hasta el cierre (2026-09-14, migración 122)

- Los administradores ven una tuerca en el detalle de la polla y en sus
  tarjetas de `/casa` (y «Editar» en `/admin/pollas`) mientras la polla no
  haya cerrado. Lleva a `/admin/pollas/[id]/editar`.
- Se puede cambiar el nombre y la descripción (el enlace no cambia), agregar
  partidos que no han empezado (máximo 30) y quitar partidos sin pronósticos.
- Sin inscripciones también se cambia el modo de puntaje, la entrada, el premio
  y la cuenta de cobro. Con una inscripción esas condiciones quedan fijas.
- Todo lo valida `casa_edit_polla_v2` en SQL; los pronósticos nunca se tocan.
- Antes de desplegar: aplicar `supabase/migrations/122_casa_polla_editor.sql`
  (requiere 118). Regresión local con `scripts/casa-polla-editor-check.sql`.

### Cortesías: cupos gratis que reparte una persona (2026-09-17, migración 138)

Solo el administrador las crea. Desde `/admin/cortesias` busca a una persona,
elige una polla y le da de 1 a 20 cortesías. Cada una es un **enlace único**
(`/casa/<slug>?cortesia=CODIGO`) que esa persona le pasa a alguien y que sirve
**una sola vez**.

- **Solo para cuentas nuevas.** Redime quien creó su cuenta *después* de que se
  creó la cortesía y nunca ha tenido una inscripción en La Polla. Ni el
  administrador ni quien la reparte pueden usarla.
- **Una por persona en la vida.** Un índice único sobre `redeemed_by` lo
  garantiza: si alguien ya redimió una, no le sirve otra cortesía, tampoco en
  otra polla.
- **Solo en esa polla**, y **vence con ella**: si nadie la usa antes del cierre
  de inscripciones no se traslada a ninguna otra (no hay cron; lo verifica el
  canje). El administrador puede retirar una sin usar y, desde la migración 139,
  también **quitar un cupo ya usado**: la inscripción gratis queda `anulada`, la
  cortesía pasa a `retirada` y conserva a quién se la dio, así que esa cuenta
  tampoco puede ir a buscar otra. Con la polla repartida ya no se puede
  (`ALREADY_SETTLED`), y el panel ni siquiera ofrece el botón.
- **El cupo vale $0.** Compite en la tabla y cuenta en «inscritos», pero no
  entra al pozo ni a la parte de la casa (`casa_pot_summaries_v2` suma
  `amount_cop`). Quien entró con cortesía puede comprar los cupos que quiera.
- No aplica a rifas (se juegan con boletas numeradas) ni a pollas sin entrada.

Dónde se ve: `/admin/cortesias` (dar, listar y retirar), la polla y el Perfil de
quien las reparte («Cortesías para regalar», con Regalar/Copiar por enlace), y
la propia polla para quien llega por el enlace (tarjeta «Activar mi cupo
gratis»; sin sesión, «te regaló un cupo gratis» + crear cuenta). El código viaja
en la cookie httpOnly `lp_cortesia` que pone `proxy.ts`, así sobrevive al login
y al onboarding; la URL queda limpia para que nadie reparta el cupo ajeno.

La autoridad es SQL (`casa_grant_courtesies_v1`, `casa_redeem_courtesy_v1`,
`casa_revoke_courtesy_v1`), con contrato v2, la polla bloqueada y `service_role`
como único rol con EXECUTE. Antes de desplegar: aplicar
`supabase/migrations/138_casa_courtesies.sql` y `139_casa_courtesy_withdraw.sql`.
La 137 parchea **in place** la rama de `casa_entries` de `casa_v2_write_guard`
(como la 105 y la 133, sobre la definición vigente): sin esa puerta, anular un
cupo de cortesía choca con `ALREADY_PAID`, porque un cupo gratis no tiene
comprobante que corregir. La puerta solo se abre con el testigo que pone
`casa_revoke_courtesy_v1` en su misma transacción. Regresión local (once casos
con `ASSERT`, arma y borra sus propios datos):

```bash
docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-courtesies-check.sql
```

### Reparto del pozo: solo el ganador (migración 096)

`supabase/migrations/096_casa_pozo_solo_ganador.sql` deja el reparto en una
sola regla. **Aplicada en producción el 2026-09-12** (verificada comparando
`md5(prosrc)` de la función en prod contra la del entorno local creada desde
este mismo archivo: idénticas). Es `CREATE OR REPLACE`, así que re-aplicarla no
rompe nada. La regla:

- El pozo (`casa_polla_pot.prize_cop`) va COMPLETO al puntaje más alto. Nunca
  hay segundo ni tercer puesto: `casa_payouts.place` siempre es 1.
- Si varios empatan arriba, se divide en partes iguales entre ellos. Los pesos
  sueltos del redondeo también van a los ganadores, en orden estable por
  `user_id`, así que la suma de `casa_payouts` es exactamente el pozo.
- Sin ganador no se reparte y no se escribe ningún pago: si nadie sumó puntos,
  o si la boleta sorteada no la compró nadie, el reparto falla con un mensaje
  que explica qué pasó. Qué hacer con esa plata lo decide la casa, no el código.

Regresión: `scripts/casa-settle-check.sql` arma pollas de prueba en un Supabase
LOCAL y verifica los cinco casos con `ASSERT` — ganador único (quien no pagó no
entra), empate con sobrante de redondeo, nadie con puntos, rifa cuya boleta no
se vendió y doble reparto. Se corre así, y no toca datos reales:

```bash
docker exec -i supabase_db_la-polla psql -U postgres -d postgres < scripts/casa-settle-check.sql
```

## Partidos, tabla e imágenes

`/casa` muestra **Pollas disponibles** y **Pollas cerradas**, estas últimas
comprimidas inicialmente. Cada polla muestra todos sus torneos, resueltos desde
los partidos asociados, solo con sus logos. Cada tarjeta de pollas abiertas o
cerradas indica qué hay que acertar: «Acierta ganador del partido» (1X2) o
«Acierta marcador exacto». El detalle arranca con un hero compacto (logos,
nombre, estado, modo de puntaje, pozo y entrada, Entrar + Compartir) para que las
pestañas **Partidos / Tabla / Info** se vean sin bajar; cambiar de pestaña
conserva los pronósticos sin guardar. Info agrupa las reglas en desplegables
cerrados con viñetas cortas; con premio fijo explica desde cuántas inscripciones
crece el pozo y cuánto suma cada persona adicional (cifras calculadas en SQL). La tabla muestra posiciones,
nombres, avatares y puntos sin el antiguo límite visual de 20 jugadores.

La tabla se actualiza cada 30 segundos mientras está visible mediante
`GET /api/casa/pollas/[slug]/leaderboard` (autenticación y `private, no-store`).
Los pagos en revisión pueden pronosticar dentro del plazo. El RPC SQL de tabla
incluye únicamente pagos aprobados, con los puntos de sus pronósticos válidos.
La cuenta para recibir premios se configura opcionalmente en `/perfil`; la
transferencia al ganador sigue siendo manual.

Los torneos usan variantes locales de 96 px. Los escudos usan
`components/match/TeamCrest.tsx`, un catálogo local con procedencia en
`public/team-crests/README.md` y respaldo del proveedor. Para actualizar las
copias sin añadir servicios ni dependencias:
`node --experimental-strip-types scripts/bake-team-crests.mjs`.
La navegación conserva los íconos y añade **Pollas / Perfil**. La Polla usa
español incluso con una antigua cookie de inglés; `chickenpicks.app` conserva
su idioma por dominio y sus páginas SEO.

Los datos históricos están respaldados; consulta
[docs/backup-restore.md](docs/backup-restore.md).

## Filosofía: free-tier punta a punta

La Polla es **gratis para todos** y se mantiene sobre planes gratuitos
de cada proveedor. Esto es una restricción dura, no una preferencia:

> **Actualización 2026-09-13:** el dueño aprobó y paga **Vercel Pro** (team
> `santiago-prod`), **Supabase Pro con compute Small** y **API-Football Pro**
> para producción. Esos planes no se discuten; lo demás de esta sección sigue
> vigente (nada de servicios, upgrades ni add-ons nuevos sin aprobación).

- **Vercel** plan Pro — los partidos se siguen sincronizando con pg_cron de
  Supabase (`/api/matches/discover` cada 6 h, `/api/matches/sync-live` cada
  minuto) y los crons `/api/cron/*` corren desde GitHub Actions.
- **Supabase** plan Pro, compute Small (org Pro compartida con otros
  proyectos). Schema y queries siguen diseñadas para gastar poco.
- **API-Football** plan Pro aprobado por el dueño — cuota reservada en SQL
  antes de cada consulta (ver sección Fútbol).
- **Twilio Verify** — pay-as-you-go con presupuesto controlado por
  `TWILIO_MONTHLY_BUDGET_USD`.
- **Meta WhatsApp Cloud API**, **Resend** — free tiers.

Antes de agregar un servicio, verificá que tenga free-tier viable. Si
una limitación bloquea un feature, listá el tradeoff y dejá que el
usuario decida — no asumas que pagar está OK. Mismo principio en
`CLAUDE.md` para sesiones con Claude.

## Stack

- **Next.js 16** App Router + TypeScript
- **Supabase** (PostgreSQL + Auth + RLS) — phone+password con OTP de WhatsApp solo en el primer login
- **Meta WhatsApp Cloud API** — bot conversacional para predecir/ver tabla, OTP de signup, recovery de clave
- **API-Football** — única fuente de calendario, vivo y resultados (desde 2026-09-13)
- **Cloudflare Turnstile** — captcha del envío de SMS en `/login`; la valida Supabase Auth
- **Tailwind CSS** + **Framer Motion** + **lucide-react**
- **@serwist/next** — PWA instalable + service worker
- **Vitest** — unit tests (111 cubriendo helpers críticos)
- **Vercel** — deploy target con auto-deploy desde `main`

## Primeros pasos

### 1. Clonar e instalar

Requiere Node.js 22.12 o superior (Capacitor 8 y Vite 8).

```bash
git clone https://github.com/SantiagoDevRel/la-polla-app
cd la-polla-app
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Llenar en `.env.local`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# sb_secret_..., solo servidor: IP real en los límites de Supabase Auth
SUPABASE_SECRET_KEY=

# Meta WhatsApp Cloud API
META_WA_ACCESS_TOKEN=
META_WA_PHONE_NUMBER_ID=
META_WA_WEBHOOK_VERIFY_TOKEN=
META_WA_APP_SECRET=

# Cloudflare Turnstile (test keys para dev: 1x00000000000000000000AA / 1x0000000000000000000000000000000AA)
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=
CLOUDFLARE_TURNSTILE_SECRET_KEY=

# API-Football (server-only)
API_FOOTBALL_KEY=

# Cron / admin (server-only)
CRON_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
# WhatsApp: apagado. El número anterior del bot ahora es de otra app.
# Solo con un número propio: WHATSAPP_OUTBOUND_ENABLED=true y
# NEXT_PUBLIC_WHATSAPP_BOT_NUMBER=<E.164 sin +>.
WHATSAPP_OUTBOUND_ENABLED=
NEXT_PUBLIC_WHATSAPP_BOT_NUMBER=

# Login alternativo por Telegram (bot PÚBLICO, distinto del bot admin).
# Las tres o ninguna: con alguna vacía el canal queda apagado.
TELEGRAM_LOGIN_BOT_TOKEN=
TELEGRAM_LOGIN_WEBHOOK_SECRET=            # 32-256 caracteres [A-Za-z0-9_-]
NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME=  # sin @
# Opcional. Vacío = cuentas que ya existían (SMS) solo entran por SMS.
# true = el dueño acepta el riesgo del número reciclado (ver «Login por Telegram»).
TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=
```

### 3. Supabase migrations

Aplicar todo `supabase/migrations/*.sql` en orden. Si usas Supabase CLI: `supabase db push`. Si trabajas vía dashboard, copiá y pegá cada archivo en el SQL Editor.

### 4. Correr en local

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### Validación pre-commit (manual)

```bash
npm run validate    # tsc --noEmit && eslint .
npm test            # vitest unit tests (111 tests)
```

---

## Cómo funciona

### Auth

- **Login por SMS (principal)**: número → `/api/auth/start-otp` (Supabase `signInWithOtp`, hoy Twilio Verify) → código → `/api/auth/verify-otp` deja la sesión en cookies `sb-<ref>-auth-token` (`Secure` en producción, `SameSite=Lax`, host-only; sin `HttpOnly` porque el cliente del navegador lee la sesión; ver «Cookies de sesión»). Sin contraseña. Usuarios nuevos pasan por `/onboarding` (nombre + pollito).
- **SMS por LabsMobile (preparado, apagado)**: `app/api/auth/sms-hook` es el Send SMS Hook de Supabase Auth. Supabase genera y valida el código; el hook solo lo entrega con `lib/sms/labsmobile.ts` (SMS plano, nunca el endpoint 2FA del proveedor) y lo registra en `sms_entregas` (migración 088). LabsMobile avisa la entrega en `/api/sms/ack`, protegido con `SMS_ACK_SECRET`. Mientras `hook_send_sms_enabled=false`, Supabase sigue enviando por Twilio Verify.
- **Orden en `/login`**: primero **Enviar código por SMS** (botón primario); debajo, **Entrar con Telegram** (secundario, no necesita el número). En el paso del código SMS: «¿No te llegó el SMS?» + **Entrar con Telegram**.
- **Login por Telegram (v2, 2026-09-13, migración 119)**: sin códigos. Ver la sección siguiente.

#### Login por Telegram (v2)

Bot **público y separado** del panel de admin. v1 (código de 6 dígitos que la persona copiaba en la web) se retiró por feedback del dueño: no se entendía y el botón «Compartir mi número» quedaba escondido en Telegram Web. El dueño pidió un enlace de un solo uso que dure 5 minutos y abra una sola sesión.

**Regla de seguridad central: la sesión SOLO sale del enlace que el bot manda al Telegram de la cuenta, y se abre en el navegador que abre ese enlace.** La pestaña que pidió el ingreso nunca entra por la aprobación. Si entrara, cualquiera podría crear la solicitud desde su servidor, hacerle llegar el deep link a otra persona y quedarse con su cuenta cuando ella toca Iniciar (phishing tipo device code). La primera versión de este PR lo permitía y la revisión lo reprodujo en la base local.

**Flujo desde el navegador**

1. `/login` → **Entrar con Telegram**. `POST /api/auth/telegram/request` (JSON, mismo origen con prueba positiva) crea la solicitud (`telegram_login_request_create`), fija la cookie **`lp_tg_req`** (secreto aleatorio; `HttpOnly`, `Secure` en producción, `SameSite=Lax`, host-only, `Path=/`, `Max-Age=300`) y devuelve `https://t.me/<bot>?start=<nonce>` (32 bytes base64url).
   - **Teléfono o tableta** (`(hover: none) and (pointer: coarse)`, `lib/auth/telegram-login/open-mode.ts`): la MISMA pestaña navega al deep link y la app de Telegram lo intercepta. Un PC con pantalla táctil y mouse o trackpad cuenta como escritorio (con solo `pointer: coarse` navegaba la misma pestaña). Al volver, el navegador muestra esa pestaña esperando. Con una pestaña nueva volvía a t.me. Si el navegador descarga la pestaña, `sessionStorage` y la cookie retoman la espera.
   - **Escritorio**: la ventana se abre en el mismo clic, antes del `await`. Si igual la bloquean, la espera muestra un único botón grande **Abrir Telegram** y no dice «Esperando…» hasta que se toque.
2. La pestaña pasa a **Sigue en Telegram**, sin input y con tres pasos: 1. Toca Iniciar (Start). 2. Si es tu primera vez, toca Compartir mi número. 3. Toca el botón Entrar a La Polla. Botones **Abrir Telegram otra vez** y **Cancelar** (`DELETE /api/auth/telegram/request`). Consulta `GET /api/auth/telegram/request/status` cada 2 s mientras está visible y al volver (`visibilitychange`/`focus`/`pageshow`).
3. En Telegram, `/start <nonce>`:
   - **Cuenta de Telegram ya vinculada** (`telegram_login_identities`): NO pide el número. Guarda la cuenta y el hash del enlace en la fila de la solicitud (`telegram_login_request_approve`) y manda UN mensaje con un botón **Entrar a La Polla**.
   - **Sin vínculo**: pide el número UNA vez con teclado `request_contact` **persistente** (`is_persistent: true`, placeholder). Si no se ve, el texto describe el control por forma y lugar: «el ícono de cuatro cuadritos junto a la carita». En Telegram Web es ⌘, no un teclado. Un texto repetido antes de 2 min recibe la versión corta. Al llegar el contacto propio (chat privado, `contact.user_id === from.id`, sin reenvío) se busca o crea la cuenta, se vincula según las reglas de número reciclado, se quita el teclado y se manda el botón.
4. La persona toca el botón. **Ese enlace abre la sesión**:
   - en el mismo navegador (escritorio con Telegram Desktop o Web, Android con pestañas personalizadas): entra directo y la pestaña que esperaba ve `consumed` con `signedIn: true` y sigue a `returnTo`, `/casa` u `/onboarding`;
   - en otro navegador (por defecto, el interno de Telegram en el teléfono, que tiene sus propias cookies): la sesión queda allá y la pestaña original muestra **Entraste en otro navegador**, con SMS como primario y reintentar Telegram como secundario. Nunca un rebote mudo a `/login`.

**Enlace del bot** → página `/login/telegram?t=<token>` (dentro de `(auth)`: tarjetas, Bebas/Outfit, **sin splash ni bienvenida encima** (`lib/auth/telegram-login/link-path.ts`: llega en el navegador de Telegram con almacenamiento nuevo), `referrer: same-origin`, noindex). Vence a los **5 minutos** de emitido y sirve **una sola vez**; en la base solo queda el HMAC con pepper del token del bot. GET nunca abre sesión: si el navegador tiene la cookie `lp_tg_req` de ESA solicitud, envía solo el POST; si no, muestra **Confirma tu ingreso** con el número enmascarado y un botón (protección contra login CSRF). La máscara (`mask-phone.ts`) toma el código de país de la tabla de libphonenumber-js (la librería del selector de país) y deja ver solo los últimos 4 dígitos: `+351 ••• ••• 5581`, `+57 ••• ••• 2391`; sin código reconocible, `••• ••• 5581`. El canje es `POST /api/auth/telegram/link` (formulario, mismo origen), atómico, con aviso en Telegram del dispositivo que abrió el enlace. Si falla, 303 a `/login/telegram?estado=gone|failed|forbidden|sms_only|unavailable`, y la página dice qué pasó sin mostrar rutas. Desde 2026-09-15 el mismo bot es también la app para jugadores: `/login` y `/web` mandan el enlace; `/start` sin nonce y cualquier otro mensaje de una cuenta vinculada abren el menú del bot (sección siguiente). **Un solo enlace vigente por cuenta de Telegram** (migración 120): emitir cualquiera, suelto o ligado a una solicitud, vence en la misma transacción todos los demás sin usar de esa cuenta (la pestaña de una solicitud así vencida ve «vencida»).

**Topes**: 10 solicitudes / 15 min por IPv4 exacta o por /64 de IPv6, **sin tope global** (con uno, unas decenas de IPs dejaban a todos sin Telegram). 5 enlaces / 15 min y 20 / día por cuenta de Telegram. Se cuentan en `telegram_login_requests` bajo lock, en la misma transacción que la escritura. La pendiente vence a los 5 min; al emitirse el enlace, dura 5 min más. Con 429, `/login` muestra **Espera unos minutos** con el SMS como botón primario.

**Número reciclado.** Telegram prueba que el número está asociado HOY a esa cuenta de Telegram, no quién tiene hoy la SIM: no es un espejo del SMS.

| Estado del teléfono | Telegram |
|---|---|
| Sin cuenta | Crea la cuenta y queda vinculada a esa cuenta de Telegram |
| Cuenta vinculada a esta cuenta de Telegram | Entra; las siguientes veces sin compartir el número |
| Cuenta vinculada a otra cuenta de Telegram | Nunca: el bot pide usar el SMS y cancela la solicitud de la pestaña |
| Cuenta existente sin vínculo (creada por SMS) | Solo SMS, salvo `TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=true`: la primera cuenta de Telegram que entra queda vinculada |

`telegram_login_request_approve` y `telegram_login_link_issue` exigen en SQL que exista el vínculo y que el teléfono resuelva a esa misma cuenta; el canje lo vuelve a exigir (`telegramGrantAuthorizer`). Vincular una cuenta existente desde un nonce ajeno no le da nada a quien creó la solicitud: el enlace llega al Telegram de la cuenta.

**Riesgo que queda.** Si alguien convence a la persona de copiar el enlace del bot y pasárselo (el mensaje lleva `protect_content`, así que no se puede reenviar), la confirmación le muestra el número enmascarado y el bot avisa al entrar. Es la misma barrera que tenía v1 con el código.

**Pendiente de probar en dispositivos reales:** que el deep link abra la app de Telegram directo desde Safari (iPhone) y Chrome (Android), y cómo se ve el paso por el navegador interno de Telegram. Solo se probó con Playwright en contexto aislado.

**Retirados**: `/api/auth/telegram-verify` → 410; `/api/auth/telegram-link` (v1) → 303 a la página «Este enlace ya no sirve» (POST 410, HEAD 405); `/api/auth/telegram/request/complete` → 410 sin tocar DB. Las tablas y funciones de 115 quedan; `telegram_login_tokens` sin uso.

| Archivo | Rol |
|---|---|
| `app/api/telegram/login/route.ts` | Webhook. 503 sin configuración (sin leer body ni DB); secreto en tiempo constante antes del body |
| `lib/auth/telegram-login/handler.ts` | Lógica del bot (vinculado / sin vínculo / contacto) |
| `lib/auth/telegram-login/requests.ts` · `request-cookie.ts` · `session.ts` · `notify.ts` | RPC de 119, cookie `lp_tg_req`, sesión, aviso post-ingreso |
| `app/api/auth/telegram/request/{route,status/route}.ts` | Crear/cancelar, estado (con `signedIn` al consumirse) |
| `app/(auth)/login/telegram/page.tsx` · `lib/auth/telegram-login/link-page.ts` | Página del enlace: entrar directo, confirmar o explicar el estado |
| `app/api/auth/telegram/link/route.ts` | Canje del enlace: la única vía de sesión |
| `lib/auth/telegram-login/identity.ts` | Vínculo cuenta ↔ cuenta de Telegram (número reciclado) |
| `app/(auth)/login/page.tsx` → `LoginClient.tsx` | El servidor decide si el canal está completo; el cliente abre Telegram y espera |
| `lib/auth/telegram-login/bot-profile.ts` | Comandos (`/start` menú, `/pollas`, `/mispollas`, `/pagos`, `/perfil`, `/ayuda`, `/web`) y descripciones del bot, por defecto/es/en, sincronizados desde el servidor una vez por versión (`app_config.telegram_login_bot_profile_version`) |
| `app/api/cron/telegram-login-bot-profile/route.ts` · `.github/workflows/telegram-login-bot-profile.yml` | Sincronización a pedido (`CRON_SECRET`; `-f force=true` reenvía aunque la versión esté guardada) |
| `scripts/telegram-login-set-webhook.mjs` | `setWebhook` (`allowed_updates: ["message", "callback_query"]`) + los mismos textos de `bot-profile.ts`; `--texts-only` solo textos |
| `scripts/telegram-login-single-link-check.sql` · `telegram-login-v2-check.sql` · `telegram-login-check.sql` | Regresión SQL de 120, 119 y 115 contra Supabase local |

Activación de v2 (dueño): aplicar la migración 119 → deploy. Mismas tres variables que v1. Pruebas: `npm test -- tests/telegram-login.test.ts tests/telegram-login-polish.test.ts`.

**Ajustes tras la prueba real (2026-09-14, migración 120).** Máscara con el código de país correcto; misma pestaña solo en teléfonos y tabletas; sin splash sobre `/login/telegram`; un solo enlace vigente por cuenta de Telegram. El token del bot solo vive en Vercel, así que los comandos y descripciones ya no dependen del script: después de responder el primer update autenticado de cada versión, el webhook llama `setMyCommands`, `setMyDescription` y `setMyShortDescription` (por defecto, `es` y `en`; `/login` sale de la lista pero sigue funcionando) y guarda la versión en `app_config`. Si Telegram falla, no se guarda y se reintenta a los 10 min. Para no esperar a un update: `gh workflow run telegram-login-bot-profile.yml`. La 120 es aditiva (`CREATE OR REPLACE` de `telegram_login_request_approve` y `telegram_login_link_issue`) y el código no depende de ella: se puede aplicar antes o después del deploy.

#### Bot de Telegram para jugadores (2026-09-15, migración 130)

Pedido del dueño: que alguien que no usa apps pueda hacer TODO desde Telegram, sin abrir la web. Un solo bot público para login y app: `@LaPollaColombianaBot` (webhook `/api/telegram/login`; reemplazó a `@LaPollaColombianaAccesoBot` el 2026-09-15). Todo con botones; solo se escribe el nombre, el marcador si se prefiere («2-1»), el número de boleta, respuestas de texto y la cuenta de premios. **Sin LLM** (el dueño ofreció Claude Haiku): las acciones son botones con validaciones fijas, sin costo y sin riesgo de que un modelo interprete mal un pronóstico o un pago.

**Recorrido**

1. **Cuenta.** `/start` presenta el servicio y pide **Compartir mi número** (misma prueba de propiedad que el login: contacto propio, `contact.user_id === from.id`). El contacto crea o vincula la cuenta con las reglas de número reciclado; sin solicitud del navegador no manda enlace suelto: sigue con el perfil (hook `onLinked` de `lib/auth/telegram-login/handler.ts`). `users.whatsapp_number` queda sin «+», como en el SMS. El pedido va en dos mensajes: el primero deja el teclado `request_contact` (respaldo) y el último lleva el botón **Compartir mi número** pegado al mensaje, un `web_app` que abre `public/telegram/numero.html`: la mini app llama `Telegram.WebApp.requestContact()`, Telegram muestra su ventana nativa y manda el contacto al chat como un mensaje normal (no hay endpoint nuevo). Motivo (2026-09-15): en Telegram Web y computador el teclado queda detrás de un ícono y el dueño no encontró el botón. Sin https (desarrollo local) se manda solo el teclado. Headers propios en `next.config.mjs`: única ruta con `frame-ancestors https://web.telegram.org` y `script-src https://telegram.org`, sin `connect-src`. Bot, comandos y descripción van en español para todos los idiomas de Telegram.
2. **Perfil.** «Paso 1 de 2: tu nombre» (`isValidDisplayName`) y «Paso 2 de 2: tu pollito» (`POLLITO_TYPES`, botones con el equipo). Sin nombre real y pollito no se juega (mismo gate que el middleware). Después aparece el **menú fijo** de abajo: ⚽ Pollas abiertas · 🎟 Mis pollas · 💳 Mis pagos · 👤 Mi perfil · ❓ Ayuda.
3. **Inscribirse.** Detalle de la polla (pozo o premio, entrada, inscritos, cierre en hora de Colombia, estado de tu inscripción) → **Inscribirme** → pasos con el valor exacto y la cuenta de cobro de la polla en `<code>` (se copia con un toque) → la persona envía la **foto** (o una imagen como archivo). El servidor la baja de Telegram (máx. 8 MB, tipo por firma de bytes), y recorre el contrato v2 de la web con `lib/casa/proof-server.ts`: `casa_begin_entry_proof_v2` → subida al bucket privado en la ruta que decide SQL → verificación byte a byte → `casa_confirm_entry_proof_v2` → aviso a los administradores. El `requestId` sale del hash del archivo: reenviar la misma foto o un reintento de Telegram no crea otra inscripción. Rifas: «Dame un número al azar» o escribir el número (`casa_ticket_availability_v2`); una boleta pendiente bloquea comprar otra, como en la web. Una foto sin paso activo pregunta de cuál polla es.
4. **Mis pagos.** Confirmado / en revisión / rechazado (con motivo) / falta el comprobante. Además, cuando un administrador aprueba o rechaza (bot admin o web), `lib/casa/review-notify.ts` avisa por Telegram si la cuenta está vinculada, con el botón del siguiente paso (Pronosticar o Enviar el comprobante correcto). Antes ese aviso solo salía por WhatsApp, que está apagado.
5. **Pronosticar.** Un partido por mensaje, el bot pasa solo al siguiente que falta: 1X2 con **Gana Local / Empate / Gana Visitante**; marcador con goles 0–9 en dos toques o escribiendo «2-1»; Saltar, Ver todos (pronóstico, resultado verificado y puntos) y cambiar mientras el partido siga abierto. Preguntas manuales con botones de opciones o texto. Todo guarda con `saveCasaPicks` (`lib/casa/picks-save.ts`), la misma función de `PUT /api/casa/pollas/[slug]/picks`: inscripción pagada o en revisión, cierre de 5 minutos, partidos anulados, polla cerrada.
6. **Tabla.** `casa_leaderboard` (top 15 con medallas, «← tú» y tu puesto si estás más abajo).
7. **Info.** Las mismas reglas de `PollaInfo` en texto: cómo sumas puntos, premio y ganadores, mínimo garantizado y cuánto crece (SQL), cierre por partido, 90 minutos, partidos suspendidos y cómo te pagan.

**Cómo está hecho**

| Archivo | Rol |
|---|---|
| `lib/telegram-player/handler.ts` | Enrutador: login (`/start <nonce>`, `/login`, contacto) vs. bot; identidad por update; menú, textos, fotos y botones |
| `lib/telegram-player/update.ts` · `ids.ts` | Clasificación (solo chats privados, `chat.id === from.id`) y ids de 22 caracteres para `callback_data` (≤ 64 bytes, se revalidan en la base) |
| `lib/telegram-player/context.ts` | Pantallas (editar el mensaje del botón tocado o mandar uno nuevo) y paso esperado en `telegram_login_chats.bot_flow*` con vencimiento |
| `lib/telegram-player/profile.ts` · `pollas.ts` · `entry.ts` · `picks.ts` · `notify.ts` | Perfil y cuenta de premios · listas, detalle, reglas, tabla, pagos, ayuda · inscripción, rifas y comprobante · pronósticos y preguntas · aviso de revisión |
| `lib/casa/picks-save.ts` · `lib/casa/proof-server.ts` | Lógica compartida con las rutas web (extraída de `picks/route.ts` y `join/route.ts`); `saveCasaPicks` además rechaza una opción que no es de su pregunta |
| `lib/auth/telegram-login/webhook-updates.ts` | Tras un update autenticado: si el webhook no recibe `callback_query`, `setWebhook` con la MISMA url que devuelve `getWebhookInfo`, el secreto de la env y sin `drop_pending_updates`. Una vez por instancia |
| `supabase/migrations/130_telegram_player_bot.sql` | Columnas `bot_flow`, `bot_flow_data`, `bot_flow_at` (tabla ya service_role con deny-all). El número de cuenta bancaria nunca se guarda ahí |

**Activación (producción):** aplicar la migración 130 → deploy. Sin variables nuevas. El primer mensaje al bot después del deploy sincroniza comandos y agrega `callback_query` al webhook; hasta entonces los botones no llegan. El webhook tiene `maxDuration = 60` porque recibir un comprobante baja, sube y verifica la imagen antes de responder.

**Pruebas:** `npm test -- tests/telegram-player.test.ts tests/telegram-login.test.ts tests/telegram-login-polish.test.ts`. El recorrido completo (cuenta nueva, perfil, comprobante real en Storage, aprobación, pronósticos 1X2 y marcador, preguntas, rifa, tabla, reglas, cuenta de premios y `/web`) se probó contra Supabase local con un servidor falso de la Bot API (`TELEGRAM_LOGIN_API_BASE_URL`, solo fuera de producción).

**Prueba con Telegram real (2026-09-15).** Con un bot de prueba (`@LaPollaColombianaBot`, reservado a la cuenta del dueño), Telegram Web y un poller local (`getUpdates` → webhook local, Supabase local): registro compartiendo el número real, perfil, comprobante como foto JPG y como archivo PNG, aprobación y rechazo desde `/api/casa/admin/entries` con el aviso llegando al chat, reenvío tras rechazo, 1X2, marcador con botones y escrito, preguntas, rifa, puntos tras cerrar un partido, tabla, reglas y cuenta de premios. 82 updates, todos 200. Lo que corrigió: en Telegram para computador el menú fijo queda escondido detrás de ⌘ (ahora las opciones también van como botones del mensaje); tocar un botón de «Recibimos tu comprobante» o «Confirmamos tu pago» borraba ese mensaje (esos botones abren uno nuevo, marca `!` en `callback_data`); la rifa rechazada ofrece reenviar la boleta; Telegram devuelve en sus errores la URL con el token del enlace (ya no se loguea) y un error de red perdió un aviso (un reintento).

**Pago pendiente, doble inscripción y doble toque (2026-09-15).** Quien envía el comprobante ya pronostica; sus puntos se calculan igual (`casa_score_polla`) pero la tabla solo suma pagos aprobados (`casa_leaderboard`), así que al aprobar aparecen retroactivos. El bot y la web lo explican con el aviso de pago en revisión. `scripts/casa-pending-picks-check.sql` lo verifica (y que `casa_entries_one_per_user` impide inscribirse dos veces). Un toque que cae sobre un mensaje recién editado (≤1 s, `edit_date`) se ignora con «La pantalla acaba de cambiar…», porque el botón siguiente aparece donde estaba el tocado.

**Límites conocidos:** el bot habla solo español (Casa es colombiana); no manda recordatorios de partidos por jugar; en Telegram no hay «pronósticos de los demás» ni fotos de escudos.

### Pollas

Una polla es un grupo PRIVADO de pronósticos (`type='closed'` siempre). El creador configura:
- Torneo (Mundial 2026, UCL 2024-25, etc.)
- Alcance (torneo completo, fase de grupos, eliminatorias, partidos custom)
- Modo de pago: `admin_collects` (organizador recoge en Nequi/efectivo) o `pay_winner` (todos pagan al ganador al final)
- Monto de entrada en COP
- Distribución de premios (porcentaje o monto fijo, configurable después)

Para entrar a una polla ajena:
- **Link de invitación** del organizador (`pollas.invite_token`)
- **Código de 6 caracteres** del organizador, usable desde la app o desde el bot

### Pronósticos

- Cada participante predice el marcador exacto de cada partido.
- Los pronósticos se cierran 5 min antes del kickoff (trigger DB `check_prediction_lock`).
- Los pronósticos ajenos son invisibles hasta que el partido pase a `live`.
- Sistema de 5 niveles:
  - Marcador exacto → 5 pts (configurable por polla)
  - Ganador correcto + misma diferencia de gol → 3 pts
  - Ganador correcto solamente → 2 pts
  - Acertar el marcador de un solo equipo → 1 pt
  - Nada → 0

### Sistema de puntos

El trigger `on_match_finished` recalcula puntos cuando el partido pasa a `finished`. El ranking dentro de cada polla usa `RANK()` window function (empates comparten posición). El recálculo se replica en TS (`lib/scoring.ts`) para casos manuales.

### WhatsApp bot

`/api/whatsapp/webhook` recibe inbound del bot. Comportamientos:
- Mensajes "hola", "menu", "muestrame el menu" → menú principal
- Código de 6 caracteres → confirma + agrega a la polla
- Link de polla → "esa polla es privada, pedile el código al admin"
- Estado de conversación persistido en `whatsapp_conversation_state` (TTL 10 min) para flujos multi-paso (predecir, etc.)

Botones interactivos vía Meta Cloud API (button + list messages, CTA URL).

### Login events en /avisos

Cada login exitoso (SMS, magic-link o Telegram) genera una notificación tipo `login_event` con device + ciudad+país (de los headers de Vercel). Aparece en el feed de avisos del usuario.

---

## Estructura del proyecto

```
app/
  (app)/              # Rutas autenticadas
    inicio/           # Home: hero, en vivo, próximos, podio, rivales
    pollas/           # Lista de pollas + crear (wizard 3 pasos) + detalle
    perfil/           # Perfil + cambiar clave
    avisos/           # Feed de notificaciones (incluye login events)
    invites/polla/    # Landing de invite (con preview)
    admin/matches/    # Sync manual de partidos (admin only)
  (auth)/             # Rutas públicas / pre-onboarded
    login/            # Phone input → check-phone → password o bot-OTP
    login/password/   # Phone+password input
    set-password/     # Crear o resetear clave (mandatory post-OTP)
    verify/           # Backward-compat: ingresa código del bot
    onboarding/       # Nombre + pollito
  api/
    auth/check-phone, login-password, set-password, otp, login-poll, login-wait
    pollas/, pollas/[slug]/{join,predictions,payments,...}
    whatsapp/webhook, matches/{discover,sync-live}, admin/...
  sw.ts               # Service worker source (Serwist genera /public/sw.js)
components/
  polla/              # PollaCard, PaymentsList, OrganizerPanel, etc.
  inicio/             # PodiumCarousel, GreetingHero, RivalChip, etc.
  shared/             # WhatsAppBubble (header de inicio), TournamentBadge
  avisos/             # AvisosList con tipos + iconos
  ui/                 # PhoneInput, Toast, Button, etc.
lib/
  auth/               # phone, turnstile, login-event, user-agent, rate-limit, admin
  db/columns.ts       # Listas explícitas — evita select("*")
  log.ts              # redactPhone/Id/Text para no leakear PII en logs
  whatsapp/           # bot, flows, menu-intent, interactive, state, bot-phone
  matches/, pollas/, scoring.ts, notifications.ts
supabase/migrations/  # 001 → 020. Append-only. Cada uno está documentado.
```

---

## Deploy

`main` se auto-despliega en Vercel. Para forzar prod manual: `vercel --prod`.

Después de un deploy nuevo:
1. Verificá que `npm run validate` pasa antes de pushear
2. Confirmá envs en Vercel → Settings → Environment Variables (incluido `CLOUDFLARE_TURNSTILE_SECRET_KEY` que ahora se valida server-side)
3. Confirmá que el webhook de Meta apunta a `https://lapollacolombiana.com/api/whatsapp/webhook`
4. Confirmá Site URL de Supabase → Auth en `lapollacolombiana.com`
5. Confirmá `SUPABASE_SECRET_KEY` (sb_secret_) y la IP real en Supabase Auth
   (ver «IP real en Supabase Auth»)

### Estado en producción (2026-09-13)

Foto de lo que quedó activo antes del lanzamiento. Producción:
`dpl_4kJdLw97EdCV9Y3ftz1ADtgsMTYX` (`main` 7d9ca5a); los merges posteriores del
mismo día (#73, #74 y la corrección de monitoreo) solo tocan documentación. Toda la configuración de
Auth se lee y cambia con la Management API
(`GET`/`PATCH /v1/projects/<ref>/config/auth`) usando un token con permisos
del proyecto. Nunca pegues secretos en el PATCH desde la terminal; léelos de
un archivo.

| Pieza | Estado | Cómo se apaga o se prende |
|---|---|---|
| IP real en Auth (`Sb-Forwarded-For`) | **Activa.** `security_sb_forwarded_for_enabled=true` y `SUPABASE_SECRET_KEY` en Production. Los logs de Auth muestran la IP del usuario en `remote_addr` | Apagar: PATCH `{"security_sb_forwarded_for_enabled": false}`. Sin la env, `auth-ip` cae a anon sin cabecera |
| SMS por LabsMobile (Send SMS Hook) | **Configurado y apagado.** URI `https://lapollacolombiana.com/api/auth/sms-hook` y secreto guardados en Auth; `sms_provider` sigue siendo `twilio_verify`; `sms_otp_exp=600` | Prender: PATCH `{"hook_send_sms_enabled": true}`. Rollback: PATCH `{"hook_send_sms_enabled": false}`, que vuelve a Twilio al instante sin deploy |
| Login por Telegram | **Activo.** Bot `@LaPollaColombianaBot` (antes `@LaPollaColombianaAccesoBot`), webhook en `/api/telegram/login` (`allowed_updates: ["message"]`), migración 115 aplicada, `TELEGRAM_LOGIN_ALLOW_EXISTING_ACCOUNTS=true`. **v2 (migración 119, sin códigos) pendiente de aplicar y desplegar** | Apagar: quitar una de las tres variables `TELEGRAM_LOGIN_*` en Vercel y redeploy (la opción desaparece de `/login` y el webhook responde 503) |
| Captcha de Auth | **Apagada** (`SMS_CAPTCHA_ENFORCED` sin definir y `security_captcha_enabled=false`). Widget Turnstile en `/login` y verificación en `start-otp` listos; activación en «Captcha de Auth (Turnstile)» | — |
| Backup | **Activo.** Runner del DGX fijado a `main` 7d9ca5a (checkout detached): backup a las 00:10, 06:10, 12:10 y 18:10 y verify a las 03:40 (hora de Bogotá). Cada corrida escribe en `backup_runs` (migración 117). `backup-freshness.yml` está programado cada hora y manda correo si hay atraso (ojo: GitHub corre los `schedule` de este repo con horas de retraso, ver «Crons de GitHub Actions»). El PC baja los snapshots con la tarea programada `La Polla backup pull` | Detalle en `ops/backup/README.md`. Si cambian `ops/backup` o `scripts/export-backup.ts`, en el DGX hay que repetir `git fetch`, `checkout` y `npm ci` |
| Planes | Vercel Pro, Supabase Pro compute Small, API-Football Pro (vence 2026-10-09) | — |
| Monitoreo | **Uptime en Sentry, sin aviso conectado.** Monitor «Uptime Monitoring for https://lapollacolombiana.com» (proyecto `santi-apps`, entorno `production`): `HEAD /api/app-version` cada 5 min, timeout 10 s, abre incidente tras 3 fallos y lo cierra con 1 éxito. **No tiene ninguna alerta (workflow) conectada**, así que un incidente no le avisa a nadie: hay que abrir Sentry para verlo. No hay SDK de Sentry en el código ni integración en Vercel. Los errores de la app se revisan en los logs de Vercel y en los correos de alerta (discrepancias, backup atrasado, SMS fallido o tardío) | Conectar el aviso: en Sentry → Monitors → Alerts, crear una alerta conectada a este monitor que mande email. Apagar: botón Disable en la edición del monitor |

**Prueba de LabsMobile del 2026-09-13.** Con el hook prendido se mandó un solo
SMS real: Supabase llamó al hook (200) y LabsMobile lo aceptó a las 16:10:41Z.
Como a los 8 minutos no había acuse, el hook se apagó (16:18:48Z). El acuse
llegó después: `handset` / `DELIVERED` a las 16:44:03Z, **2.002 s de demora**
(`sms_entregas.demora_seg`). La ruta funciona de punta a punta, pero un código
que vence a los 600 s no sirve con esa latencia. Antes de volver a prender el
hook hay que confirmar con LabsMobile, en horario hábil, que la ruta a Colombia
entrega en segundos (primer envío en revisión manual, domingo o cola) y repetir
la prueba exigiendo acuse `handset` en menos de 60 s.

Alertas de SMS que hay hoy: cuando llega el acuse, `aplicar_sms_ack` marca
`alertado_at` y `/api/sms/ack` manda correo si el SMS falló (`ko`) o tardó
más de 120 s (así salió el aviso de las 16:44:43Z). **El vigía de silencio
(`revisarSilencios` en `lib/sms/entregas.ts`, 5 min sin acuse) no tiene cron
conectado**: si LabsMobile nunca manda acuse, nadie se entera. Antes de
prender el hook, conecta ese vigía a un cron.

**Cookies de sesión.** Desde el 2026-09-14 las cookies `sb-<ref>-auth-token`
salen con `Secure` en producción, `SameSite=Lax`, `Path=/` y sin `Domain`
(host-only), por SMS, magic-link o Telegram: los cuatro clientes de
`@supabase/ssr` usan `sessionCookieOptions()` de
`lib/supabase/cookie-options.ts`, y `lp_onb` usa `onboardingCookieOptions()`
(además `HttpOnly`). Las `sb-*` **no** son `HttpOnly`: `lib/supabase/client.ts`
(Perfil, Onboarding) lee la sesión desde `document.cookie`. En `next dev`
(http) salen sin `Secure`. Prueba: `npx vitest run tests/supabase-cookie-options.test.ts`
(revisa el `Set-Cookie` real de @supabase/ssr). Las sesiones ya abiertas pasan
a `Secure` en el siguiente refresco del token.

### IP real en Supabase Auth

Supabase Auth limita `/auth/v1/otp` y `/auth/v1/verify` por IP (30 cada
5 minutos). El login los llama desde Vercel, así que sin más configuración
todos los usuarios comparten las IPs de salida de Vercel y un pico de logins
agota el cupo de todos. `lib/supabase/auth-ip.ts` manda la IP del usuario en
`Sb-Forwarded-For` ([doc](https://supabase.com/docs/guides/auth/rate-limits#ip-address-forwarding)).
Supabase la respeta solo con las dos condiciones:

1. **Env en Vercel** (Production y Preview), server-only:
   `SUPABASE_SECRET_KEY=sb_secret_...` (Dashboard → Settings → API Keys →
   Secret keys; conviene una key propia para esto, rotable sola). Redeploy.
2. **Después del deploy**, activar el reenvío en el proyecto:

   ```bash
   curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth"      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"      -H "Content-Type: application/json"      -d '{"security_sb_forwarded_for_enabled": true}'
   ```

   o Dashboard → Authentication → Rate Limits → IP Address Forwarding.

Qué pasa con cada configuración incompleta:

- **Sin la env:** anon key sin cabecera, como antes, con un `warn` en logs.
- **Sin el flag:** Supabase ignora la cabecera.
- **Con una key que Supabase rechaza** (revocada, rotada, de otro proyecto o
  mal copiada): el gateway responde 401 `Invalid API key` antes de llegar a
  Auth. `fetchWithAnonFallback` repite esa llamada una vez con la anon key sin
  cabecera y deja un `console.error` con `[auth-ip] Supabase rechazó
  SUPABASE_SECRET_KEY`. El login sigue funcionando, pero sin IP real, hasta
  corregir la env y volver a desplegar. Cada llamada suma un viaje extra.
  Rotar esa key: crear la nueva, actualizar Vercel, desplegar y solo después
  revocar la vieja.

**Smoke test en Preview antes de poner la env en Production:** con la env en
Preview y el deploy listo, pide un código real desde `/login` del Preview,
ingrésalo y confirma que entras a `/casa`. En los logs de ese deploy no debe
aparecer `[auth-ip] Supabase rechazó`. Si aparece, la key está mal.

Verificación: en los logs de Auth, `/otp` y `/verify` pasan de mostrar IPs de
AWS (`3.236.x`, `54.82.x`) a las IPs de los usuarios.

#### Captcha de Auth (Turnstile)

Código listo desde el 2026-09-14; **la captcha sigue apagada** (en la app y en
Supabase) hasta la activación de abajo.

> **Supabase NO verifica la captcha en `start-otp`.** Esa ruta llama a
> `signInWithOtp` con la secret key (`sb_secret_`, necesaria para
> `Sb-Forwarded-For`). El gateway la traduce a service_role y GoTrue omite la
> captcha con credenciales de admin (`verifyCaptcha` en
> `internal/api/middleware.go`). Activar solo `security_captcha_enabled`
> cierra `/auth/v1/otp` directo, pero deja `POST /api/auth/start-otp` sin
> token enviando SMS. Por eso la app verifica el token ella misma.

- `/login` monta el widget de Cloudflare Turnstile (modo Managed, siempre
  visible, tema oscuro) junto a «Enviar código por SMS»
  (`components/auth/SmsCaptcha.tsx`). El script
  `challenges.cloudflare.com/turnstile/v0/api.js` solo se inyecta ahí; la CSP
  ya permite ese origen en `script-src` y `frame-src`.
- El token va a `/api/auth/start-otp` como `captchaToken`.
- **Con `SMS_CAPTCHA_ENFORCED=true`** (env de servidor), `start-otp` verifica
  el token contra `siteverify` ANTES del tope diario, del intento por teléfono
  y de Supabase (`lib/auth/captcha.ts`): `success`, hostname
  `lapollacolombiana.com` o `chickenpicks.app` (más
  `SMS_CAPTCHA_EXTRA_HOSTNAMES`, separados por coma) y acción `sms-otp`. Hay
  un reintento con la misma `idempotency_key` si Cloudflare no responde. Falla
  cerrado: sin token, token inválido o Cloudflare caído → 403 `captcha_failed`
  sin gastar cupo ni enviar; sin `CLOUDFLARE_TURNSTILE_SECRET_KEY` → 503. El
  token ya usado no se reenvía a Supabase. Si no hay `SUPABASE_SECRET_KEY`
  (llamada con anon key), GoTrue sí verifica: la ruta solo exige el token y lo
  reenvía. En `/login` ya no se puede enviar sin token: si el widget falla,
  se pide «Reintentar verificación» (Telegram sigue disponible).
- **Sin la env** se conserva el comportamiento anterior: el token se reenvía a
  `signInWithOtp` y un widget roto no bloquea (se envía sin token). Si
  Supabase rechaza la captcha, 403 `captcha_failed` y se libera el intento.
- Telegram no usa la captcha: `generateLink` va con credenciales de admin y
  `/verify` no la pide.
- Site key pública: `NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY` (ya está en
  Vercel Production desde abril). Sin ella no se monta el widget. El secret
  `CLOUDFLARE_TURNSTILE_SECRET_KEY` (Vercel Production) lo usa `start-otp`
  con la env activa; es el mismo secret que se carga en Supabase.
- Hostnames verificados del widget (2026-09-14): `lapollacolombiana.com`
  emite tokens válidos con el secret (siteverify `success`, `hostname`
  correcto). **`chickenpicks.app` NO está autorizado** (error 110200): antes
  de activar, agregar ese hostname en Cloudflare → Turnstile → widget, o el
  SMS de ese dominio queda sin captcha válida.
- Pruebas: `npm test -- tests/sms-captcha.test.ts tests/auth-real-ip.test.ts`.
  En local, la site key de prueba `1x00000000000000000000AA` siempre pasa el
  widget. Con `SMS_CAPTCHA_ENFORCED=true`, el secret de prueba NO sirve:
  Cloudflare responde `hostname=example.com` y sin `action` (verificado el
  2026-09-14), así que `start-otp` lo rechaza. Para probar la env de punta a
  punta usa el widget real (`SMS_CAPTCHA_EXTRA_HOSTNAMES` para un hostname
  extra autorizado en Cloudflare).

**Activación (orden):**

1. Merge y deploy de este código. Sin `SMS_CAPTCHA_ENFORCED` y con la captcha
   de Supabase apagada, el login no cambia.
2. Agregar `chickenpicks.app` al widget en Cloudflare (o aceptar que ese
   dominio no tenga SMS: con la env activa, sus tokens salen con error 110200).
3. Confirmar que `CLOUDFLARE_TURNSTILE_SECRET_KEY` de Vercel Production es el
   secret del widget de la site key. Agregar `SMS_CAPTCHA_ENFORCED=true` en
   Vercel Production y redeploy (Vercel Git, no CLI).
4. `PATCH /v1/projects/<ref>/config/auth` con
   `security_captcha_provider=turnstile`, `security_captcha_secret=<secret del
   widget>` y `security_captcha_enabled=true` (cierra `/auth/v1/otp` directo).
5. Smoke, los cuatro:
   - SMS real desde `lapollacolombiana.com/login`: debe llegar.
   - `POST https://lapollacolombiana.com/api/auth/start-otp` con
     `{"phone":"+57..."}` **sin `captchaToken`**: debe responder **403**
     `captcha_failed` (y no llegar SMS). Con un token inventado, también 403.
   - `POST /auth/v1/otp` directo con la anon key: debe responder
     `captcha_failed`.
   - Telegram sigue funcionando.

**Reversa:** quitar `SMS_CAPTCHA_ENFORCED` (o ponerla en `false`) y redeploy;
y `PATCH /config/auth` con `security_captcha_enabled=false` (sin deploy).

**Antes de la captcha (histórico, 2026-09-13).** `/auth/v1/otp` acepta
llamadas directas con la anon key pública, así que el tope diario, el de IP y
el de teléfono de `start-otp` no frenan a quien llame a Supabase directo. Solo
lo frenan los límites de Supabase (`rate_limit_otp` 30 cada 5 min por IP,
`rate_limit_sms_sent` 300 por hora para todo el proyecto). Un script con
números rotados puede gastar 300 SMS por hora y dejar sin login a todos
(2026-09-13: `security_captcha_enabled=false`, `disable_signup=false`).
Plan, en este orden:

1. La secret key funcionando en Production (arriba) y verificada en logs.
2. En un proyecto de Supabase de prueba (Preview usa el mismo proyecto que
   producción, así que ahí no sirve), activar la captcha de Auth
   (`security_captcha_enabled`, proveedor y secret) y confirmar dos cosas:
   `start-otp`, `verify-otp` y `wa-magic` siguen funcionando, porque GoTrue se
   salta la captcha con credenciales de admin (`verifyCaptcha` en
   `internal/api/middleware.go`), y un `POST /auth/v1/otp` directo con la anon
   key responde `captcha_failed`. `/verify` no pide captcha; el refresh de
   `/token` está exento.
3. Recién ahí activarla en producción.

Con captcha activa, la repetición con anon key de una secret key rechazada
ya no salva `/otp`: ese caso también exige el smoke test de Preview. La
alternativa es un Send SMS Hook que valide contra `otp_rate_limits`.

Los helpers devuelven solo `client.auth`; para datos siguen
`lib/supabase/server.ts` y `lib/supabase/admin.ts`. Prueba local: GoTrue con
`GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED=true` registra `remote_addr` con la
IP reenviada y separa los baldes de `/verify` por esa IP; login completo con y
sin la env deja la misma cookie `sb-<ref>-auth-token` y `/casa` responde 200.
Unitarias: `npm test -- tests/auth-real-ip.test.ts`.

### Crons de GitHub Actions (`/api/cron/*`)

| Workflow | Ruta | Horario |
|---|---|---|
| `match-reminders.yml` | `/api/cron/match-reminders` | diario 13:00 UTC |
| `admin-discrepancies-email.yml` | `/api/cron/admin-discrepancies-email` | diario 13:00 UTC |
| `cleanup-payout-proofs.yml` | `/api/cron/cleanup-payout-proofs` | **solo manual** (pendiente de aprobación del dueño) |
| `backup-freshness.yml` | `/api/cron/backup-freshness` | cada hora, minuto 17 (respaldo; el principal es pg_cron, minuto 25) |

- **Los `schedule` de GitHub llegan tarde en este repo.** `match-reminders` y
  `admin-discrepancies-email` (13:00 UTC) arrancaron entre las 15:54 y las
  16:48 UTC del 2026-09-10 al 2026-09-13: casi 3 a 4 h de retraso. GitHub
  no garantiza la hora y puede saltarse corridas con carga alta.
  `backup-freshness.yml` llegó a `main` a las 15:45 UTC del 2026-09-13 y, a
  las 18:37 UTC, sus horarios de las 16:17, 17:17 y 18:17 seguían sin correr
  (solo había corridas manuales). En la práctica, un backup atrasado puede
  avisar varias horas después del umbral de 7 h. Por eso la migración 124 agrega
  el job de pg_cron `backup-freshness-hourly` (`25 * * * *`) →
  `public.trigger_backup_freshness()` → `POST` con `Authorization: Bearer`,
  URL de `app_config.app_base_url` y secreto de vault `app.cron_secret` (mismo
  patrón y mismo secreto que `trigger_sync_live()`). El workflow sigue como
  respaldo: con el backup atrasado pueden llegar hasta dos correos por hora.
  Si rotas `CRON_SECRET` en Vercel, actualiza también `app.cron_secret` en vault.

- `backup-freshness` lee `public.backup_runs` (migración 117, la llena el
  backup del DGX) y le escribe a `ADMIN_ALERT_EMAIL` (o `FEEDBACK_NOTIFY_EMAIL`)
  «Backup de La Polla atrasado» si el último backup bueno pasa de
  `BACKUP_MAX_AGE_HOURS` (7) o la última verificación de
  `BACKUP_VERIFY_MAX_AGE_HOURS` (30). La primera verificación tiene margen:
  sin filas `kind=verify` y con el primer backup bueno de 30 h o menos, no
  alerta. Responde `{ok, stale, age_hours,
  verify_stale, verify_age_hours, sent}`; 502 si Resend falla, 500 si la tabla
  no existe. Detalle: `ops/backup/README.md`.

- El middleware exime `/api/cron/` (con barra final) del gate de sesión; cada
  handler se protege solo con `requireCronSecret(request)`
  (`lib/auth/cron-secret.ts`): `Authorization: Bearer $CRON_SECRET`, comparación
  en tiempo constante, 403 si no coincide y 500 si falta la variable. Ruta nueva
  bajo `app/api/cron/` sin esa llamada = test rojo (`tests/cron-auth.test.ts`).
- El `CRON_SECRET` del repo en GitHub debe ser igual al de Vercel. Un 403 en el
  workflow significa que no coinciden.
- Los workflows fallan ante cualquier status que no sea 2xx o sin `"ok": true`,
  con `--max-time 90` y sin reintentos, e imprimen solo contadores.
- `admin-discrepancies-email` responde **502** `{error:"email send failed"}` si
  Resend rechaza el envío (key revocada, sin cuota, dominio sin verificar):
  el SDK no lanza excepción, así que el handler revisa el `error` devuelto.
  El detalle del proveedor queda solo en el log de Vercel
  (`tests/cron-admin-discrepancies-email.test.ts`).
- Verificación después de un deploy: `curl -X POST https://lapollacolombiana.com/api/cron/match-reminders`
  sin header debe dar **403** (nunca 307), y `gh workflow run match-reminders.yml`
  debe terminar en verde.
- Limpiar comprobantes a mano: `gh workflow run cleanup-payout-proofs.yml -f confirm=BORRAR`.
  Borra de forma irreversible; confirma antes que el backup los tenga.

---

## Tags de seguridad / rollback

- `pre-wompi-removal` — antes de eliminar el flujo Wompi/digital_pool

Para revertir cualquier deploy: `git revert <sha> && git push origin main`.

---

## Backup y restore

El plan free de Supabase no incluye backups automáticos y pausa los
proyectos inactivos, así que la copia de los datos vive afuera:

```bash
npx tsx scripts/export-backup.ts       # dump completo (solo lectura)
npx tsx scripts/verify-backup.ts       # sha256 de tablas, auth, Storage y esquema, offline
npx tsx scripts/restore-backup-sql.ts  # genera el .sql para psql contra Supabase local
npx tsx scripts/restore-backup.ts      # dry run por default; escribe solo en local
```

Deja `backups/<fecha>/` con todas las tablas de `public`, `auth` (+ SQL de
restore con los mismos uuid), los archivos de Storage (paginados y cruzados
contra `storage.objects`), las migraciones del repo, el esquema vivo de prod
(`schema/live`) y un `RESUMEN.md` con la tabla final de cada polla en texto
plano. Se escribe en `<fecha>.partial/` y se renombra al terminar. `backups/`
está en `.gitignore`: **lleva teléfonos y este repo es público.**

Guía completa: [docs/backup-restore.md](docs/backup-restore.md).

---

## Pendiente / Roadmap

- **`auth.uid()` raíz** — el JWT de SSR no llega al PostgREST → `auth.uid()` devuelve NULL. El workaround: 46 archivos usan `createAdminClient()` con filtros `.eq("user_id", user.id)` manuales. Ver `docs/auth-uid-handoff.md`.
- Optional: husky pre-commit hook + GitHub Actions CI cuando entren colaboradores.

---

## Legal

La plataforma no procesa pagos reales. El campo `payment_mode` solo registra el acuerdo entre participantes. El modelo actual está fuera del alcance regulatorio de Coljuegos por no involucrar procesamiento de dinero.

---

Construido con ☕ en Medellín / Lisboa por [@SantiagoDevRel](https://github.com/SantiagoDevRel)

### Mis pollas en Casa y Perfil (2026-09-09)

**Pollas cerradas públicas (2026-09-17, pedido del dueño).** Desde el 16-sep
(Ofigolazo en adelante, `PUBLIC_CLOSED_SINCE` en `lib/casa/types.ts`) una polla
cerrada es pública para cualquier usuario con sesión: sale en Pollas cerradas y
`/api/casa/pollas/[slug]/match-picks` deja ver los pronósticos de los partidos ya
empezados aunque no se haya inscrito (sin «Tu pronóstico»). Las cerradas anteriores
solo las ven sus participantes. Los comprobantes de pago siguen privados (pueden
mostrar la cuenta del ganador). La tabla ya era visible con sesión.

`components/casa/MyPollas.tsx` muestra las inscripciones reales del usuario,
con contador, estado de pago, búsqueda y páginas de cinco cuando hay muchas.
En `/casa`, el orden es Mis pollas, Pollas disponibles y Pollas cerradas. Mis pollas
(prop `activeOnly`) muestra solo pollas en juego y empieza abierta si hay alguna; las
finalizadas pasan a Pollas cerradas marcadas «Participaste». Pollas disponibles empieza
abierta si hay disponibles o si no hay nada en juego; cerradas empieza cerrada. Comparten título/subtítulo y contienen sus tarjetas dentro de
`PollaSection`. En Perfil, `MyPollas split` muestra Mis pollas (en juego) y Pollas cerradas (en gris) como dos desplegables compactos cerrados, debajo de «Cuenta para cobrar», que
quedó justo bajo el celular (2026-09-17). Las inscripciones pendientes o pagadas se
muestran una vez por polla y se excluyen del listado para nuevas inscripciones.
Las rechazadas/anuladas y los borradores/archivados no se cuentan como participación.
El historial finalizado se conserva después de las participaciones actuales.

`lib/casa/my-pollas.ts` pagina las lecturas por usuario y deduplica entradas
de rifas sin cambiar datos. `/api/casa/mis-pollas` valida la sesión antes de
leer y devuelve solo nombres, destino, estado y torneos, con `private, no-store`.
Casa usa el mismo helper en el servidor; Perfil usa el endpoint. No se crean
inscripciones de demostración: cero es un resultado real; un fallo tiene su
propio estado con reintento. No se tocan pronósticos ni el modelo P2P histórico.

### Actualizaciones publicadas

`/api/app-version` devuelve únicamente el identificador público del build con
`Cache-Control: no-store`, sin consultar sesión ni base de datos. `SWAutoReload`
compara ese ID al abrir, volver a la pestaña, recuperar conexión y cada dos minutos
visibles. Al abrir la app o regresar, una versión nueva se carga automáticamente
si no hubo interacción ni hay ediciones pendientes. Se vuelve a comprobar esto
después de instalar el worker para no perder cambios hechos durante la espera.
`PicksBoard` y `QuestionsBoard` exponen `data-app-update-blocked` mientras tienen
pronósticos sin guardar o están guardando; también se protege la edición de campos.
Durante el uso activo se muestra un aviso inferior con «Actualizar app». Su X
lo oculta hasta la próxima entrada; solo desaparece definitivamente al actualizar.
No hay botón permanente en Perfil. Un guard por par de builds en `sessionStorage`
evita bucles si el CDN devuelve temporalmente el HTML anterior.
La recarga conserva cookies y almacenamiento,
comprueba conexión y actualiza el worker sin desregistrarlo ni vaciar cachés.
Vercel aporta `VERCEL_DEPLOYMENT_ID`/`VERCEL_URL`; para probar dos builds locales,
usar `APP_BUILD_ID` distinto en cada `npm run build`. No requiere proveedor adicional.

### Rendimiento de medios y shell (2026-09-10)

`AppBackground` pinta primero `.lp-humo`, tres gradientes CSS animados que no
descargan archivos. Login conserva ese humo y no solicita video; onboarding
mantiene el video que ya tenía. En el shell autenticado,
`lib/background-connection.ts` mantiene la conducta existente: ahorro de
datos/2G/3G queda en humo y las demás conexiones rotan los cinco MP4 lite.
La política escucha `connection.change`; el humo pausa sus animaciones cuando
el clip ya cubre la pantalla. Los modales prefieren también el MP4 lite y
conservan WebM como fallback.

El proxy deja pasar MP4/WebM como archivos públicos y sus headers permiten
reutilizarlos sin revalidar durante un día. El worker manda esas solicitudes
a la red para no leer posibles respuestas HTML de un cache anterior; el cache
HTTP del navegador conserva el soporte de rangos. Serwist guarda los escudos
con hash en `lp-team-crests` y el arte mutable en `lp-art` mediante SWR. Del directorio
público, el precache solo incluye manifest e iconos de 192/512; los chunks de
más de 256 KiB se guardan al usarse y los stubs estáticos de `app/api/**` no
entran porque ningún browser los solicita. Los masters MP4 de edición permanecen
en el repo pero `.vercelignore` evita subirlos. `TOURNAMENT_ICONS` entrega las
variantes de 96 px para sus usos pequeños.

PostHog se importa después de `load` + idle. Encola las transiciones que ocurran
mientras carga y conserva pageviews y autocapture de clics una vez inicializado;
una visita que termine antes de esa carga diferida no alcanza a reportarse. Replay,
encuestas, flags, mapas de calor, dead clicks, métricas de performance y
dependencias remotas quedan apagados. `/` y el retorno autenticado desde login entran directo a
`/casa`, sin el salto intermedio por `/inicio`.

### Correo de contacto

`info@lapollacolombiana.com` recibe mediante el plan gratuito de
[Forward Email](https://forwardemail.net/en/faq) y reenvía al Gmail del administrador.
Los DNS siguen en Vercel: MX `mx1.forwardemail.net` (10) y `mx2.forwardemail.net`
(20), configuración de alias en TXT cifrado y SPF de Forward Email. Solo se
configura `info`, sin catch-all. El destino personal no se publica en el repositorio
ni en el TXT en texto plano. Las páginas de soporte, privacidad y eliminación
de cuenta muestran esta dirección. La entrega a Gmail y la verificación de la
cuenta se comprobaron el 9 de septiembre de 2026. El envío como `info` no forma
parte de este reenvío; la configuración de Resend en `send.*` permanece separada.


### Casa v2: premios y comprobantes (implementación 2026-09-12)

El contrato v2 separa pozo y objeto, conserva las boletas fallidas para su dueño,
identifica cada comprobante en las aprobaciones y registra desempate/evidencia/entrega.
Migraciones 097–102; activación explícita `legacy → paused → v2`. No activar ni
revertir a ciegas. Procedimiento, límites, pruebas y despliegue en
[docs/casa-v2-production.md](docs/casa-v2-production.md). La descripción histórica
de 096 arriba no es el contrato de liquidación una vez activado v2.

### Casa: invitaciones y cupos de regalo (2026-09-17, migración 135)

Por cada 5 personas nuevas que alguien invita y pagan una polla, esa persona
recibe un cupo gratis en la misma polla. Nadie en la administración tiene que
hacer nada.

- **Invitar.** Compartir agrega `?ref=CODIGO` al enlace y el mensaje dice el
  código. Junto a Compartir, «Invita y gana» muestra la regla en una frase, el
  avance (`Llevas 3 de 5`), el código para copiar y una sola letra menuda
  («*Solo aplica para usuarios nuevos que entren con tu enlace o pongan tu código,
  1 polla por usuario.»); en Perfil está el
  código con un enlace general.
- **Aviso al entrar.** Mientras haya una polla abierta con invitaciones, /casa y
  esa polla muestran una vez «Por 5 invitados, te damos un cupo en la POLLAGOL»
  con el código para copiar y Compartir (`components/casa/PromoInvitados.tsx`;
  es la polla abierta con programa que cierra primero). No sale a administradores,
  a quien no tiene cupos libres ni en la app de iOS.
- **Llegar invitado.** El enlace deja el código en una cookie y la URL queda
  limpia. La polla y /pagar preguntan «¿Te invitó esta persona?»; se guarda al
  completar el perfil o al enviar el comprobante, y «No es así» lo descarta. Quien
  entra directo escribe el código en «¿Alguien te invitó?» (/casa, /pagar,
  Perfil). Se puede corregir hasta que se apruebe el primer pago.
- **Quién cuenta.** Solo cuentas de acceso creadas desde la migración 135 que
  nunca han pagado; una persona tiene un solo invitador y cuenta una sola vez, en
  su primera polla con invitaciones (si ese pago se rechaza, cuenta en su
  siguiente polla pagada; desmarcarlo solo lo devuelve a revisión). El conteo es
  por polla. Los administradores participan como cualquiera (migración 140); en la
  app de iOS no hay invitaciones.
- **El cupo de regalo.** Aparece solo cuando quien invita tiene su propio cupo
  pagado en esa polla (antes o después). Vale $0: no suma al pozo, compite como
  cualquier cupo y cuenta en el máximo por persona. Si se desmarca el pago de un
  invitado, el último regalo se pausa (con sus pronósticos) y vuelve al aprobarlo.
  El panel de cada polla lista los regalos con «Remover cupo» (con motivo: descuenta
  justo ese regalo) y «Restaurar», hasta el reparto; la cola de pagos muestra
  «Invitado por». En Telegram, «Mis pagos» marca el regalo y no pide comprobante.
- **Alcance.** Pollas de partidos o preguntas con entrada, creadas desde la 135,
  más los borradores que nunca se publicaron; las rifas nunca. El editor lo prende
  también en una polla abierta con inscritos (migraciones 136 y 137, así se activó
  POLLAGOL); apagarlo sigue siendo solo sin inscripciones, y lo que ya se había
  pagado antes de prenderlo no cuenta como invitación.
- **Pruebas.** `scripts/casa-referrals-check.sql` (Supabase local, ROLLBACK),
  `npm test -- tests/casa-referrals.test.ts tests/telegram-player.test.ts` y
  `CASA_ORIGIN=http://localhost:3137 node scripts/casa-referrals-browser-check.mjs`
  con `node scripts/casa-v2-local-env.mjs dev 3137`.

### Casa: carrusel en vivo, reparto al terminar y marcadores demorados (2026-09-17, migración 134)

- **En vivo en /casa como carrusel.** Los partidos de mis pollas se deslizan de
  lado bajo el título «En vivo» (la sección se pliega; empieza abierta). Cada
  tarjeta abre la ficha del partido (`/futbol/partidos/[id]`). Un partido cuya
  hora ya pasó y del que la fuente no reporta nada aparece como «Esperando
  datos». En la polla, «En vivo» también se pliega.
- **Puntos legibles.** En partidos verificados, `+3 pts` en verde y `0 pts` en
  amarillo, en la tarjeta y en «Ver pronósticos de otros».
- **Sin letreros del proveedor.** La ficha del partido y el calendario dejaron de
  mostrar «API-Football · hora» y «Última consulta»; solo avisan si no se pudo
  actualizar.
- **Del último partido al pago.** Cuando la última verificación llega (y no hay
  casos abiertos ni comprobantes de inscripción por revisar),
  `casa_settlement_readiness_v2` marca la polla como lista. `/admin/pollas`
  avisa «N pollas listas para repartir» y la polla muestra «Ganadores
  calculados»: montos por persona (`casa_provisional_payouts_v2`, el mismo
  cálculo y redondeo del reparto real) y la cuenta de pago de cada ganador con
  botón de copiar. «Confirmar ganadores y repartir» cierra las inscripciones si
  su hora ya pasó y registra el reparto; enseguida aparece el pago uno a uno con
  el pantallazo de cada transferencia (prueba de pago de la polla). Mientras
  tanto, el jugador ve «Todos los partidos terminaron» y la Tabla dice «Se lleva
  $…». Regresión local: `scripts/casa-settlement-readiness-check.sql`.
- **Issues más claros.** «Sin datos del proveedor» pasó a «Marcador demorado»; un
  caso cerrado solo dice «Caso cerrado» con el motivo en claro («ya llegaron el
  marcador y el minuto del partido»), y el estado y marcador que se muestran son
  los actuales.
- **Qué pasa si la fuente se atrasa.** El vivo consulta cada minuto el feed del
  día y la verificación reintenta durante 7 días (espaciada cada 15 minutos tras
  5 intentos): cuando API-Football publique el resultado, el partido se cierra y
  puntúa solo. El 17-sep-2026 LDU–Palmeiras y Atlético MG–Santos quedaron en
  «no iniciado» en la fuente horas después de jugarse (comprobado por ID); para
  no esperar, `/admin/issues` permite poner el marcador de los 90 minutos.

### Casa: en vivo, tarjetas compactas y prueba de pago (2026-09-16, migraciones 132–133)

Pedidos del dueño del 16 de septiembre de 2026. Nada de esto toca pollas
abiertas ni pronósticos existentes: las migraciones agregan columnas y
funciones, y solo cambian lo que se crea desde ahora.

- **Solo marcador exacto (132).** Las pollas de marcador nuevas nacen con
  `points_one_team = 0` (DEFAULT de la columna y constante de
  `casa_create_polla_v2`): el marcador exacto suma 3 puntos y cualquier otro
  resultado 0. `casa_score_polla` sigue igual; las pollas creadas antes
  conservan su 1 punto por acertar los goles de un solo equipo y no se
  repuntúan. Info, el editor y el bot describen los puntos reales de cada
  polla. Regresión local: `scripts/casa-exact-score-check.sql`.
- **En vivo en POLLAS.** `/casa` muestra arriba de todo los partidos que se
  están jugando (y los recién terminados, hasta 4 h después del saque) de las
  pollas donde la persona participa, con el parcial y «Tu marcador» por cupo
  (verde si coincide). Datos: `lib/casa/live.ts`; refresco cada 30 s con la
  pestaña visible por `GET /api/casa/en-vivo` (`private, no-store`).
- **Tarjetas de partido compactas.** `components/casa/PicksBoard.tsx` ordena
  con `lib/casa/picks-sections.ts`: **Finalizados** (desplegable cerrado, del
  más reciente al más viejo; abierto solo si no hay nada más), **En vivo** y
  **Próximos** por día (Hoy, Mañana, «mar 22 sep»; abiertos). Cada tarjeta:
  hora o estado + «Ver partido»; escudos y marcador (o casillas de goles) en
  una sola fila; nombres debajo; «Tu marcador: 2-0 · +3 pts» desde el cierre.
  «Ver pronósticos de otros» es un desplegable cerrado con alto fijo y scroll
  propio: al bajar trae la página siguiente sin mover la pantalla, marca la
  fila propia «(tú)» (por los ids de cupo de quien mira, nunca user_id) y
  muestra los puntos de cada uno cuando el partido está verificado. El modo 1X2
  antes del inicio conserva los tres botones; después muestra los porcentajes.
- **Partidos / Tabla / Info arriba de Tus cupos.** La tarjeta de cupos vive
  dentro de la pestaña Partidos, encima de los partidos que controla.
- **Premio provisional en la Tabla (133).** `casa_provisional_prizes_v2`
  reparte en SQL el pozo vigente entre las participaciones empatadas arriba,
  con el mismo redondeo que `casa_settle_polla_v2`; la Tabla muestra «Ganaría
  $…» bajo cada líder y lo refresca con el sondeo de 30 s. Sin filas para
  objetos, pollas resueltas o sin puntos.
- **Prueba de pago a los ganadores (133).** Con la polla resuelta en dinero,
  `/admin/pollas` muestra **Pago a ganadores**: cada premio con la cuenta
  registrada por el ganador (método, número con botón de copiar, titular),
  subida del pantallazo de la transferencia (comprimido en el navegador, un
  request a `POST /api/casa/admin/payouts/[id]/proof`) y referencia opcional.
  `casa_mark_payout_paid_v2` marca `paid_at` y guarda `proof_path` en el bucket
  privado `payout-proofs` bajo `casa/<polla>/<premio>/`; volver a subir
  reemplaza el archivo y conserva la fecha. La polla muestra «Prueba de pago»
  con el reparto («Pozo $X · N ganadores · $Y cada uno», sin «cada uno» si el
  redondeo dejó montos distintos) y «Pagado · fecha» por premio para cualquier
  sesión; la imagen (URL firmada por una hora, bajo un `<details>` cerrado) solo
  llega a administradores, ganadores y participantes de esa polla, porque el
  pantallazo puede traer el número de cuenta del ganador. «Pollas cerradas»
  marca «Premio pagado · comprobante en la polla». El cron
  `cleanup-payout-proofs` solo borra archivos referenciados por `polla_payouts`
  (P2P): estos quedan como historial. `casa_v2_write_guard` permite escribir
  únicamente esas columnas; el importe del premio sigue inmutable.

Verificación local (Docker `supabase_db_la-polla`, nunca producción):

```powershell
Get-Content -Raw -Encoding UTF8 scripts/casa-exact-score-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
Get-Content -Raw -Encoding UTF8 scripts/casa-payout-proofs-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
node scripts/casa-v2-local-env.mjs dev 3191
node scripts/casa-live-payouts-browser-check.mjs
npm.cmd test -- tests/casa-live-status.test.ts tests/casa-picks-sections.test.ts tests/casa-polla-info.test.ts tests/casa-match-picks.test.ts tests/casa-leaderboard.test.ts
```

El recorrido en navegador crea sus fixtures (`e2e-vivo-%`), sube un
comprobante real al storage local y deja las capturas (320/390/768 y texto al
200 %) en `Downloads/la-polla-casa-vivo-shots`. Despliegue: aplicar 132 y 133
antes de publicar el build.

### Varias participaciones por polla (2026-09-15, migración 131)

Una persona puede entrar varias veces a una polla de partidos o preguntas, por
ejemplo cinco veces a una de $20.000: son cinco transferencias de $20.000, cinco
comprobantes y cinco aprobaciones separadas, cada una con sus propios pronósticos.
Solo las participaciones aprobadas suman. Tope por polla configurable (1–50, por
defecto 10). Reglas, SQL y despliegue en [docs/casa-admin-rules.md](docs/casa-admin-rules.md).

```powershell
# Supabase local en Docker; nunca prod
docker exec -i supabase_db_la-polla psql -U postgres -v ON_ERROR_STOP=1 < scripts/casa-multi-entries-check.sql
$env:CASA_ORIGIN="http://localhost:3107"; node scripts/casa-multi-entries-browser-check.mjs
```

### Comprobantes comprimidos en el navegador (2026-09-13)

`components/casa/PagarForm.tsx` prepara la imagen UNA vez al elegirla
(`lib/casa/prepare-proof.ts`) y calcula el SHA-256 sobre lo que sube. El
servidor (`verifyCasaUpload`), el SQL 098 y el bucket no cambian.

- Hasta 300 KB se sube el original sin decodificar. Por encima: JPEG 0,82
  (0,72 si sigue pasando de 300 KB), lado largo 1600 px, lado corto mínimo
  720 px y máximo 4 MP (`lib/casa/proof-image.ts`). Fondo blanco, orientación
  EXIF aplicada y salida sin EXIF ni GPS. Si ahorra menos del 10 % o no hay
  reducción legible, se sube el original. Entrada hasta 20 MB; subida hasta 8 MB.
- Candidatos `[preparado, original válido]`. Ante `UPLOAD_IN_PROGRESS` o
  `REQUEST_CONFLICT` (y `PROOF_IN_REVIEW`/`ALREADY_PAID`, que reconocen un
  intento ya confirmado) `lib/casa/proof-submit.ts` prueba el siguiente: así se
  retoman cargas del cliente anterior o de otro dispositivo, también con la
  inscripción cerrada. sessionStorage guarda `sourceSha256` del original y
  acepta registros viejos con solo `sha256`. Con la inscripción cerrada nunca
  se marca como fallado un intento guardado.
- Foto del premio (`CrearPollaForm`): se reduce a menos de 1 MB antes del
  `FormData`; la función de Vercel corta el cuerpo en 4,5 MB.
- Telegram: si `sendPhoto` falla, el admin recibe el texto con los mismos botones.
- Pruebas: `npm test -- tests/casa-proof-image.test.ts tests/telegram-proof-notify.test.ts`.
  E2E local (Supabase en Docker): `node scripts/casa-v2-local-env.mjs build <puerto>`,
  `... start <puerto>` y `CASA_ORIGIN=http://localhost:<puerto> node scripts/casa-proof-compression-browser-check.mjs`
  (captura 1179×2556, determinismo, recuperación tras cierre, registro anterior,
  EXIF girado, foto del premio y HEIC ilegible).
- Falta validar en dispositivos reales (iPhone Safari con HEIC y EXIF, Android
  de gama media con fotos de 50 MP) y la legibilidad con comprobantes reales.
