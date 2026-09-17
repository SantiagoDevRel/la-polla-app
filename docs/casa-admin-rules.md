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

## Invitaciones y cupos de regalo (2026-09-17, migración 135)

**Reglas del dueño:** por cada `referral_every` (5) personas nuevas que alguien
invita y que pagan una polla, esa persona recibe un cupo gratis en la misma polla,
automáticamente. Solo cuentan usuarios nuevos; cada invitado cuenta una vez, en su
primera polla; el conteo se renueva en cada polla. El regalo no suma al pozo.

- **Tablas** (RLS con deny-all; service_role solo `SELECT`): `casa_referral_settings`
  (`accounts_since`), `casa_referral_codes` (código único por persona),
  `casa_referrals` (PK = invitado → un solo invitador; `locked_at` en el primer
  pago aprobado; `counted_polla_id` = la polla donde cuenta),
  `casa_referral_events` (historial; también el permiso para escribir un regalo) y
  `casa_referral_gift_removals`. Columnas: `casa_entries.origin`
  (`compra` | `invitacion`, inmutable) y `casa_pollas.referral_every`
  (DEFAULT 5 para filas nuevas; la migración también lo pone en los borradores
  nunca publicados y sin inscripciones; NULL = sin programa).
- **Persona nueva** (`casa_referral_is_new_user`): cuenta de acceso
  (`auth.users.created_at`, que nadie edita desde la app; `public.users.created_at`
  sí lo puede reescribir su dueño) desde `accounts_since`, sin cupos comprados
  aprobados con monto y sin correcciones de pagos con monto. Una entrada gratis no
  cuenta como pago, ni aprobada ni corregida.
- **Administradores** (`casa_referral_can_refer`): no tienen código
  (`REFERRAL_NOT_AVAILABLE`), un código suyo anterior no vincula ni se sugiere y
  el conteo les da cero regalos.
- **Vincular** (`casa_set_referrer_v1(usuario, código, via)`): código normalizado;
  errores como resultado (`REFERRAL_CODE_NOT_FOUND`, `SELF_REFERRAL`,
  `REFERRAL_EXISTS` para un enlace sobre un invitador ya guardado,
  `REFERRAL_LOCKED`, `NOT_NEW_USER`, `REFERRAL_RATE_LIMITED` tras 10 códigos
  inválidos en una hora). Bloqueo por persona (advisory). Primero responde los
  rechazos sin bloquear nada; después toma `FOR SHARE` sobre sus cupos comprados
  (no sobre los regalos) y repite las mismas preguntas: una aprobación simultánea
  termina primero y fija el vínculo.
- **Ancla** (`counted_polla_id`): la fija el primer pago con monto aprobado en una
  polla con programa. Desmarcar ese pago no la mueve: vuelve a revisión y, mientras
  no esté aprobado, el invitado no cuenta. Si se rechaza (o se anula), el ancla pasa
  a otro cupo pagado de esa polla; si no hay, a su primer cupo pagado en otra polla
  con programa, y esa polla se recuenta en la misma transacción; si tampoco, se
  libera y cuenta en la próxima polla donde se le apruebe un pago. El vínculo sigue
  fijo. Recontar la otra polla también la bloquea: dos rechazos cruzados simultáneos
  pueden abortar uno (se reintenta).
- **Conteo** (`casa_referral_sync`, disparado por cada cambio de estado o monto de un
  cupo comprado y por cambios de `max_entries_per_user`): invitados anclados en la
  polla con un cupo comprado aprobado ahí; `ganados = contados / cada` solo si el
  invitador tiene su propio cupo pagado (y no es administrador). Los regalos van en
  fila por `entry_number`: el k-ésimo está activo si k ≤ ganados, no está removido y
  cabe en el tope; los que pasan de lo ganado se pausan (`anulada`); los ganados sin
  fila se crean dentro del tope por persona y del número 50. Un removido conserva su
  puesto: descuenta justo ese regalo y, si el conteo baja, es el primero en dejar de
  estar ganado. Cada escritura lleva un evento propio (`regalo_otorgado`,
  `regalo_pausado`, `regalo_reactivado`). La vista de la polla devuelve `gifts`
  (ganados sin removidos) y `waiting_gifts` (ganados sin activar).
- **Guardas.** `casa_02_referral_guard` exige ese evento para insertar o cambiar un
  regalo (solo estado, fecha y motivo) y prohíbe cambiar `origin`;
  `casa_v2_write_guard` (parche needle sobre la definición viva, como 105/133) deja
  pasar un regalo pagado solo con su evento. `casa_begin_entry_proof_v3` rechaza el
  número de un regalo (`GIFT_ENTRY`) y nunca reusa uno como carga fallida;
  `casa_begin_entry_proof_v2` elige solo cupos comprados; `casa_my_entry_v2` prefiere
  un cupo comprado y nunca devuelve un regalo en pausa.
- **Dinero.** El pozo suma `amount_cop` (0 en regalos). Tabla, premio provisional y
  reparto tratan el regalo como cualquier participación pagada.
- **Administración.** `/admin/pollas` → «Cupos de regalo por invitar»
  (`casa_referral_gifts_admin_v1`): estado, invitados que cuentan (con sus nombres),
  «Remover cupo» (motivo obligatorio; anula ese regalo, no vuelve solo y ninguno lo
  reemplaza) y «Restaurar» (vuelve si sigue ganado y cabe). Ninguno de los dos
  después del reparto (`POLLA_FINAL`/`ALREADY_SETTLED`, la misma regla de desmarcar
  un pago). La cola de pagos muestra «Invitado por».
  El editor prende el programa aunque la polla ya tenga inscritos, mientras no haya
  terminado (migración 136: así se activó POLLAGOL el 17-sep); apagarlo exige cero
  inscripciones (`casa_set_referral_every_v1`; rifas nunca). Prenderlo no es
  retroactivo: quien ya pagó no es persona nueva y nadie gana regalos por
  inscripciones anteriores.
- **Avisos.** Tras una aprobación, `casa_referral_claim_gift_notices_v1` reclama los
  regalos nuevos y el bot de jugadores avisa por Telegram con un botón al cupo en la
  web. En «Mis pagos» del bot, un regalo activo sale como regalo y uno en pausa o
  removido no sale (no se pide comprobante por un regalo).
- **Aviso al entrar.** «Por 5 invitados, te damos un cupo en la POLLAGOL»: la polla
  abierta con programa que cierra primero, cuando la persona tiene código y cupos
  libres (`referralPromo`). Una vez por persona y polla.
- **Límites conocidos.** Si un invitado borra su cuenta, su vínculo desaparece con
  ella, pero el regalo ya creado no se recalcula hasta el siguiente cambio de pago de
  ese invitador en la polla. El bot de jugadores todavía no captura códigos ni
  pronostica con el cupo de regalo (segundo PR).
  Si el tope llega al número 50 (muchos regalos removidos), no se crean más regalos
  sin aviso. Un aviso de regalo por Telegram se da por enviado al reclamarlo: si el
  cupo se pausa antes de enviarse, ese mensaje no sale (el cupo sí aparece en la web).
  El aviso sale para la polla abierta con programa que cierra primero: si hay dos
  abiertas con invitaciones, el inicio de Casa anuncia solo esa. «N inscritos» cuenta cupos, también los de regalo; el dinero sale solo
  de `amount_cop`.
- **Despliegue.** 135 antes del código y en una sola transacción; verificación
  read-only al final de la migración. Regresión: `scripts/casa-referrals-check.sql`.

## Solo marcador exacto, premio provisional y prueba de pago (2026-09-16, migraciones 132–133)

- **Puntaje de las pollas nuevas.** Desde la migración 132 una polla de
  marcador nace con `points_one_team = 0`: solo el marcador exacto suma
  (`points_exact`, 3). Las creadas antes conservan 1 punto por acertar los
  goles de un solo equipo; no se repuntúan. La regla de cada polla se lee de
  sus columnas (Info web, editor y bot): no se describe con texto fijo.
- **Premio provisional.** `casa_provisional_prizes_v2(polla)` devuelve, por
  participación empatada arriba, lo que se llevaría si la polla terminara
  ahora: pozo vigente de `casa_pot_summaries_v2` dividido por participaciones
  ganadoras, sobrante de a un peso en orden `(user_id, entry_number)`, igual que
  `casa_settle_polla_v2`. Solo pozo en dinero, solo `abierta`/`cerrada`, solo si
  el máximo es mayor a 0. Tabla web: «Ganaría $…».
- **Pago a ganadores.** Con la polla `resuelta` y `money_awarded`, el panel
  muestra cada premio con la cuenta del ganador (`users.default_payout_*`, solo
  para administradores) y el formulario del comprobante. `casa_mark_payout_paid_v2`
  (admin + contrato v2) exige una ruta `casa/<polla>/<premio>/…`, marca
  `paid_at` (una sola vez), `paid_by`, `proof_path`, `proof_uploaded_at` y
  `paid_reference` (≤ 200), y devuelve el avance `paid_count/total_count` y el
  comprobante anterior para borrarlo. Rechaza rutas ajenas
  (`INVALID_PROOF_PATH`), pollas archivadas o no resueltas (`PAYOUT_NOT_PAYABLE`)
  y premios en objeto (`PAYOUT_NOT_FOUND`). El guard de `casa_payouts` sigue
  impidiendo cualquier otro cambio (`AWARD_IMMUTABLE`).
- **Quién ve el comprobante.** El hecho («Pagado · fecha», referencia y el
  avance «N de M pagados») lo ve cualquier persona con sesión que abre la
  polla, igual que los nombres y montos de los ganadores. La **imagen** se
  firma (URL de una hora, nunca pública) solo para administradores, ganadores
  y quienes participaron en esa polla: el pantallazo de Nequi/Bancolombia
  suele traer el número de cuenta del ganador. El panel recuerda recortarlo
  antes de subirlo. (Revisión de muse, 2026-09-16.)
- **Regresión local:** `scripts/casa-exact-score-check.sql`,
  `scripts/casa-payout-proofs-check.sql` (ROLLBACK) y
  `scripts/casa-live-payouts-browser-check.mjs` (navegador, con dev server local).

## Listas para repartir (2026-09-17, migración 134)

- `casa_settlement_readiness_v2(ids)` (solo lectura): por polla de pozo en
  dinero de partidos o preguntas, `total_items`/`done_items` (partidos no anulados
  verificados o preguntas resueltas), `open_issues`, `pending_proofs` (mismo
  criterio que `PENDING_PROOFS`, incluidas cargas en curso), `paid_entries`,
  `inscriptions_closed` (cerrada o `closes_at` vencido) y `ready`. Excluye rifas,
  objetos, desempates, resueltas y archivadas. El barrido de casos
  (`casa_sweep_match_issues`) no corre acá porque escribe; lo hace el reparto.
- `casa_provisional_payouts_v2(polla)`: lo que haría el reparto por persona
  (suma de sus participaciones ganadoras) con el redondeo de la 131/133.
- El panel confirma el reparto: si la polla sigue `abierta` con el cierre
  vencido, el cliente llama primero `cerrar` (si otro admin ya la cerró, SQL
  responde `INVALID_TRANSITION` y se sigue) y luego `repartir`. La ruta
  `repartir` hace una sola llamada a SQL. Regresión:
  `scripts/casa-settlement-readiness-check.sql`.

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
