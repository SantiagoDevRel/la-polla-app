// lib/supabase/cookie-options.ts — Atributos de las cookies de sesión.
//
// Una sola fuente para las cookies sb-*-auth-token (los cuatro clientes de
// @supabase/ssr: navegador, servidor, middleware y el de Auth con IP real) y
// para la cookie de atajo lp_onb. @supabase/ssr las mezcla con sus defaults
// (path "/", sameSite "lax", maxAge 400 días, httpOnly false).
//
// Reglas (CLAUDE.md, "Auth: cookies host-only + signOut global"):
//   · secure en producción: el token de sesión nunca viaja por http plano.
//     En `next dev` (http://localhost) queda sin Secure para no romper el login
//     local.
//   · Sin `domain`: host-only a propósito. www → apex lo resuelve el 308 del
//     middleware; un Domain= compartiría la sesión con cualquier subdominio.
//   · Sin httpOnly en sb-*: el cliente del navegador (lib/supabase/client.ts,
//     usado en Perfil y Onboarding) lee y refresca la sesión desde
//     document.cookie. Marcarlas httpOnly lo dejaría sin sesión. lp_onb sí es
//     httpOnly porque solo la lee el middleware.
//
// `nodeEnv` se lee como `process.env.NODE_ENV` literal para que Next lo
// reemplace también en el bundle del navegador.

export type SessionCookieOptions = {
  path: "/";
  sameSite: "lax";
  secure: boolean;
};

export function sessionCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): SessionCookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    secure: nodeEnv === "production",
  };
}

/** lp_onb: atajo del gate de onboarding, 30 días, solo servidor. */
export function onboardingCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return {
    ...sessionCookieOptions(nodeEnv),
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  };
}

/** lp_ref: código del primer enlace de invitación (migración 135), 30 días, solo servidor. */
export function referralCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return onboardingCookieOptions(nodeEnv);
}
