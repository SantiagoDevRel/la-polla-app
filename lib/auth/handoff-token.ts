// lib/auth/handoff-token.ts — HMAC-signed short-lived token para SSO
// cross-domain entre lapollacolombiana.com y chickenpicks.app.
//
// Razón: cuando el user toggle-a idioma en /perfil, redirigimos al otro
// dominio. Las cookies de Supabase auth están scopeadas al dominio
// original — no transfieren. Para no obligarlo a re-loguearse, el dominio
// origen genera un token firmado con los tokens de Supabase del user, el
// dominio destino lo verifica y hace setSession() para emitir cookies
// frescas. UX: cero re-login al cambiar idioma.
//
// Diseño:
//   - HMAC-SHA256 con HANDOFF_SECRET (env var, ≥32 chars)
//   - TTL 30s. Margen para redirect HTTP + setSession server-side.
//   - timingSafeEqual para verificar firma (anti timing attack).
//   - Sin tracking de tokens consumidos: el TTL de 30s + HTTPS hacen
//     replay infeasible. Aceptable para feature de UX.
//
// El token NO va al cliente — el cliente solo recibe la URL completa
// (https://destino.com/api/auth/consume?token=...). El servidor destino
// verifica antes de hacer setSession.
import { createHmac, timingSafeEqual } from "crypto";

export interface HandoffPayload {
  access_token: string;
  refresh_token: string;
  user_id: string;
  /** Path relativo en el dominio destino al que mandar al user después
   *  del setSession (e.g., "/perfil"). Sanitized en handoff/route.ts. */
  target_path: string;
  /** issued at — segundos UNIX */
  iat: number;
  /** expires at — segundos UNIX. iat + TTL_SECONDS. */
  exp: number;
}

const TTL_SECONDS = 30;
const CLOCK_SKEW_SECONDS = 5;

function getSecret(): string {
  const secret = process.env.HANDOFF_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "HANDOFF_SECRET env var missing or too short (must be ≥32 chars)",
    );
  }
  return secret;
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64url");
}

function base64UrlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}

export function signHandoffToken(
  payload: Omit<HandoffPayload, "iat" | "exp">,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: HandoffPayload = {
    ...payload,
    iat: now,
    exp: now + TTL_SECONDS,
  };
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const sig = createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyHandoffToken(token: string): HandoffPayload {
  const dot = token.indexOf(".");
  if (dot < 0) throw new Error("malformed token");
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) throw new Error("malformed token");

  const expected = createHmac("sha256", getSecret()).update(body).digest();
  const provided = Buffer.from(sig, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new Error("invalid signature");
  }

  let payload: HandoffPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as HandoffPayload;
  } catch {
    throw new Error("malformed payload");
  }

  if (
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string" ||
    typeof payload.user_id !== "string" ||
    typeof payload.target_path !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("missing fields");
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) throw new Error("expired");
  if (payload.iat > now + CLOCK_SKEW_SECONDS) throw new Error("issued in future");

  return payload;
}
