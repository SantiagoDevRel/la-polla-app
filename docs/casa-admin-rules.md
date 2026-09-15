# Casa: Info, comprobantes, premio fijo y publicación

Implementación del pedido del 13 de septiembre de 2026. Requiere Casa v2 activa
y las migraciones **104, 105, 106, 107, 108, 109 y 131**, además de sus migraciones anteriores.
El calendario de proveedores y sus torneos se mantiene en un carril independiente.

## Info y pronósticos

Cada polla incluye **Info** junto a Partidos/Preguntas/Boletas y Tabla. Describe
solo su modo y sus puntos configurados. Un marcador exacto y el acierto de los
goles de un solo equipo son casos excluyentes. Para ganar por puntos se requiere
al menos un punto; el mayor puntaje gana. Un empate en dinero divide todo el pozo,
incluidos los pesos de redondeo. Los objetos mantienen su desempate documentado.

**¿Cómo me pagan?** abre un diálogo que reutiliza el editor de la cuenta personal
y `/api/users/me`, con Nequi y Bancolombia. Solo el dueño consulta/edita su cuenta;
los pronósticos de otros nunca incluyen sus datos bancarios.

El cierre de inscripciones no cierra los pronósticos de partidos futuros de
quienes ya están inscritos. Cada partido bloquea a cinco minutos del inicio,
tanto en UI/API como en SQL. El marcador para puntuar es el verificado de los
90 minutos y su adición; no incluye alargue ni penales.

Los pronósticos de otros y sus porcentajes permanecen privados hasta que la
fuente confirme inicio (`live` o `finished`), incluso si pasó el horario y el
partido está retrasado. La lista es paginada, autenticada y disponible solo
para inscritos o administradores. Las respuestas usan `private, no-store`.

**Partidos con novedades (migración 108): nada se anula solo.** Si un partido de
una polla Casa no finalizada queda suspendido/interrumpido, aplazado, cancelado o
abandonado (antes o después de iniciar), el trigger de `matches` abre un caso en
`casa_match_issues` cuando el partido **entra** en ese estado. Hay a lo sumo un caso
abierto por partido y tipo (índice único parcial); las lecturas repetidas sin
transición solo refrescan el caso abierto.
El administrador decide en `/admin/issues` con `casa_decide_match_issue`:
**Anular** marca `voided_at` y deja 0 puntos en las pollas no finalizadas que lo
contienen (liquidadas, archivadas o con desempate se saltan); **Mantener** solo lo
registra y el partido se juega y verifica normal. `casa_settle_polla_v2` falla con
`OPEN_MATCH_ISSUES` mientras haya casos sin decidir. El vivo global nunca falla por
Casa, en ningún modo; la migración no repuntúa historia ni modifica `predictions`.

- **Reapertura.** Un partido mantenido que se reanuda y vuelve a suspenderse (o
  entra en otro estado con novedades) abre un caso **nuevo**; el decidido queda
  como historial. Un partido con una decisión **Anular** ya no abre casos nuevos.
  Al vincular un partido a una polla se abre caso solo si ese tipo nunca se decidió.
- **Registros perdidos.** El trigger traga cualquier error (incluido `lock_timeout`)
  para no bloquear el vivo. `casa_sweep_match_issues()` (solo `service_role`)
  recupera esos casos: partidos sin verificar de pollas activas cuyo estado actual
  es un problema, sin caso abierto ni decisión previa de ese tipo y sin anulación.
  Corre como backfill de la migración, al inicio de cada reparto (si el reparto
  falla, los casos que abrió se deshacen con él) y al cargar `/admin/issues`, donde
  sí quedan guardados.
- **Conteo.** El aviso de `/admin/pollas` cuenta solo casos abiertos con al menos
  una polla Casa activa (`casa_active_open_match_issue_ids`). En `/admin/issues`
  los abiertos que ya no afectan pollas activas van al final, en «Sin pollas
  activas»: no bloquean repartos y se pueden decidir igual.

- **Sin datos del proveedor (2026-09-14, migración 121).** Un partido sin verificar
  de una polla activa que sigue esperando su inicio 30 minutos después de la hora
  confirmada (30 horas si es provisional) abre un caso `sin_datos`. Se cierra solo
  con `decision='resuelto'` cuando llegan datos, se verifica o el inicio vuelve al
  futuro. Además de anular o mantener, el administrador puede poner el resultado de
  los 90 minutos (`casa_resolve_sin_datos_with_result`). El barrido corre también
  cada minuto desde `/api/matches/sync-live`, que envía un correo por caso nuevo.

## Comprobantes

- `/admin/pollas/recibos`: únicamente pendientes, de más reciente a más antiguo
  por fecha del comprobante e ID estable; desaparecen al aprobar.
- `/admin/pollas/pagos`: aprobados, incluidos los históricos, con el comprobante
  y fechas de recepción/aprobación en Colombia.
- `?pollaId=<uuid>` filtra cualquiera de las listas a una polla.
- **Desmarcar como pagado** requiere confirmar y escribir el motivo. Conserva el
  comprobante y una auditoría de la aprobación original; devuelve la entrada a
  pendientes y deja de contarla como pagada.
- La revisión versionada rechaza clics antiguos y mensajes previos de Telegram.
  Después de corregir un pago, se vuelve a revisar desde la web. Liquidación,
  archivo y desempate congelan las correcciones. La corrección no borra picks.

## Premios

Se conserva `prize_kind=pozo|objeto`; el dinero agrega `pot_mode=proporcional|fijo`
y `fixed_prize_cop`. No se cambia el tipo de los premios históricos.

En creación: entrada, porcentaje de la casa y **Pozo fijo / Pozo proporcional /
Objeto**. Son elecciones independientes: cambiar el porcentaje no cambia el tipo
de premio, y elegir fijo no cambia el porcentaje (0 a 100). Solo **Objeto** fija
el porcentaje en 100. El pozo fijo exige un valor positivo, en pesos enteros
(«Premio garantizado (COP)»).

**Pozo fijo = premio mínimo garantizado que crece pasado el doble (migraciones
109 y 125).** Regla del dueño del 2026-09-15: primero se recoge el premio, luego
otro tanto igual para la casa, y solo entonces el pozo empieza a subir. Con
G = recaudado pagado, F = premio garantizado y c = porcentaje de la casa:

- G ≤ F: premio = F; balance de la casa = G − F (cero o negativo: la casa pone la diferencia).
- F < G ≤ 2F: premio = F; la casa recibe todo lo que entra (balance = G − F, hasta F).
- G > 2F: E = G − 2F. El pozo recibe `floor(E × (100 − c) / 100)`, el mismo redondeo
  del pozo proporcional; la casa se queda el resto de E.
  Premio = F + esa parte; balance = G − premio.

Ejemplo del dueño, OFIGOLAZO (entrada $20.000, F = $1.000.000, c = 50 %): 50
personas cubren el premio, las siguientes 50 son de la casa y desde la persona
101 el pozo sube $10.000 por inscripción.

Ejemplos con entrada de $10.000 y F = $1.000.000 (verificados en
`scripts/casa-publication-prize-check.sql`):

| c | Inscritos | Premio | Balance de la casa |
|---|---|---|---|
| 50 % | 0 | $1.000.000 | −$1.000.000 |
| 50 % | 100 | $1.000.000 | $0 |
| 50 % | 150 | $1.000.000 | $500.000 |
| 50 % | 200 | $1.000.000 | $1.000.000 |
| 50 % | 201 | $1.005.000 | $1.005.000 |
| 50 % | 202 | $1.010.000 | $1.010.000 |
| 50 % | 300 | $1.500.000 | $1.500.000 |
| 0 % | 250 | $1.500.000 | $1.000.000 |
| 100 % | 250 | $1.000.000 | $1.500.000 |

Todos los cálculos permanecen en SQL: `casa_money_prize_cop` es la única fórmula
del premio en dinero (proporcional y fijo) y la usan `casa_pot_summaries_v2`
(pozo, balance, pozo si entras; de ahí `casa_polla_pot`, `casa_payment_details_v2`,
`casa_house_total_v2` y la liquidación) y el preview
`casa_fixed_prize_threshold_preview_v2`. El preview del formulario devuelve el
premio para N inscritos, los inscritos que cubren el mínimo (`entries_to_cover`,
`ceil(F / entrada)`), las entradas que todavía no hacen crecer el pozo
(`entries_to_grow`, `floor(2F / entrada)` desde la migración 126; ambos nulos con
entrada gratis) y cuánto va al pozo y a la casa por cada entrada por encima del
doble. Casa, pagar e Info (web y bot de Telegram) dicen «Si más de
`entries_to_grow` personas se inscriben…», o «El pozo crece … por cada persona
que se inscribe» cuando vale 0. Con 2F no múltiplo de la entrada, la primera
entrada que crece suma solo la parte que pasa el doble (entrada $30.000, F
$1.000.000, 50 %: la 67 suma $5.000; desde la 68, $15.000). El preview de tres argumentos de 104 sigue disponible y
equivale al nuevo con 0 % de casa.

El **balance de la casa** no se confunde con un porcentaje de comisión. Una polla
oculta, o programada cuyo `opens_at` todavía no llega, no resta el premio
(balance = recaudado) hasta publicarse; el resto de los casos de 107 se conserva.
En la pantalla de pago, una polla de pozo fijo muestra el pozo actual, el mínimo
garantizado, el porcentaje de cada nueva entrada que suma al pozo y el pozo si
entras. Info y el encabezado de la polla muestran «Mínimo garantizado». Las
liquidaciones conservan las reglas de Casa v2 y pagan el `prize_cop` vigente.

## Publicación y fechas

`publication_mode=ahora|programada|oculta` y el timestamp existente `opens_at`
separan publicación y cierre. Una programada usa estado `abierta`, pero los
lectores y las reservas de inscripción exigen que llegue `opens_at`. No necesita
cron, scheduler ni proveedor pago. Se vuelve visible en el siguiente request
desde esa hora. Las ocultas son borradores administrables; el panel permite
publicar ahora, programar o cambiar la fecha mientras no existan inscripciones.

El servidor exige publicación futura y anterior al cierre. Las políticas RLS
también protegen pollas, preguntas, opciones y relaciones de partidos: conocer
un UUID no permite leer contenido antes de tiempo por la Data API.

`lib/time/colombia.ts` centraliza **America/Bogota**. El calendario separa fecha
y hora para que quepa en móvil; convierte esa hora a UTC al enviarla. Todos los
instantes visibles y las agrupaciones de días usan Colombia, incluso en un
dispositivo configurado en Europa. Las fechas civiles sin hora y las ventanas
de cuota del proveedor conservan su significado; no se desplazan artificialmente.

## Varias participaciones por persona (migración 131)

**Regla del dueño:** entrar varias veces a una polla es posible, pero cada
participación exige su propia transferencia por el valor de la entrada y su propio
comprobante. No existe «un pago de $100.000 por cinco cupos».

- **Tope.** `casa_pollas.max_entries_per_user` (1–50, por defecto 10; las pollas
  existentes quedaron en 10). Se define al crear y se cambia en el editor aunque
  haya inscripciones (`casa_set_max_entries_v2`): bajarlo no elimina nada, solo
  impide nuevas. Cuentan pagadas, en revisión y rechazadas (una rechazada se
  reintenta en su misma fila); una carga fallida (`anulada`) no cuenta y su número
  se reutiliza. Las rifas no usan este tope: cada boleta ya es una inscripción.
- **Numeración.** `casa_entries.entry_number` 1, 2, 3… por persona y polla
  (índice único parcial; las inscripciones anteriores quedaron como 1).
- **Comprobante.** `casa_begin_entry_proof_v3(…, p_entry_number, …)`: número =
  completar o reintentar esa participación; `NULL` = una nueva. Rechaza
  `MAX_ENTRIES`, `ENTRY_NOT_FOUND` y `DUPLICATE_PROOF` (el mismo archivo ya respalda
  otra participación viva de esa persona; es una defensa por bytes, el admin
  sigue revisando cada imagen). `casa_begin_entry_proof_v2` conserva firma y
  comportamiento de una sola inscripción para el bot y clientes viejos.
- **Revisión.** La cola de `/admin/pollas/recibos`, el historial por usuario y
  Telegram muestran «Participación #N» (web: si la persona tiene más de una;
  Telegram: desde la #2). Cada
  aprobación, rechazo o corrección aplica a un comprobante (sin cambios en 105).
- **Pronósticos.** Cada participación guarda los suyos (`casa_picks.entry_id`) y
  puede llenarlos desde que su comprobante está en revisión. `PUT /picks` acepta
  `entryNumber`; sin él usa la participación principal (bot).
- **Tabla y reparto.** `casa_leaderboard` devuelve una fila por participación
  aprobada con `entry_number` y `user_entries`. `casa_settle_polla_v2` divide el pozo
  por participación ganadora (redondeo de a un peso por participación, en orden
  estable) y registra un pago por persona con la suma («· 2 participaciones
  ganadoras» en la nota). Premio en objeto: si todas las participaciones empatadas
  arriba son de la misma persona, gana sin sorteo; si hay varias personas, el
  sorteo tiene una boleta por persona.
- **Pantallas.** `/casa/<slug>?p=N` con «Tus participaciones» (estado de cada una
  y «Sumar otra participación»); `/casa/<slug>/pagar?participacion=nueva` avisa
  «Otra participación, otra transferencia». Mis pollas: una tarjeta por
  participación con enlace directo.
- **Despliegue.** Aplicar 131 antes de publicar el código. La migración no toca
  `predictions`, pronósticos, pagos ni resultados; solo numera y agrega funciones.

## Ajustes de la migración 107

Corrige hallazgos de revisión sobre 104 y 106. No cambia filas existentes,
`predictions`, partidos globales, pagos ni liquidaciones al instalarse.

- **Abandono y alerta de anulación: reemplazados por la 108.** La anulación
  automática y la alerta `casa_match_void_pending` ya no existen; esos estados
  abren un caso en Issues (ver «Partidos con novedades»).
- **Balance con pozo fijo.** `prize_cop` conserva el compromiso configurado. Solo
  `house_cop` cambia: borrador/oculta, anulada o `house_retained_zero_points` →
  recaudado; resuelta con premios → recaudado menos lo pagado; el resto (abierta,
  programada, cerrada) → recaudado menos el premio fijo. El pozo proporcional no cambia.
  *(Actualizado por 109: el premio fijo es un mínimo que crece con el excedente y
  una programada todavía no publicada tampoco resta el premio. Ver «Premios».)*
- **Aplazado y reprogramado.** Un partido que quedó `cancelled` sin minutos jugados
  vuelve a admitir pronósticos, con el bloqueo de cinco minutos sobre su nueva hora.
  Espejo en `canEditCasaMatch`.
- **Cerrar una programada antes de publicarse** (web o `/cerrar`) falla con
  `POLLA_NOT_PUBLISHED`; al llegar `opens_at` se cierra normalmente.

Lista de verificación antes de desplegar 107:

1. Aplicar 104, 105, 106, 107, 108 y 109 en orden, antes del build.
2. Confirmar ACL: `pg_proc.proacl` de las cuatro funciones reemplazadas solo con
   `postgres` y `service_role`.
3. Solo en Docker local, nunca contra producción: correr los tres SQL de abajo
   (`casa-publication-prize-check.sql`, `casa-match-rules-check.sql` y
   `casa-v2-check.sql`); los tres terminan en ROLLBACK.
4. Con la 108 aplicada, revisar en `/admin/issues` que un caso abierto sea visible
   y que decidirlo funcione.

## Verificación local

Solo Docker `supabase_db_la-polla`; no usar estos fixtures contra producción.
Los runners de navegador crean cuentas/comprobantes locales nuevos; SQL usa
ROLLBACK salvo las pruebas de carreras, cuyos fixtures locales quedan inspeccionables.

```powershell
Get-Content -Raw -Encoding UTF8 scripts/casa-publication-prize-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
Get-Content -Raw -Encoding UTF8 scripts/casa-match-rules-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
Get-Content -Raw -Encoding UTF8 scripts/casa-v2-check.sql | docker exec -i supabase_db_la-polla psql -X -U postgres -d postgres
node scripts/casa-payment-corrections-check.mjs
npm.cmd test
node scripts/casa-v2-local-env.mjs dev 3191
node scripts/casa-admin-features-browser-check.mjs
node scripts/casa-info-browser-check.mjs
node scripts/casa-v2-local-env.mjs build 3191
```

El puerto local es opcional (default 3101). Cada puerto usa su propia carpeta
`.next-casa-local-<puerto>` para permitir revisiones simultáneas sin tocar el
servidor habitual. Capturas y métricas se guardan en Downloads.

Antes de desplegar, confirmar proyecto y modo v2, exportar/verificar el backup,
aplicar las tres migraciones antes de publicar el build, y verificar las rutas
con datos reales solo en lectura. Estas migraciones no activan Casa v2 ni el
procedimiento de sorteo de objetos: respetan el estado operativo existente.

## Historial de comprobantes por usuario (2026-09-13)

En `/admin`, cada resultado de **Buscar un usuario** abre `/admin/usuarios/[id]`:
conteos (enviados, aprobados, rechazados, sin decisión) y los comprobantes de
todas sus pollas, del más reciente al más antiguo, con el pantallazo firmado por
una hora. Fuente: `casa_entry_proof_attempts` con `state='confirmed'` (incluye
rechazados y reemplazados). Solo lectura: aprobar/rechazar sigue en la cola de
pagos y en el bot. Inicio del historial en `USER_RECEIPT_HISTORY_START`
(`lib/casa/user-receipts.ts`, 13-sep-2026 hora Colombia). Autorización: layout,
página y `GET /api/admin/users/[id]/receipts` validan sesión + `users.is_admin`
antes de leer; respuesta `private, no-store`.
