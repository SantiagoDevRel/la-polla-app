// Telegram OIDC: autorización en la app nativa y regreso al navegador externo.
// La cookie contiene el verifier de PKCE cifrado; nunca viaja en la URL.
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EncryptJWT, jwtDecrypt, jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { toE164 } from "@/lib/auth/phone";

export const TELEGRAM_ISSUER = "https://oauth.telegram.org";
export const OIDC_CALLBACK_PATH = "/api/auth/telegram/oidc/callback";
export const OIDC_COOKIE = "lp_tg_oidc";
export const OIDC_TTL = 300;
const RANDOM_RE = /^[A-Za-z0-9_-]{43}$/;
type Env = Record<string, string | undefined>;

export interface TelegramOidcConfig {
  clientId: string;
  clientSecret: string;
}

export function getTelegramOidcConfig(env: Env = process.env): TelegramOidcConfig | null {
  const clientId = env.TELEGRAM_OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.TELEGRAM_OIDC_CLIENT_SECRET?.trim() ?? "";
  if (!/^[1-9]\d{4,19}$/.test(clientId) || clientSecret.length < 16) return null;
  return { clientId, clientSecret };
}

/** Host allowlist: no callback construido desde un Host arbitrario. */
export function oidcOrigin(requestUrl: string, env: Env = process.env): string | null {
  const url = new URL(requestUrl);
  const allowed = new Set(["https://lapollacolombiana.com", "https://chickenpicks.app"]);
  if (env.NEXT_PUBLIC_APP_URL) {
    try {
      const configured = new URL(env.NEXT_PUBLIC_APP_URL);
      if (configured.protocol === "https:" || (env.NODE_ENV !== "production" &&
        configured.protocol === "http:" && ["localhost", "127.0.0.1"].includes(configured.hostname))) {
        allowed.add(configured.origin);
      }
    } catch { /* configuración inválida: solo dominios canónicos */ }
  }
  return allowed.has(url.origin) ? url.origin : null;
}

export interface OidcAttempt {
  state: string;
  nonce: string;
  verifier: string;
  origin: string;
  returnTo: string;
}

export function newOidcAttempt(origin: string, returnTo?: string | null): OidcAttempt {
  const destination = safeReturnTo(returnTo);
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    origin,
    returnTo: destination && !/[\u0000-\u0020\u007f]/.test(destination)
      ? destination.slice(0, 1500) : "/inicio",
  };
}

function cookieKey(config: TelegramOidcConfig) {
  return createHash("sha256").update(`la-polla:telegram-oidc:v1:${config.clientSecret}`).digest();
}

export async function sealOidcAttempt(attempt: OidcAttempt, config: TelegramOidcConfig) {
  return new EncryptJWT({ ...attempt }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("la-polla:telegram-oidc").setAudience(config.clientId)
    .setIssuedAt().setExpirationTime(`${OIDC_TTL}s`).encrypt(cookieKey(config));
}

export async function readOidcAttempt(raw: string | undefined, config: TelegramOidcConfig): Promise<OidcAttempt | null> {
  if (!raw || raw.length > 4000) return null;
  try {
    const { payload: p } = await jwtDecrypt(raw, cookieKey(config), {
      issuer: "la-polla:telegram-oidc", audience: config.clientId,
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["iat", "exp"], maxTokenAge: OIDC_TTL,
    });
    if (typeof p.state !== "string" || !RANDOM_RE.test(p.state) ||
      typeof p.nonce !== "string" || !RANDOM_RE.test(p.nonce) ||
      typeof p.verifier !== "string" || !RANDOM_RE.test(p.verifier) ||
      typeof p.origin !== "string" || typeof p.returnTo !== "string" ||
      !safeReturnTo(p.returnTo)) return null;
    return { state: p.state, nonce: p.nonce, verifier: p.verifier, origin: p.origin, returnTo: p.returnTo };
  } catch { return null; }
}

export function matchesOidcState(actual: string | null, expected: string): boolean {
  return Boolean(actual && RANDOM_RE.test(actual) && RANDOM_RE.test(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
}

export function oidcAuthorizationUrl(attempt: OidcAttempt, config: TelegramOidcConfig): string {
  const url = new URL("/auth", TELEGRAM_ISSUER);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${attempt.origin}${OIDC_CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid profile phone telegram:bot_access",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export const oidcCookieOptions = (secure: boolean) => ({
  httpOnly: true, secure, sameSite: "lax" as const, path: "/api/auth/telegram/oidc", maxAge: OIDC_TTL,
});

// Un solo JWKS cacheado por proceso; claves y endpoints siempre de Telegram.
const telegramKeys = createRemoteJWKSet(new URL("/.well-known/jwks.json", TELEGRAM_ISSUER), {
  timeoutDuration: 8_000, cooldownDuration: 30_000, cacheMaxAge: 600_000,
});

export interface TelegramOidcIdentity {
  telegramUserId: number;
  phoneE164: string | null;
}

export async function verifyTelegramIdToken(
  token: string,
  attempt: OidcAttempt,
  config: TelegramOidcConfig,
  keys: JWTVerifyGetKey = telegramKeys,
): Promise<TelegramOidcIdentity> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: TELEGRAM_ISSUER, audience: config.clientId, algorithms: ["RS256", "ES256"],
    requiredClaims: ["sub", "iat", "exp", "nonce", "id"], maxTokenAge: OIDC_TTL, clockTolerance: 5,
  });
  if (!matchesOidcState(typeof payload.nonce === "string" ? payload.nonce : null, attempt.nonce) ||
    typeof payload.sub !== "string" || !payload.sub ||
    typeof payload.id !== "number" || !Number.isSafeInteger(payload.id) || payload.id <= 0 ||
    (Array.isArray(payload.aud) && payload.aud.length !== 1 && payload.azp !== config.clientId) ||
    (payload.azp !== undefined && payload.azp !== config.clientId)) {
    throw new Error("invalid_telegram_claims");
  }
  // sub es opaco. Nunca usarlo como el id numérico que vincula las cuentas.
  const phoneE164 = payload.phone_number_verified === true && typeof payload.phone_number === "string"
    ? toE164(payload.phone_number) : null;
  return { telegramUserId: payload.id, phoneE164 };
}

/** El código lo consume Telegram UNA vez; sin retries automáticos. */
export async function exchangeTelegramCode(code: string, attempt: OidcAttempt, config: TelegramOidcConfig) {
  const response = await fetch(`${TELEGRAM_ISSUER}/token`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, client_id: config.clientId,
      redirect_uri: `${attempt.origin}${OIDC_CALLBACK_PATH}`, code_verifier: attempt.verifier,
    }),
  });
  if (!response.ok) throw new Error("telegram_code_rejected");
  const data = await response.json() as { id_token?: unknown };
  if (typeof data.id_token !== "string" || data.id_token.length > 16384) throw new Error("invalid_token_response");
  return verifyTelegramIdToken(data.id_token, attempt, config);
}
