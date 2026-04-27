# Handoff: `auth.uid()` propagation fix

> **Para una sesión nueva de Claude Code**: este doc es self-contained.
> No necesitás contexto previo. Leelo entero antes de empezar.

## El problema en 1 párrafo

En todas las rutas de Next.js (Server Components y Route Handlers de
La Polla), `supabase.auth.getUser()` devuelve el user logueado
correctamente, pero cuando esa misma instancia del cliente Supabase
ejecuta `.from("...").select(...)`, el JWT del user **no llega** al
PostgREST de Supabase. Resultado: dentro de Postgres,
`auth.uid()` devuelve `NULL`. Toda RLS que filtre por `auth.uid()`
retorna 0 filas. **El bug es 100% reproducible** y afecta cada query
de cada usuario logueado.

## Por qué importa

El workaround actual está en 46+ archivos: cada query autenticada usa
`createAdminClient()` (service-role key, bypassea RLS) y agrega filtros
manuales como `.eq("user_id", user.id)`. Esto:

1. Hace que **RLS no sea la primera línea de defensa** — si una nueva
   ruta se olvida del filtro manual, leak de datos.
2. Expande el blast radius del service-role key — está en muchos
   contextos.
3. Cualquier feature nuevo de Supabase que asuma `auth.uid()` (RLS más
   sofisticadas, real-time con scope, etc.) no funciona.

Arreglarlo significa: poder usar el cliente Supabase normal (no admin)
para queries autenticadas, y que RLS gatee correctamente.

## Estado actual del código (qué leer primero)

### Archivos clave (en orden)

1. **`lib/supabase/server.ts`** — el `createServerClient` de
   `@supabase/ssr` que usan los Server Components.
2. **`lib/supabase/middleware.ts`** — el middleware de auth, también
   crea un `createServerClient` con su propia config de cookies.
3. **`middleware.ts`** (root) — wrapper, llama a `updateSession`.
4. **`app/api/pollas/route.ts`** — ejemplo concreto donde se manifiesta
   el bug (commit comments lo documentan).
5. **`lib/supabase/admin.ts`** — el workaround (service-role).

### Comentarios que dejaron rastro del bug

```bash
git log --oneline --all | grep -i "auth.uid"
# Ej: 1af6489 fix(api): close auth.uid()-NULL gap across remaining routes
```

Y en `CLAUDE.md` está el resumen del workaround.

### Versión exacta de Supabase

- `@supabase/ssr@^0.10.2`
- `@supabase/supabase-js@^2.103.0`
- `next@14.2.35` (App Router)

## Hipótesis a probar (en orden de probabilidad)

### Hipótesis 1: Cookie no se está setear / leer correctamente

`server.ts` actual:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(URL, ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // ignored — Server Components can't set cookies after response started
        }
      },
    },
  });
}
```

Sospecha: el `try/catch` tragándose el error puede estar haciendo que
la cookie de session refrescada nunca llegue al cliente, y la próxima
query usa una cookie vieja → JWT inválido → `auth.uid()` = NULL.

**Cómo probar**:
1. Agregar `console.log` adentro del `try` y del `catch` con el name
   de la cookie. Ver en Vercel logs si el catch se dispara durante
   queries reales.
2. Verificar que las cookies que devuelve `getAll()` incluyen
   `sb-<project>-auth-token` con el JWT.

### Hipótesis 2: El server client no manda el header `Authorization`

Con `@supabase/ssr` el cliente debería extraer el JWT de la cookie y
mandarlo como `Authorization: Bearer <jwt>` a PostgREST. Si el JWT no
está en la cookie (corrupto, expirado, mal nombrado), no se manda.

**Cómo probar**:
1. Capturar el request real al PostgREST. La forma más fácil:
   - Override `global.fetch` temporalmente en `server.ts` antes de
     crear el cliente, y loggear `headers["Authorization"]`.
   - O usar el SUPABASE_DEBUG flag si existe.
2. Confirmar que el JWT presente coincide con el que ves en
   `auth.getUser()`.

### Hipótesis 3: Mismatch entre cookie name y lo que `@supabase/ssr` espera

Supabase Auth setea cookies como `sb-<project-ref>-auth-token`. Si el
project ref en client + server difiere, o si una versión vieja escribe
con otro nombre, el cliente no encuentra el JWT.

**Cómo probar**:
1. En Chrome DevTools → Application → Cookies, mirar todas las cookies
   de `lapollacolombiana.com` que empiezan con `sb-`.
2. Comparar contra `process.env.NEXT_PUBLIC_SUPABASE_URL` y verificar
   que el project ref hace match.

### Hipótesis 4: Race condition entre middleware y route handler

Middleware hace `updateSession`, que potencialmente refresca la cookie.
El route handler luego llama a `createClient()` que lee `cookies()`.
Si el refresh no se aplicó al request del route handler (Next.js puede
clonar requests), el handler ve la cookie vieja.

**Cómo probar**:
1. Loggear el JWT que ve middleware vs el que ve el route handler.
2. Forzar `await supabase.auth.getSession()` antes del query y ver si
   refresca y arregla.

### Hipótesis 5: Bug en `@supabase/ssr@0.10.2`

La versión instalada (`0.10.2`) puede tener un bug conocido. Las
versiones más recientes son 0.5+ con cambios significativos.

**Cómo probar**:
```bash
npm install @supabase/ssr@latest
# O probar 0.5.x específicamente
```

Y volver a correr el flujo. Si arregla con 0.5.x, era un bug
upstream.

## Cómo reproducir el bug en local

```bash
# 1. Loguearte normalmente con tu teléfono real (Turnstile + OTP)
# 2. Una vez en /inicio, abrí la consola del navegador
# 3. En el server (terminal donde corre `npm run dev`), agregá temp logging:
```

En `app/api/pollas/route.ts` línea ~115, antes del query:

```ts
const { data: { user } } = await supabase.auth.getUser();
console.log("[debug] user from getUser():", user?.id);

// Probar query SIN admin client
const { data: testRows, error: testErr } = await supabase
  .from("polla_participants")
  .select("id, user_id, polla_id");
console.log("[debug] rows visible to user:", testRows?.length, "err:", testErr?.message);
// Esto debería devolver tus rows. Si devuelve 0 → bug confirmado.
```

Visitá `/api/pollas` (con la sesión activa). En los logs de Next debe
verse algo como:

```
[debug] user from getUser(): 8c1f2a4e-b6c3-49a1-9e80-...
[debug] rows visible to user: 0
```

Eso confirma: `getUser()` ve al user, pero PostgREST no.

## Validación del fix

Una vez creas que arreglaste, el smoke test es:

```ts
// En cualquier route handler autenticado, con user logueado:
const { data, error } = await supabase
  .from("polla_participants")
  .select("id")
  .eq("user_id", user.id); // este filtro SOBRA si auth.uid() funciona
```

Si `data.length > 0`, el JWT está llegando. Para confirmar que es por
`auth.uid()` y no por el filtro:

```sql
-- En SQL Editor de Supabase (con tu sesión via Studio):
SELECT auth.uid();
-- Debería devolver tu UUID, no NULL

-- Otra forma desde código:
const { data } = await supabase.rpc('get_my_uid');  -- SQL function que devuelve auth.uid()
```

Crear esa rpc helper:
```sql
CREATE OR REPLACE FUNCTION public.get_my_uid()
RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
```

## Cleanup post-fix (cuando se confirme que funciona)

Revertir los 46 usos de `createAdminClient()` que estén en rutas
autenticadas. Buscar:

```bash
grep -rn "createAdminClient" --include="*.ts" --include="*.tsx" app/ lib/
```

Para cada call site:
1. Confirmar que la ruta tiene un `getUser()` antes (sino, es legítimo
   admin).
2. Reemplazar `createAdminClient()` con el `supabase` del
   `createClient()` server.
3. Quitar el filtro `.eq("user_id", user.id)` redundante (RLS lo hace).
4. Verificar que la ruta sigue funcionando.

**No revertir** los usos legítimos de admin client:
- `lib/auth/login-event.ts` (insert de notification por user)
- `lib/whatsapp/bot.ts` (procesa mensajes inbound, no hay user session)
- `app/api/whatsapp/webhook/route.ts` (mismo)
- `app/api/auth/otp/route.ts` (signup, user no existe aún)
- Cron-triggered routes (`/api/matches/sync`, etc.)
- Webhook handlers
- Admin routes (`/api/admin/*`)

## Tests para no romper

Cuando termines el fix:

```bash
npm test                # 41 tests deben seguir pasando
npm run typecheck       # 0 errores
npm run lint            # solo warnings preexistentes de img tags
```

Manual:
1. Login con phone+password → ver `/inicio` (lista de pollas)
2. Entrar a una polla → ver participantes y ranking
3. Predecir un partido → confirmar que se guarda
4. `/avisos` → ver notificaciones
5. Crear una polla nueva → confirmar que aparece en lista

## Tags de seguridad

```bash
git tag pre-auth-uid-fix    # antes de empezar el fix
```

Para revertir todo si algo se complica.

## Acceso

- Repo: `https://github.com/SantiagoDevRel/la-polla-app`
- Supabase project ID: `sgmygyrvytzaushiqrst`
- Dominio prod: `lapollacolombiana.com`
- Branch de trabajo: `main` (auto-deploy en Vercel)

## Tiempo estimado

2-4 horas:
- 30-60 min reproducir + entender el bug
- 60-90 min probar hipótesis hasta encontrar la raíz
- 30-60 min cleanup de admin clients redundantes
- 30 min verificación + tests
