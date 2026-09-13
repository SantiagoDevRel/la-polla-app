// lib/supabase/auth-ip.ts — Clientes de Supabase SOLO para las llamadas de
// Auth que el servidor hace en nombre de una persona (signInWithOtp,
// verifyOtp y el signOut local del mismo request).
//
// Por qué existe: Supabase Auth limita /otp y /verify POR IP (30 cada 5 min).
// Llamadas desde Vercel llegan con las IPs de salida de Vercel, así que todas
// las personas comparten el mismo balde y un pico de logins antes de un
// partido lo agota para todos. Supabase acepta la IP real en la cabecera
// `Sb-Forwarded-For`, pero SOLO si la petición usa una key `sb_secret_...` y
// el proyecto tiene `security_sb_forwarded_for_enabled=true`
// (https://supabase.com/docs/guides/auth/rate-limits#ip-address-forwarding).
//
// Reglas duras:
// - Devuelve `client.auth`, no el cliente completo: con la secret key y sin
//   sesión, un `.from()` iría a PostgREST como service_role. Así ese error no
//   se puede escribir. Para datos usa lib/supabase/{server,admin}.ts.
// - La sesión que se escribe en cookies es la que devuelve verifyOtp: la key
//   no participa del nombre de la cookie (sale del host de la URL) ni del
//   token. Probado en integración local (README → «IP real en Supabase Auth»).
// - Sin SUPABASE_SECRET_KEY (o con un valor que no es sb_secret_) se usa la
//   anon key sin cabecera, igual que antes, con un warn por proceso.
// - Si Supabase RECHAZA la secret key (revocada, rotada, de otro proyecto o mal
//   copiada: 401 "Invalid API key"), cada llamada se repite una vez con la anon
//   key sin cabecera y deja un console.error. Un error de configuración cuesta
//   la IP real, no el login (fetchWithAnonFallback).
import { isIP } from "node:net";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const SB_FORWARDED_FOR_HEADER = "Sb-Forwarded-For";

type HeaderReader = { get(name: string): string | null };
type AuthClient = ReturnType<typeof createSbClient>["auth"];

/**
 * Normaliza una IP de cabecera. Acepta IPv4, IPv6, `[IPv6]:puerto` e
 * `IPv4:puerto`; descarta todo lo demás (texto, zonas `%eth0`, valores
 * enormes). Devuelve null si no es una IP utilizable.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value || value.length > 64 || value.includes("%")) return null;

  const bracketed = value.match(/^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/);
  if (bracketed) {
    value = bracketed[1];
  } else {
    const v4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/);
    if (v4WithPort) value = v4WithPort[1];
  }

  return isIP(value) === 0 ? null : value;
}

/**
 * IP pública de quien hizo el request. En Vercel `x-real-ip` y
 * `x-forwarded-for` las escribe la plataforma (sobrescribe lo que mande el
 * cliente), así que se toma `x-real-ip` y, si falta o no es válida, el PRIMER
 * valor de `x-forwarded-for`. Nunca se busca más adelante en la lista: esos
 * valores los agregan proxies intermedios, no identifican a la persona.
 */
export function getClientIp(headers: HeaderReader): string | null {
  const realIp = normalizeIp(headers.get("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  return normalizeIp(forwarded.split(",")[0]);
}

// En globalThis y no en una variable del módulo: Next empaqueta cada ruta por
// separado, y el aviso tiene que salir una vez por proceso, no una por ruta.
const WARNED_FLAG = "__laPollaAuthIpWarned";
type WarnFlagHolder = { [WARNED_FLAG]?: boolean };

/** Solo para pruebas: vuelve a permitir el warn de configuración. */
export function resetAuthIpWarningForTests(): void {
  delete (globalThis as WarnFlagHolder)[WARNED_FLAG];
}

export interface AuthRequestConfig {
  key: string;
  headers: Record<string, string>;
  forwardsIp: boolean;
}

/**
 * Qué key y qué cabeceras usar para una llamada de Auth. Con secret key y
 * con IP válida agrega `Sb-Forwarded-For`; en cualquier otro caso queda el
 * comportamiento anterior (anon key, sin cabecera).
 */
export function authRequestConfig(ip: string | null | undefined): AuthRequestConfig {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!secret || !secret.startsWith("sb_secret_")) {
    const holder = globalThis as WarnFlagHolder;
    if (!holder[WARNED_FLAG]) {
      holder[WARNED_FLAG] = true;
      console.warn(
        secret
          ? "[auth-ip] SUPABASE_SECRET_KEY no es una key sb_secret_: Supabase ignora Sb-Forwarded-For con otras keys. Se usa la anon key sin IP real."
          : "[auth-ip] Falta SUPABASE_SECRET_KEY: los límites por IP de Supabase Auth se reparten entre todos los usuarios detrás de Vercel.",
      );
    }
    return { key: anon, headers: {}, forwardsIp: false };
  }

  const clientIp = normalizeIp(ip);
  return clientIp
    ? { key: secret, headers: { [SB_FORWARDED_FOR_HEADER]: clientIp }, forwardsIp: true }
    : { key: secret, headers: {}, forwardsIp: false };
}

async function isInvalidApiKeyResponse(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = (await response.clone().json()) as { message?: unknown } | null;
    return typeof body?.message === "string" && body.message.trim().toLowerCase() === "invalid api key";
  } catch {
    return false;
  }
}

/**
 * fetch de las llamadas hechas con la secret key. Si el gateway de Supabase la
 * rechaza (401 {"message":"Invalid API key"}), repite ESA petición una sola vez
 * con la anon key y sin Sb-Forwarded-For, que es el comportamiento anterior.
 * Es seguro repetir: el rechazo ocurre en el gateway, antes de Auth, así que no
 * salió SMS ni se consumió ningún código. Otros 401 de Auth (JWT inválido,
 * código vencido) se devuelven tal cual. El token de la persona en
 * `Authorization` (signOut) se conserva; solo se cambia si era la secret key.
 */
export function fetchWithAnonFallback(secret: string, anon: string): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const headers = new Headers(init?.headers);
    if (headers.get("apikey") !== secret || !(await isInvalidApiKeyResponse(response))) {
      return response;
    }
    console.error(
      "[auth-ip] Supabase rechazó SUPABASE_SECRET_KEY (401 Invalid API key: revocada, rotada, de otro proyecto o mal copiada). Se repite la llamada con la anon key, sin IP real. Corrige la env en Vercel y vuelve a desplegar.",
    );
    headers.set("apikey", anon);
    if (headers.get("Authorization") === `Bearer ${secret}`) {
      headers.set("Authorization", `Bearer ${anon}`);
    }
    headers.delete(SB_FORWARDED_FOR_HEADER);
    return fetch(input, { ...init, headers });
  };
}

function authClientOptions(ip: string | null | undefined) {
  const { key, headers } = authRequestConfig(ip);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return {
    key,
    global: key === anon ? { headers } : { headers, fetch: fetchWithAnonFallback(key, anon) },
  };
}

/** Cliente de Auth sin cookies (start-otp: todavía no hay sesión). */
export function createAuthClient(ip: string | null | undefined): AuthClient {
  const { key, global } = authClientOptions(ip);
  return createSbClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global,
  }).auth;
}

/**
 * Cliente de Auth con las cookies del request (verify-otp, wa-magic): mismo
 * adaptador de cookies que lib/supabase/server.ts, así que la sesión que
 * devuelve verifyOtp queda en las mismas cookies de sesión de siempre.
 */
export async function createAuthRouteClient(
  ip: string | null | undefined,
): Promise<AuthClient> {
  const cookieStore = await cookies();
  const { key, global } = authClientOptions(ip);
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    global,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Solo falla en Server Components; estas llamadas viven en Route Handlers.
        }
      },
    },
  }).auth;
}
