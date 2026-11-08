// lib/auth/safe-return-to.ts — Sanitiza returnTo: SOLO paths internos.
//
// Un returnTo sin sanitizar es un open redirect: /login?returnTo=
// https://evil.com (phishing post-login con dominio de confianza en la
// barra). Reglas:
//   - debe empezar con "/" (path relativo al origin)
//   - NO "//" (protocol-relative → otro host)
//   - NO ":" (https:, javascript:, data:)
//   - NO "\" (browsers normalizan backslash a slash: "/\evil.com" se
//     vuelve "//evil.com" protocol-relative)
//   - NO caracteres <= U+0020 (tab, salto de línea, espacio, controles):
//     el parser de URL los elimina antes de resolver, así que "/\t/evil.com"
//     terminaba siendo "//evil.com" (auditoría de seguridad 2026-11-07)
//   - el valor resuelto contra un origin fijo debe quedar en ese origin
//
// Usado por: lib/supabase/middleware.ts (bounce de /login autenticado),
// app/(auth)/login/page.tsx (navegación post-OTP) y
// app/(auth)/onboarding/page.tsx (navegación post-onboarding).
const CHECK_ORIGIN = "https://return-to.invalid";

function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= 0x20) return true;
  }
  return false;
}

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes(":") ||
    raw.includes("\\") ||
    hasControlOrSpace(raw)
  ) {
    return null;
  }
  try {
    if (new URL(raw, CHECK_ORIGIN).origin !== CHECK_ORIGIN) return null;
  } catch {
    return null;
  }
  return raw;
}
