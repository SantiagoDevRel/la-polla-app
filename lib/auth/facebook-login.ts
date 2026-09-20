// lib/auth/facebook-login.ts — Entrada por Facebook (migración 145).
//
// El proveedor lo administra Supabase Auth (App ID y secreto viven allá, no
// en este repo). Acá solo queda la decisión de MOSTRAR la opción y la ruta de
// vuelta, para que el login no ofrezca un botón que el proyecto no tiene
// configurado.
//
// FACEBOOK_LOGIN_ENABLED es una variable de servidor a propósito: la lee
// `app/(auth)/login/page.tsx` (Server Component) y le pasa un booleano al
// cliente. Así prender o apagar la opción es env + redeploy, sin tocar código
// ni incrustar nada en el bundle.
//
// La vuelta va bajo /api/auth/* por dos razones concretas, no por gusto:
// el middleware ya trata ese prefijo como público (`publicRoutes`) y el
// service worker ya lo marca NetworkOnly (`NEVER_CACHE_PATHS`), así que la
// ruta nace sin poder servirse desde caché ni redirigir a /login.

/** Ruta que recibe el `code` de Facebook y abre la sesión. */
export const FACEBOOK_CALLBACK_PATH = "/api/auth/facebook/callback";

/** Proveedor tal como lo nombra Supabase Auth. */
export const FACEBOOK_PROVIDER = "facebook" as const;

/** ¿Este despliegue ofrece la entrada por Facebook? */
export function isFacebookLoginEnabled(): boolean {
  return (process.env.FACEBOOK_LOGIN_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * URL completa de vuelta, con el destino posterior colgado como `next`.
 * Facebook devuelve a esta URL exacta, así que tiene que estar en la lista de
 * redirecciones permitidas del proyecto de Supabase (Authentication → URL
 * Configuration), incluida la del preview.
 */
export function facebookRedirectUrl(origin: string, next?: string | null): string {
  const url = new URL(FACEBOOK_CALLBACK_PATH, origin);
  if (next) url.searchParams.set("next", next);
  return url.toString();
}
