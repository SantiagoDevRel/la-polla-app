// tests/sms-captcha.test.ts — Captcha de Turnstile en el envío del SMS.
// La lógica de la ruta se prueba en auth-real-ip.test.ts («POST start-otp»).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCaptchaRejection, parseCaptchaToken } from "@/lib/auth/captcha";
import { CAPTCHA_FAILED_CODE } from "@/lib/auth/otp-codes";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("parseCaptchaToken", () => {
  it("acepta un token visible y lo recorta", () => {
    expect(parseCaptchaToken({ captchaToken: "  0.abc_DEF-123.xyz  " })).toBe("0.abc_DEF-123.xyz");
  });

  it.each([
    ["sin body", null],
    ["sin campo", { phone: "+57" }],
    ["no string", { captchaToken: 123 }],
    ["vacío", { captchaToken: "   " }],
    ["con espacios", { captchaToken: "a b" }],
    ["con control", { captchaToken: `a${String.fromCharCode(0)}b` }],
    ["no ASCII", { captchaToken: "tokén" }],
    ["demasiado largo", { captchaToken: "a".repeat(4097) }],
  ])("devuelve null: %s", (_label, body) => {
    expect(parseCaptchaToken(body)).toBeNull();
  });
});

describe("isCaptchaRejection", () => {
  it("reconoce el código y el mensaje de GoTrue", () => {
    expect(isCaptchaRejection({ status: 400, code: "captcha_failed", message: "x" })).toBe(true);
    expect(isCaptchaRejection({ status: 400, message: "captcha protection: request disallowed (x)" })).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(isCaptchaRejection(null)).toBe(false);
    expect(isCaptchaRejection({ status: 429, code: "over_request_rate_limit", message: "rate limit" })).toBe(false);
  });

  it("código estable compartido con el cliente", () => {
    expect(CAPTCHA_FAILED_CODE).toBe("captcha_failed");
  });
});

describe("contratos de la captcha", () => {
  it("start-otp no verifica el token por su cuenta (lo quemaría antes que Supabase)", () => {
    const source = read("app/api/auth/start-otp/route.ts");
    expect(source).not.toMatch(/verifyTurnstile|siteverify/);
    expect(source).toMatch(/captchaToken/);
  });

  it("Telegram no depende de la captcha", () => {
    for (const file of [
      "app/api/auth/telegram/request/route.ts",
      "lib/auth/telegram-login/handler.ts",
      "lib/auth/telegram-login/session.ts",
    ]) {
      expect(read(file)).not.toMatch(/captcha|turnstile/i);
    }
  });

  it("el widget solo se monta en el paso del SMS de /login", () => {
    const login = read("app/(auth)/login/LoginClient.tsx");
    expect(login.match(/<SmsCaptcha\b/g)).toHaveLength(1);
    const telegramStart = login.indexOf('{step === "telegram"');
    expect(login.indexOf("<SmsCaptcha")).toBeLessThan(login.indexOf('{step === "otp"'));
    expect(telegramStart).toBeGreaterThan(0);
  });

  it("la CSP permite a Turnstile en script-src y frame-src", () => {
    const config = read("next.config.mjs");
    expect(config).toMatch(/script-src[^"]*https:\/\/challenges\.cloudflare\.com/);
    expect(config).toMatch(/frame-src[^"]*https:\/\/challenges\.cloudflare\.com/);
  });
});
