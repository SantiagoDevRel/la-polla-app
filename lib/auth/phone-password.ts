import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const PASSWORD_ATTEMPTS = { phone15Minutes: 5, phoneDay: 20, ip15Minutes: 50 } as const;
export const validPhonePassword = (value: unknown): value is string =>
  typeof value === "string" && /^\d{6}$/.test(value);

function derive(password: string, salt: string): Promise<Buffer> {
  const pepper = process.env.AUTH_PIN_PEPPER ?? "";
  if (pepper.length < 32) throw new Error("password_not_configured");
  const input = createHmac("sha256", pepper).update(password).digest();
  return new Promise((resolve, reject) => scrypt(input, Buffer.from(salt, "hex"), 64,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}

export async function hashPhonePassword(password: string) {
  if (!validPhonePassword(password)) throw new Error("invalid_password");
  const salt = randomBytes(16).toString("hex");
  return { salt, password_hash: (await derive(password, salt)).toString("hex") };
}

export async function verifyPhonePassword(password: string, credential: { salt: string; password_hash: string } | null) {
  // Unknown accounts do the same expensive work and receive the same error.
  const valid = credential && /^[a-f0-9]{32}$/.test(credential.salt) && /^[a-f0-9]{128}$/.test(credential.password_hash);
  const actual = await derive(password, valid ? credential.salt : "0".repeat(32));
  const expected = Buffer.from(valid ? credential.password_hash : "0".repeat(128), "hex");
  return timingSafeEqual(actual, expected) && Boolean(valid);
}

export function passwordIpKey(ip: string): string {
  return createHmac("sha256", process.env.AUTH_PIN_PEPPER ?? "").update(`password-ip:${ip}`).digest("hex");
}
