# Campañas SMS desde administración — propuesta

Estado: viabilidad comprobada el 27 de septiembre de 2026; interfaz, endpoints
y migraciones aún no implementados. El envío puntual preparado en esta sesión
es independiente de esta propuesta. No contratar otro proveedor.

## Recorrido del administrador

1. Elegir una polla publicada. Insertar automáticamente su enlace canónico
   `/polla/<slug>` en un mensaje editable; ofrecer nombre, entrada y premio
   calculado por los RPC existentes, sin recalcular dinero en TypeScript.
2. Seleccionar destinatarios: Colombia por defecto, otros países opcionales,
   todos los resultados del filtro o selección individual. Incluir/excluir
   miembros de una polla y permitir excepciones por usuario. Al seleccionar
   «todos», incluir todas las páginas, no solo la página visible.
3. Ver destinatarios únicos, exclusiones, teléfonos inválidos, longitud,
   codificación, segmentos por destinatario, créditos necesarios y saldo.
4. Enviar ahora o programar en hora de Colombia. Confirmación concreta con
   mensaje final, cantidad, fecha y costo antes de despachar. Opción de enviar
   una prueba al administrador, contabilizada como un envío real.
5. Consultar historial con estados separados: borrador, programado, aceptado,
   entregado, rechazado y pendiente de conciliación. Poder consultar entregas
   individuales sin mostrar teléfonos en logs o URLs.

## Datos y ubicación

Reutilizar el directorio administrativo y su autorización. El número está en
`users.whatsapp_number` aunque el canal sea SMS. Normalizar E.164, validar con
`libphonenumber-js` y deduplicar por número. El país del número permite el filtro
«Números de Colombia»; no prueba residencia ni ubicación física. No prometer
filtros fiables de ciudad mientras el usuario no declare ese dato. Si se usan
ubicaciones de inicios de sesión, identificarlas como una observación histórica,
nunca como geolocalización actual.

El orden de exclusiones debe ser explícito: país y teléfono válido → exclusión
por polla → excepciones nominativas → bajas/restricciones de contacto. Una
excepción del administrador no debe reactivar una baja del destinatario.

## Integración y costos

LabsMobile ya tiene cliente en `lib/sms/labsmobile.ts`, balance, tarifas por país
y confirmaciones de entrega. Su API permite listas de destinatarios y el campo
`scheduled` en UTC. Convertir en servidor desde `America/Bogota`. El proveedor
conserva el envío pendiente; no hacen falta cron de Vercel ni computador abierto.

SMS se factura por segmento y país. Contar GSM-7 (extensiones de dos posiciones)
frente a UCS-2, incluyendo enlaces y saltos de línea. Ofrecer quitar tildes como
una elección visible, nunca cambiar el texto silenciosamente. Enviar `long: 1`
para mensajes concatenados. Mantener el enlace propio sin acortarlo por defecto.
Consultar tarifas actuales y reservar saldo para códigos de acceso.

No reutilizar directamente la telemetría de OTP para campañas: el vigía actual
espera entrega en minutos y trataría un SMS programado como una falla de login.
La campaña necesita su propia correlación de entregas por `subid` y destinatario,
compatible con el receptor de acuses existente.

Gotcha verificado: `test: 1` con `scheduled` devuelve código 41. Para probar el
contenido y destinatarios sin entregar ni consumir créditos, quitar `scheduled`
solo del payload simulado; comprobar la conversión de horario por separado.
Código 0 con «saved» confirma aceptación de la programación, no entrega futura.

## Seguridad y confiabilidad

- Validar sesión y rol administrativo en servidor antes de leer destinatarios
  o despachar. Claves privadas solo en servidor, respuestas `private, no-store`.
- Guardar campaña y una instantánea de destinatarios en la base existente,
  con RLS, permisos explícitos y operaciones administrativas restringidas.
  No crear otra base ni escribir en pronósticos.
- Reserva atómica de despacho, hash del mensaje/fecha/destinatarios y clave de
  operación para impedir doble clic. Registrar la intención antes del POST.
  Una respuesta ambigua o timeout exige conciliación: no reenviar a ciegas.
- No asumir que el `subid` del proveedor garantiza idempotencia. Para lotes,
  guardar los resultados de cada lote y no repetir los ya aceptados.
- Revisar autorización comercial, bajas y RNE antes del despacho. La app tiene
  texto de aceptación y baja por correo en privacidad; aún falta una gestión
  administrativa persistente de bajas SMS y evidencia por destinatario.
- El horario comercial colombiano excluye domingos y festivos. Validarlo tanto
  al preparar como al enviar; una campaña tardía no se despacha fuera de horario.

## Fuentes y pruebas de aceptación

- [API de LabsMobile](https://www.labsmobile.com/es/api-sms/versiones-api/http-rest-post-json):
  envío masivo/programado, tarifas, simulación y confirmaciones.
- [Ley 2300 de 2023, CRC](https://normograma.crcom.gov.co/crc/compilacion/docs/ley_2300_2023.htm):
  horarios y contacto comercial.

Pruebas: límites de segmentos, conversión Colombia/UTC y festivos, más de 1000
usuarios, deduplicación, exclusiones/excepciones/bajas, acceso no administrativo,
doble clic y concurrencia, timeout ambiguo, saldo insuficiente, lote parcialmente
aceptado y acuse duplicado. Validación visual con tres anchos y texto ampliado.
