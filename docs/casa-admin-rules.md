# Casa: Info, comprobantes, premio fijo y publicación

Implementación del pedido del 13 de septiembre de 2026. Requiere Casa v2 activa
y las migraciones **104, 105, 106 y 107**, además de sus migraciones anteriores.
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

Una suspensión observada después de iniciar anula permanentemente ese partido
**dentro de Casa**, mediante `casa_polla_matches.voided_at`. Reanudar el partido
global no reactiva sus puntos en estas pollas. Un aplazamiento antes de iniciar
no lo anula. El trigger registra solo observaciones nuevas en pollas no
finalizadas; la migración no repuntúa historia ni modifica `predictions`.

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
Objeto**. Un porcentaje mayor a cero selecciona proporcional. Elegir fijo
deja el porcentaje en cero y exige un valor positivo, en pesos enteros.
La casa garantiza ese importe aunque las entradas no lo cubran.

Todos los cálculos permanecen en SQL. Con un premio fijo de $1.000.000, el pozo
es $1.000.000 tanto con 0 como con 100 o 1.000 inscritos. El **balance de la casa**
es lo recaudado menos ese compromiso y puede ser negativo. No se confunde con
un porcentaje de comisión. El desglose proporcional no aparece en el pago de
una polla de premio fijo. Las liquidaciones conservan las reglas de Casa v2.

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

## Ajustes de la migración 107

Corrige hallazgos de revisión sobre 104 y 106. No cambia filas existentes,
`predictions`, partidos globales, pagos ni liquidaciones al instalarse.

- **Abandono después de iniciar.** Además de la suspensión, anulan dentro de Casa
  `STATUS_ABANDONED`/`ABANDONED`/`ABD` y cualquier `status='cancelled'` cuyo detalle
  no sea aplazamiento (`STATUS_POSTPONED`/`POSTPONED`/`PST`), incluido el
  `cancelled` sin detalle de football-data. La evidencia de inicio no cambia:
  cancelar, aplazar o abandonar antes de iniciar nunca anula.
- **El vivo global no depende de Casa.** Con Casa en `paused` el trigger no escribe
  en Casa: guarda el partido y abre `admin_alerts` (`casa_match_void_pending:<match_id>`).
  Si una polla falla al anularse, solo esa polla se revierte y queda en la alerta.
  Con Casa en v2, la siguiente lectura del proveedor anula y resuelve la alerta;
  si ya no llegan lecturas, hay que revisarla antes de liquidar.
- **Balance con pozo fijo.** `prize_cop` conserva el compromiso configurado. Solo
  `house_cop` cambia: borrador/oculta, anulada o `house_retained_zero_points` →
  recaudado; resuelta con premios → recaudado menos lo pagado; el resto (abierta,
  programada, cerrada) → recaudado menos el premio fijo. El pozo proporcional no cambia.
- **Aplazado y reprogramado.** Un partido que quedó `cancelled` sin minutos jugados
  vuelve a admitir pronósticos, con el bloqueo de cinco minutos sobre su nueva hora.
  Espejo en `canEditCasaMatch`.
- **Cerrar una programada antes de publicarse** (web o `/cerrar`) falla con
  `POLLA_NOT_PUBLISHED`; al llegar `opens_at` se cierra normalmente.

Lista de verificación antes de desplegar 107:

1. Aplicar 104, 105, 106 y 107 en orden, antes del build.
2. Confirmar ACL: `pg_proc.proacl` de las cuatro funciones reemplazadas solo con
   `postgres` y `service_role`.
3. Solo en Docker local, nunca contra producción: correr los tres SQL de abajo
   (`casa-publication-prize-check.sql`, `casa-match-rules-check.sql` y
   `casa-v2-check.sql`); los tres terminan en ROLLBACK.
4. Revisar en `/admin` que una alerta `casa_match_void_pending` sea visible.

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
