# Campañas SMS del administrador

`/admin/sms` permite preparar, revisar y enviar o programar campañas con LabsMobile,
el proveedor ya contratado. El enlace «Campañas SMS» aparece en `/admin` únicamente
para la cuenta autorizada. No se agregan proveedores ni dependencias.

## Acceso

`SMS_CAMPAIGN_OWNER_ID` es una variable privada del servidor: UUID de la cuenta
verificada de Santiago. La sesión real debe corresponder a ese UUID **y** conservar
`users.is_admin=true`. Se valida antes de leer el directorio, guardar revisiones,
registrar bajas o enviar. No sirven un nombre, un teléfono enviado por el cliente,
otra cuenta administradora ni `CRON_SECRET`. Sin la variable, acceso cerrado.

Producción: identidad contrastada con `auth.users.phone` y
`public.users.whatsapp_number`, coincidentes con el celular autorizado por el dueño.
No publicar ese teléfono ni las credenciales del proveedor en el repositorio.

## Recorrido

1. Elegir una polla abierta y publicada. Se insertan su nombre, entrada, premio
   (mínimo garantizado, pozo actual u objeto, según corresponda) y enlace canónico.
2. Elegir **Apertura de polla** o **Recordatorio de cierre**. En cierre: 0 = hoy,
   1 = mañana, N = en N días. El botón de cálculo usa el cierre real y el día del
   envío en Colombia; el servidor rechaza plazos contradictorios. El mensaje se
   puede editar. «Sin tildes» es una opción visible que regenera la plantilla.
3. Colombia por defecto; otros países habilitados por el producto son opcionales.
   Todos los resultados o selección individual con búsqueda. El país es el del
   teléfono, no la ubicación física. Directorio, miembros y bajas se paginan.
4. Excluir miembros de pollas; admitir excepciones nominativas. Por defecto se
   conserva Carvalho excluida y las excepciones Santiago, Cirilo y John Trujillo
   identificadas en el directorio. Las excepciones no sobrepasan país, selección
   individual ni bajas. Se validan y deduplican los números.
5. Programar (hora Colombia) o enviar ahora. Se comprueban horario comercial,
   domingos, festivos nacionales y cierre de la polla. Programación con cinco
   minutos de anticipación al preparar, al menos uno al confirmar.
6. Revisar texto exacto, destinatarios finales, segmentos GSM-7/UCS-2, costo en
   créditos y saldo. Las tarifas se consultan en vivo por país. Se conservan diez
   créditos para login y el costo estimado de los programados pendientes.
7. Confirmar. LabsMobile conserva el envío programado; no depende del computador
   ni de un cron. El historial muestra aceptación y confirmación de entrega por
   separado. «Actualizar» vuelve a consultar los acuses.

Las solicitudes de baja recibidas por soporte se registran en el panel. Se
excluyen de campañas futuras, incluso si el usuario es una excepción. Una baja
no cancela un envío ya entregado al proveedor para programar. No hay consulta
automática al RNE ni se inventa evidencia histórica de consentimiento: la revisión
comercial externa sigue siendo responsabilidad del operador. La app conserva su
texto existente de aceptación de promociones y baja por correo.

## Datos, seguridad y operación

Migración `153_sms_campaigns.sql`: `sms_campaigns`, `sms_campaign_recipients`,
`sms_marketing_suppressions`. Todas con RLS, políticas deny-all y privilegios
exclusivos de service_role; sin DELETE. RPCs con search_path fijo y EXECUTE solo
service_role. No modifica usuarios, pronósticos, pagos ni la telemetría de OTP.

Cada revisión conserva mensaje, fecha, destinatarios, costo y huella. Vence en
10 minutos. Al confirmar se releen publicación, audiencia, bajas, tarifa y saldo.
`claim_sms_campaign` reserva el despacho atómicamente antes del POST, vuelve a
comprobar admin, bajas y cantidad de destinatarios, y serializa el uso de saldo.
Una huella única impide duplicar el mismo mensaje/fecha/lista aun con otra revisión.
Los envíos inmediatos se deduplican por día Colombia.

Estados: `ready → dispatching → scheduled | accepted | rejected | unknown`.
No hay retries automáticos del POST. Timeout, respuesta ambigua o caída después de
reservar requieren conciliación con el histórico de LabsMobile por `subid`.
`dispatching` o `unknown` bloquean nuevos despachos hasta esa conciliación; nunca
volver a ponerlos en `ready` sin comprobar qué ocurrió en el proveedor. El panel
no ofrece reenviar ni cancelar. Un rechazo explícito puede prepararse de nuevo.

Los acuses de las nuevas campañas usan prefijo `sc` y `/api/sms/ack`, con el
secreto existente. Van a una tabla separada del vigía de OTP. Una entrega
confirmada es terminal; acuses repetidos o fallidos posteriores no la degradan.
Se usan los campos `acklevel=handset/status=ok` para confirmar entrega. Los demás
niveles no se presentan como entrega al destinatario.

Configuración existente: `LABSMOBILE_USERNAME`, `LABSMOBILE_TOKEN`,
`SMS_ACK_SECRET`. El panel no envía si falta el secreto de acuses o si
`LABSMOBILE_DRY_RUN=1`. Máximo 10.000 destinatarios y 10 segmentos por persona.
Las respuestas privadas son no-store, los POST requieren mismo origen y la ruta
queda cubierta por NetworkOnly de `/api/*`. No se registran teléfonos en logs.

La campaña de OFI GOLAZO 3 ya aceptada el 27-sep-2026 se importó desde su recibo,
**sin contactar de nuevo al proveedor**: 418 números, 28-sep a las 12:00 Colombia,
referencia `ofi3-20260928-co`. Así figura en historial, reserva saldo y no se duplica.
El envío original no configuró el acuse de este panel: «sin confirmación» no
significa que haya fallado; consultar LabsMobile para su entrega.

## Verificación

- `npm test -- lib/sms/campaigns`: codificación, plantillas, selección/bajas,
  paginación >1000, horarios/festivos, permisos por cuenta, CSRF, no retries.
- `scripts/sms-campaigns-check.sql`: BEGIN/ROLLBACK; permisos anon/authenticated,
  propietario incorrecto, reserva única y acuse terminal. Usa solo fixtures propios.
- `npm run build` y lint de los archivos afectados.
- Playwright aislado, API simulada y sin SMS reales: 320, 639, 640, 768 y 1440 px;
  plantillas, revisión, envío simulado, historial, fuentes y texto al 200 %.
- Smoke de lectura real: catálogo de OFI GOLAZO 3, tres excepciones, 418 teléfonos,
  texto idéntico al mensaje aprobado, tarifas y saldo de LabsMobile.

Contrato visual: tokens del proyecto, Outfit 15 px para texto/controles, ayuda
13 px, Bebas 34/24 px para títulos. Opciones de plantilla y selección con radio y
texto que envuelve; el editor tiene doce filas; países y personas bajo demanda.

Fuentes: [API LabsMobile](https://www.labsmobile.com/es/api-sms/versiones-api/http-rest-post-json),
[Ley 2300 de 2023](https://normograma.crcom.gov.co/crc/compilacion/docs/ley_2300_2023.htm).

Cancelaciones confirmadas en LabsMobile: migración 154, estado cancelled. Conserva destinatarios e historial, libera la reserva y el panel muestra Cancelada. La campaña del mediodía del 28-sep fue cancelada por orden del dueño; permanece únicamente la de las 18:55 Colombia para 448 personas.
