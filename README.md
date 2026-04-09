# La Polla ⚽🇨🇴

App de pollas mundialistas para el Mundial Colombia 2026. Crea grupos de pronósticos con tus amigos, predice marcadores, y compite en un ranking en tiempo real.

## Stack

- **Next.js 14** App Router + TypeScript
- **Supabase** (PostgreSQL + Auth + RLS)
- **Meta WhatsApp Cloud API** — login por OTP y bot de notificaciones
- **API-Football** (RapidAPI) — fuente de partidos y resultados
- **Cloudflare Turnstile** — protección anti-bot en login
- **Tailwind CSS**
- **Vercel** — deploy target

## Primeros pasos

### 1. Clonar e instalar

```bash
git clone https://github.com/SantiagoDevRel/la-polla-app
cd la-polla-app
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Llenar todas las variables en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=1050091718189402
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
RAPIDAPI_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

### 3. Supabase schema

Ejecutar en el SQL Editor de Supabase:

```
supabase/migrations/001_initial_schema.sql
```

### 4. Correr en local

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## Cómo funciona

### Auth
Login exclusivo por WhatsApp OTP. Sin contraseñas. El usuario ingresa su número de teléfono, recibe un código de 6 dígitos por WhatsApp, y queda autenticado. No hay modo de bypass ni modo dev.

### Pollas
Una polla es un grupo de pronósticos. El creador configura:
- Torneo (Mundial 2026, Liga BetPlay, etc.)
- Alcance (torneo completo, fase de grupos, eliminatorias, partidos custom)
- Modo de pago: `honor` / `admin_collects` / `digital_pool`
- Monto de entrada (opcional, en COP)
- Privada o abierta

### Pronósticos
- Cada participante predice el marcador exacto de cada partido
- Los pronósticos se cierran 5 minutos antes del partido (enforced por trigger en DB)
- Los pronósticos de otros usuarios son invisibles hasta que el partido empiece
- Puntos: marcador exacto = 5 pts, resultado correcto = 2 pts, goles de un equipo exactos = 1 pt

### Sistema de puntos
Calculado automáticamente por trigger en Supabase cuando el partido pasa a `finished`. El ranking se actualiza en tiempo real dentro de cada polla.

### Modos de pago
La plataforma NO procesa dinero real en v1. Solo trackea el estado de pago.
- `honor`: sin pago upfront, cada participante le paga al ganador directamente al final
- `admin_collects`: el admin recoge físicamente y distribuye, la plataforma solo muestra quién pagó
- `digital_pool`: el admin declara el monto total, la plataforma muestra instrucciones de pago

---

## Estructura del proyecto

```
app/
  (app)/              # Rutas autenticadas
    dashboard/        # Dashboard principal
    pollas/crear/     # Crear nueva polla
    pollas/[slug]/    # Vista de polla: partidos, pronósticos, ranking
  (auth)/             # Rutas públicas
    login/            # Ingreso con número de WhatsApp
    verify/           # Verificación del OTP
  api/
    auth/otp/         # Generar y verificar OTP
    pollas/           # CRUD de pollas
    pollas/[slug]/    # GET polla por slug
    pollas/[slug]/predictions/  # Guardar pronóstico
    whatsapp/webhook/ # Webhook del bot de WhatsApp
components/
  polla/              # PollaCard, MatchPredictionCard
  ui/                 # Button, Input, PhoneInput
lib/
  api-football/       # Cliente y sync de partidos
  supabase/           # Clientes server, client, admin
  whatsapp/           # Bot y mensajes
supabase/
  migrations/         # Schema SQL completo
```

---

## WhatsApp Bot

El webhook de WhatsApp está en `app/api/whatsapp/webhook/route.ts`. Para conectarlo en desarrollo se necesita una URL pública (ngrok o deploy en Vercel).

```bash
# Con ngrok:
ngrok http 3000
# Configurar la URL pública en Meta WhatsApp Dashboard > Webhooks
```

En producción el webhook se configura con la URL de Vercel.

**Nota**: el Access Token actual (`EAAT...`) es temporal. Antes del deploy a producción debe reemplazarse con un System User Token permanente desde Meta Business Manager.

---

## Deploy en Vercel

```bash
vercel --prod
```

Variables de entorno necesarias: las mismas del `.env.local`. Configurar en Vercel Dashboard > Settings > Environment Variables.

Después del deploy:
1. Actualizar el webhook de WhatsApp en Meta con la URL de producción
2. Reemplazar el token temporal de Meta con un System User Token
3. Reemplazar las Turnstile test keys con las keys reales de producción

---

## Estado actual

| Feature | Estado |
|---|---|
| Setup base Next.js + Supabase | ✅ |
| Schema Supabase (7 tablas) | ✅ |
| Auth WhatsApp OTP end-to-end | ✅ |
| Dashboard básico | ✅ |
| Crear polla | ✅ |
| Vista de polla con pronósticos y ranking | ✅ |
| API routes polla/slug + predictions | ✅ |
| WhatsApp bot webhook | ✅ construido, pendiente conectar |
| Importar partidos del Mundial | ⏳ pendiente |
| Deploy Vercel | ⏳ pendiente |
| System User Token Meta | ⏳ pendiente |
| Turnstile keys de producción | ⏳ pendiente |

---

## Legal

La plataforma no procesa pagos reales en v1. El campo `payment_mode` en la tabla `pollas` solo registra el acuerdo entre participantes. El modelo actual está fuera del alcance regulatorio de Coljuegos por no involucrar procesamiento de pagos.

---

Construido con ☕ en Medellín / Lisboa por [@SantiagoDevRel](https://github.com/SantiagoDevRel)
