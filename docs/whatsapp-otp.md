# WhatsApp: solo códigos de acceso

Decisión del dueño, 2026-09-27: el bot entrega únicamente un OTP de seis
dígitos solicitado desde `/login`. No conversa, no recibe pronósticos y no
envía avisos de pollas. SMS/Telegram siguen disponibles según su configuración;
el canal de entrega del OTP telefónico se selecciona en el servidor, no por
datos editables del usuario.

## Flujo

`/login → /api/auth/start-otp → Supabase Phone Auth → /api/auth/sms-hook
→ Zernio → WhatsApp → /api/auth/verify-otp → sesión existente de Supabase`.

Supabase genera, expira y consume el código. No se crea otra tabla de tokens,
otra cuenta ni una sesión personalizada. `channel: "sms"` y `type: "sms"`
siguen siendo el contrato Phone Auth de Supabase; el hook firmado decide la
entrega y no manda SMS cuando selecciona WhatsApp. No usar el canal nativo
WhatsApp de Twilio ni servicios que generen un segundo OTP.

Se conservan captcha, IP real, límites por teléfono/IP, países permitidos,
cooldown y verificación server-side con cookies. Un cliente viejo que anuncia
SMS no dispara WhatsApp: obtiene 409 y debe actualizar la página. No hay
fallback automático que cobre dos envíos. Los contadores `generate` y el tope
diario existentes se comparten entre los dos canales; no son un registro de
facturación. Los OTP WhatsApp no crean filas de entregas LabsMobile.

`lib/auth/whatsapp-otp.ts` solo acepta seis dígitos y la plantilla fija
`lp_login_otp`, idioma `es`. Antes de enviar comprueba en Zernio que está
APPROVED y es AUTHENTICATION. El mismo código alimenta cuerpo y botón COPY_CODE
(Meta representa este último como URL dinámica). Un webhook repetido usa la
misma clave de idempotencia. No se reintentan timeouts ni se imprimen códigos,
teléfonos, claves o cuerpos del proveedor en logs.

Las funciones históricas se conservan, pero `whatsappOutboundEnabled()`
siempre devuelve false, incluso con una variable antigua en true. El webhook
Meta valida su firma y confirma recepción sin llamar al router, generar
enlaces mágicos ni escribir pronósticos. No hace falta un webhook de mensajes
entrantes en Zernio para entregar OTP.

## Configuración y activación

Variables privadas del servidor:

```dotenv
WHATSAPP_OTP_ENABLED=false
ZERNIO_API_KEY=
ZERNIO_WHATSAPP_ACCOUNT_ID=
```

Mantener el hook existente de Supabase y `SEND_SMS_HOOK_SECRET`. La clave de
Zernio se obtiene en su panel **API Keys**, preferiblemente limitada al perfil
del emisor. Nunca publicar estas credenciales ni usar `NEXT_PUBLIC_`.

1. Confirmar con Meta que la cuenta puede crear plantillas AUTHENTICATION.
2. Crear `lp_login_otp` en español (`es`), recomendación de seguridad y botón
   COPY_CODE. Sin enlaces de login, promociones ni datos de una polla. No
   anunciar una expiración distinta de la configurada en Supabase.
3. Confirmar APPROVED en Zernio y configurar las dos credenciales privadas.
4. Probar en un entorno cuyo Supabase Send SMS Hook apunte a ESE entorno:
   una preview que usa el Auth de producción todavía llama al hook de
   producción; activar solo la preview no constituye una prueba WhatsApp.
5. Con Santiago, solicitar un código real a su teléfono, verificar entrega,
   copiar/teclear los seis dígitos, comprobar sesión/onboarding, rechazo al
   reutilizarlo y respuesta al código incorrecto. No enviar pruebas a usuarios.
6. Solo después de la prueba, activar `WHATSAPP_OTP_ENABLED=true` en el
   despliegue que atiende el hook y el login. Mantener las demás salidas apagadas.

Volver a `WHATSAPP_OTP_ENABLED=false` recupera SMS, sin borrar cuentas, sesiones,
variables, plantillas ni registros.

## Estado externo comprobado el 2026-09-27

- Emisor: **La Polla Colombiana**, **+1 856 483 1652**.
- Foto oficial del pollito subida otra vez y confirmada por Zernio. Descripción
  actualizada a códigos de acceso; no promete avisos ni conversación.
- Nombre solicitado nuevamente; la escritura respondió **PENDING_REVIEW**,
  pero una lectura posterior devuelve **AVAILABLE_WITHOUT_REVIEW** y sin
  nombre pendiente. El nombre registrado es correcto; no afirmar que Meta
  lo aprobó ni que todos los clientes de WhatsApp ya lo muestran.
- Crear `lp_login_otp` devolvió Meta **10 / 2388185**, «This WhatsApp business
  account does not have permission to create message template». Se reprodujo
  tanto por Zernio como en el administrador directo de Meta.
- La verificación del negocio figura `pending_submission` y el límite del
  número es TIER_250. No se ha confirmado cuál requisito concreto desbloquea
  la creación de AUTHENTICATION. No confundir dominio verificado con negocio
  verificado ni mensajes de marketing entregados con OTP habilitado.
- La integración queda **apagada**. No se ha entregado un OTP real ni activado
  WhatsApp en producción. No se modificó la configuración del Auth productivo.
- Se creó una clave Zernio restringida al perfil del emisor, con mensajería y
  acceso a cuentas, sin facturación, publicidad ni gestión de claves/webhooks.
  Su lectura de plantillas fue verificada con HTTP 200. Las tres variables
  anteriores quedaron añadidas en Vercel Production: clave sensible,
  identificador del emisor y `WHATSAPP_OTP_ENABLED=false`. No se sobrescribió
  ninguna variable existente ni se desplegó/activó el cambio. La copia de la
  credencial está fuera del repositorio, bajo el directorio privado del dueño.

## Verificación local

```sh
npm test -- tests/whatsapp-otp.test.ts tests/phone-otp-hook.test.ts tests/whatsapp-login-only.test.ts tests/auth-real-ip.test.ts tests/sms-captcha.test.ts
npm run build
```

Los tests simulan proveedores: no gastan créditos ni crean usuarios.
La revisión visual debe cubrir ingreso, seis dígitos y errores en 320, 768 y
1440 px, además de texto ampliado. Ninguna prueba simulada sustituye el paso 5.

Verificado localmente: 125 tests del backend/regresiones; cuatro pruebas de
Playwright (los tres anchos y el traductor de Chrome), más inspección de
capturas. Los seis dígitos caben con texto al 200 % en 320 px. Se mantienen
Bebas Neue para títulos/código y Outfit para controles/cuerpo; el campo no
reduce su fuente para encajar. El contrato medido del paso OTP es título
27 px/400, cuerpo 15,75 px/400, código 36 px/400, botón 18 px/700, con el
zoom base existente de la app. No se probaron dispositivos físicos ni entrega
de un código real por la restricción indicada arriba.

La prueba UI opt-in está en `e2e/whatsapp-otp.spec.ts`. Ejecutar servidor y
Playwright con `WHATSAPP_OTP_ENABLED=true` en un entorno aislado; intercepta
start/verify y no llama a Supabase Auth. El resto de la suite puede ejecutarse
con la integración apagada.

Tarifas base verificadas: Colombia US$0,0008 y Portugal US$0,0171 por código
entregado, antes de impuestos/cargos de Zernio. Consultar de nuevo al activar:
[Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
y [Zernio](https://docs.zernio.com/pricing).
