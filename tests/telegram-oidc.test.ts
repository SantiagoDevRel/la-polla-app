import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
vi.mock("server-only", () => ({}));
import {
  getTelegramOidcConfig, matchesOidcState, newOidcAttempt, oidcAuthorizationUrl,
  oidcOrigin, readOidcAttempt, sealOidcAttempt, verifyTelegramIdToken, TELEGRAM_ISSUER,
} from "@/lib/auth/telegram-login/oidc";

const config = { clientId: "123456789", clientSecret: "test-secret-that-is-not-a-real-credential" };
const attempt = newOidcAttempt("https://lapollacolombiana.com", "/casa?tab=mis");
let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  keys = async () => pair.publicKey;
});
afterEach(() => vi.useRealTimers());

async function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({
    iss: TELEGRAM_ISSUER, aud: config.clientId, sub: "opaque-sub-not-the-id", id: 23456789,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
    nonce: attempt.nonce, phone_number: "+573001234567", phone_number_verified: true, ...claims,
  }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
}

describe("Telegram OIDC browser binding", () => {
  it("requires server credentials and allowlists callback origins", () => {
    expect(getTelegramOidcConfig({})).toBeNull();
    expect(oidcOrigin("https://attacker.example/login", {})).toBeNull();
    expect(oidcOrigin("https://lapollacolombiana.com/login", {})).toBe(attempt.origin);
    expect(oidcOrigin("http://localhost:3001/login", { NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3001" })).toBe("http://localhost:3001");
  });
  it("uses PKCE S256 and never sends the verifier or client secret to the browser URL", () => {
    const url = new URL(oidcAuthorizationUrl(attempt, config));
    expect(url.origin).toBe(TELEGRAM_ISSUER);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(attempt.state);
    expect(url.searchParams.get("nonce")).toBe(attempt.nonce);
    expect(url.searchParams.get("redirect_uri")).toBe(`${attempt.origin}/api/auth/telegram/oidc/callback`);
    expect(url.href).not.toContain(attempt.verifier);
    expect(url.href).not.toContain(config.clientSecret);
    expect(newOidcAttempt(attempt.origin).state).not.toBe(attempt.state);
  });
  it("encrypts the browser attempt, rejects tampering, other credentials and expiration", async () => {
    const cookie = await sealOidcAttempt(attempt, config);
    expect(cookie).not.toContain(attempt.verifier);
    expect(await readOidcAttempt(cookie, config)).toEqual(attempt);
    expect(await readOidcAttempt(cookie.slice(0, -5) + "XXXXX", config)).toBeNull();
    expect(await readOidcAttempt(cookie, { ...config, clientSecret: "different-secret" })).toBeNull();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 301_000);
    expect(await readOidcAttempt(cookie, config)).toBeNull();
  });
  it("rejects missing or foreign state and external return paths", () => {
    expect(matchesOidcState(null, attempt.state)).toBe(false);
    expect(matchesOidcState(newOidcAttempt(attempt.origin).state, attempt.state)).toBe(false);
    expect(matchesOidcState(attempt.state, attempt.state)).toBe(true);
    for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/\t/evil.test"]) {
      expect(newOidcAttempt(attempt.origin, path).returnTo).toBe("/inicio");
    }
  });
});

describe("Telegram signed identity", () => {
  it("uses signed numeric id, never the opaque sub, and requires verified phone", async () => {
    expect(await verifyTelegramIdToken(await token(), attempt, config, keys))
      .toEqual({ telegramUserId: 23456789, phoneE164: "+573001234567" });
    expect((await verifyTelegramIdToken(await token({ phone_number_verified: false }), attempt, config, keys)).phoneE164).toBeNull();
  });
  it.each([
    { iss: "https://evil.test" }, { aud: "other-client" }, { nonce: "wrong-nonce" },
    { id: "23456789" }, { id: -1 }, { exp: 1 }, { iat: 1 }, { sub: "" },
    { azp: "other-client" }, { aud: [config.clientId, "other"] },
  ])("rejects invalid signed claims %j", async (claims) => {
    await expect(verifyTelegramIdToken(await token(claims), attempt, config, keys)).rejects.toThrow();
  });
  it("rejects an attacker signature", async () => {
    const attacker = await generateKeyPair("RS256");
    const signed = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).sign(attacker.privateKey);
    await expect(verifyTelegramIdToken(signed, attempt, config, keys)).rejects.toThrow();
  });
});
