# Contraseña opcional de seis dígitos

Al completar nombre y pollito, el registro ofrece **Crear contraseña** y
**Omitir por ahora**. Login conserva SMS y añade **Entrar con contraseña**.
**¿Olvidaste tu contraseña?** ofrece WhatsApp primero y SMS como alternativa.
WhatsApp usa el enlace de acceso existente: después, en Perfil puedes cambiarla.
SMS verifica el celular por el flujo existente y abre `/set-password` para crear
otra, sin exigir la anterior. Un login normal por SMS no muestra esa pantalla.

Perfil ofrece **Contraseña → Crear contraseña / Cambiar contraseña** justo debajo de
**Cuenta para cobrar**, con una llave y un botón violeta, mientras el canal
está habilitado. Reutiliza `/set-password?returnTo=%2Fperfil` y el endpoint
existente: guarda la primera contraseña o reemplaza la anterior y vuelve a
Perfil. Sirve con una sesión obtenida por WhatsApp, SMS o contraseña; no exige
recordar la anterior. No se añade otra tabla, credencial ni proveedor.

El estado autenticado sale de `GET /api/auth/password/status`: solo devuelve si
el canal está habilitado y si el usuario verificado tiene una credencial para
su celular actual. Consulta únicamente `user_id`, filtra UUID y celular, y
responde `private, no-store`; sin sesión devuelve 401. Un error muestra reintento,
nunca «No tienes una contraseña creada». El GET público anterior conserva solo
la disponibilidad del canal.

Perfil distingue «No tienes una contraseña creada» de «Ya tienes una contraseña
creada». El formulario también distingue crear/cambiar. Mostrar/Ocultar permite
revisar cada campo mientras se escribe, incluida la confirmación y el login;
no recupera la contraseña anterior. Se conserva en memoria hasta guardar o salir.

Tipografía: se reutiliza Perfil (Outfit 16/600 para título, 14 px para estado,
ayuda y controles) y login (Bebas 24/400 para título, Outfit 14 para ayuda/labels,
16 para inputs/acción principal). Los controles admiten wrapping y texto al 200 %.

Activación: aplicar `160_optional_phone_password.sql`; configurar un secreto
aleatorio `AUTH_PIN_PEPPER` de al menos 32 caracteres y
`PHONE_PASSWORD_ENABLED=true`, ambos solo servidor. Sin configuración completa,
el canal y la oferta de registro permanecen apagados. Cambiar el pepper requiere
que las personas creen otra contraseña entrando por SMS; no rotarlo a ciegas.

La credencial usa scrypt (N=32768, r=8, p=1), salt aleatorio de 16 bytes y pepper
independiente. `phone_password_credentials` tiene RLS deny-all y permisos solo
service_role; los clientes no leen hashes. No se crea una contraseña en GoTrue:
su endpoint público permitiría saltarse el límite específico para seis dígitos.
La sesión reutiliza `startSessionForVerifiedPhone`, valida que el usuario resuelto
sea el dueño de la credencial y registra un evento de login.

Reservas atómicas, antes del hash: cinco intentos por celular en 15 minutos,
20 en 24 horas y 50 por IP en 15 minutos. La IP se guarda como HMAC. La RPC falla
cerrada, conserva intentos y serializa ambos límites con advisory locks.
El código nunca guarda la contraseña en logs, cookies ni storage del navegador.
Crear/cambiar exige sesión verificada y origen del request comprobado; el celular
y UUID vienen de `auth.getUser()`, nunca del formulario.

Pruebas: `npm test -- tests/phone-password.test.ts tests/profile-password.test.ts`,
`scripts/phone-password-check.sql` (transacción con rollback) y
`node scripts/phone-password-concurrency-check.mjs` (solo PostgreSQL local).
Los límites quedan separados de SMS y no agregan envíos ni servicios pagos.
