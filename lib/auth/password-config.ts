import "server-only";

export function phonePasswordEnabled(): boolean {
  return process.env.PHONE_PASSWORD_ENABLED === "true" &&
    (process.env.AUTH_PIN_PEPPER ?? "").length >= 32;
}
