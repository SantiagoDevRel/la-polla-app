# Casa v2: premios, comprobantes y despliegue

## Contrato del producto

`kind` determina la competencia y `prize_kind` determina el premio. Los objetos
requieren comprobante y aprobación igual que el pozo; solo las inscripciones
pagadas participan en la adjudicación. Los puntos siguen el sistema existente.

El puntaje positivo más alto recibe el pozo completo; los empates comparten el
importe y sus pesos de redondeo. Un objeto se adjudica con `amount_cop=0`, sin
dinero adicional. El empate por objeto abre una lista fija de candidatos y luego
se registra un sorteo externo documentado. Adjudicación y entrega son eventos
distintos. Todos en cero termina como `house_retained_zero_points`, sin payouts.
No pagadas y boleta sorteada sin pago son errores distintos que no adjudican.

El procedimiento de evidencia sigue pendiente de aceptación operativa del dueño.
`object_draws_enabled=false` impide confirmarlo y publicar nuevas pollas por puntos
con premio en objeto hasta entonces. Se pueden guardar borradores; las rifas de
objeto usan el sorteo anunciado y no dependen de este desempate por puntos.
La grabación debe mostrar lista, método con posibilidades iguales y ganador;
la aplicación comprueba pertenencia, integridad del archivo y trazabilidad,
pero no certifica que el sorteo externo sea imparcial.

## Esquema y límites

Migraciones 097–102: intentos de comprobante, candidatos, intentos de evidencia,
metadatos de adjudicación/entrega, RPC v2 y barrera de despliegue. No se tocan
las tablas históricas `predictions`, `pollas` ni sus resultados.

Las tablas nuevas tienen RLS que deniega acceso directo y permisos únicamente
de servidor. Cada endpoint valida la sesión y su audiencia antes de usar el
cliente administrativo. Los comprobantes quedan en el bucket privado existente;
videos en `casa-draw-evidence` (privado, máximo 50 MiB, MP4/MOV/WEBM). Los enlaces
de evidencia duran cinco minutos y solo se entregan al administrador o a
participantes con pago confirmado. No se muestran comprobantes a participantes.

La carga va directamente a Storage; el servidor verifica ruta, bytes, SHA-256
y firma de tipo antes de confirmar SQL. Las rutas no se sobrescriben. Un fallo
de confirmación permite recuperar el archivo existente. Una carga de evidencia
inválida genera otra ruta bajo el mismo request y ganador; el intento anterior
queda enlazado mediante `superseded_by`, sin borrarlo. Los videos no usados
también consumen almacenamiento: revisar la cuota antes de habilitar el flujo.

Una boleta fallida sigue reservada para su dueño y se recupera en la misma fila.
Nunca se pone `ticket_number=NULL`. Los intentos de comprobante vencen a los
15 minutos, evaluados perezosamente por SQL después de tomar los locks; un
comprobante confirmado sigue esperando revisión sin caducar. No hay cron nuevo.
Cada usuario debe completar y obtener aprobación de su boleta antes de reservar
otro número; sus boletas históricas siguen recuperables. Esto evita reservar una
rifa completa sin pagos. El mismo archivo se recupera por dueño y metadatos aun
sin `sessionStorage`. Si la polla cierra después de iniciar la carga, se conserva
el plazo original para confirmarla; no permite crear otra inscripción tras el cierre.
Las rutas de recuperación consultan el reloj SQL. Web y bot avisan al jugador
solamente al registrar una decisión nueva; un reintento no repite el aviso.
`ok2:<attempt_uuid>` / `no2:<attempt_uuid>` identifican el comprobante exacto en
Telegram (40 bytes); botones antiguos se rechazan. `q2:<option_uuid>` resuelve
preguntas sin identificadores truncados.

Dinero, conteos y proyecciones se calculan en SQL, incluidos listados y formulario
de creación. El importe del objeto no es una ganancia neta: no se descuenta un
costo del objeto inventado.

## Pruebas locales

Requieren el Supabase local existente `supabase_db_la-polla`. Estos comandos no
aceptan una URL remota ni leen credenciales de producción:

```powershell
node scripts/casa-v2-check.mjs
node scripts/casa-v2-local-env.mjs dev
node scripts/casa-v2-browser-check.mjs
node scripts/casa-v2-local-env.mjs build
npm.cmd run lint
npm.cmd test -- tests/casa-lifecycle.test.ts tests/casa-admin-entries.test.ts tests/casa-create-multi-tournament.test.ts tests/casa-leaderboard.test.ts tests/casa-my-pollas.test.ts
```

El servidor aislado usa 3101. La prueba SQL revierte sus fixtures; las carreras
y el navegador conservan solo sus datos locales nuevos para inspección. El
navegador usa cuentas locales, videos marcados como prueba y contextos aislados.
Las credenciales de mensajería/proveedores se vacían en el servidor local.
Capturas en Downloads: 320/768/1440 y texto 200%; no se guardan sesiones en Git.
La suite de carreras incluye un llamador viejo entre lectura y primera escritura
y otro que ya escribió: el primero falla sin efectos tras la pausa; el segundo
termina antes de que la transición avance. El reinicio directo a `legacy` usado
para preparar esos fixtures es exclusivo de Docker, nunca un procedimiento de prod.

## Despliegue por fases

1. Verificar proyecto, esquema instalado y pollas vivas; sacar y verificar backup
   de tablas, archivos y funciones actuales. No asumir que una observación vieja
   sigue vigente. Confirmar espacio disponible para evidencia.
2. Aplicar 097–102 en orden, cada una en transacción, registradas como migraciones.
   El modo inicial es `legacy`: instala estructuras y guards sin activar v2.
   Los cambios de scoring conservan su fórmula; no recalculan datos al migrar.
3. Pasar `legacy → paused` con `scripts/casa-v2-transition.sql`. El lock exclusivo
   espera a los escritores existentes con lock compartido. Límite de lock 3 s,
   sentencia 15 s, máximo tres intentos. No matar sesiones ni esperar indefinidamente.
4. Publicar el mismo build de web y webhook de Telegram, verificar readiness y
   cabecera de contrato. Durante `paused`, inscripciones, aprobaciones y demás
   mutaciones protegidas se rechazan. **Es una interrupción real si hay pollas
   recibiendo pagos**: completar este despliegue antes de abrir la primera.
5. Verificar rutas nuevas, permisos y consumidores; pasar `paused → v2` con la
   misma transición acotada. El RPC viejo conserva su firma y rechaza ANTES de
   puntuar/escribir; nunca traduce llamadas antiguas a adjudicaciones nuevas.
6. Verificar producción sin inscripciones, pagos ni ganadores ficticios. Revisar
   asesores de seguridad, endpoints y exposición de secretos. Mantener evidencia
   deshabilitada hasta aceptación operativa; esa limitación se comunica al dueño.

Ante fallo de despliegue, conservar `paused` y corregir el build. Antes de usar v2
puede volver a `legacy` si no existen nuevos outcomes/desempates; después de usarse,
solo avance correctivo manteniendo auditoría. No revertir a código que ignore objetos
ni borrar tablas, archivos o adjudicaciones. Archivar conserva registros y no liquida.

## Criterio de salida

Pruebas ejecutadas y auditorías de Claude/Grok sobre la implementación, hallazgos
resueltos o límites explícitos, backup verificado, migraciones y build desplegados,
modo y rutas comprobados en producción. Una review favorable no prueba ausencia
de bugs ni equivale a una certificación legal del producto.
