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
//
// Usado por: lib/supabase/middleware.ts (bounce de /login autenticado),
// app/(auth)/login/page.tsx (navegación post-OTP) y
// app/(auth)/onboarding/page.tsx (navegación post-onboarding).
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes(":") ||
    raw.includes("\\")
  ) {
    return null;
  }
  return raw;
}
