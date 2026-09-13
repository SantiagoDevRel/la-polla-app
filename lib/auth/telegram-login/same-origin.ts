// lib/auth/telegram-login/same-origin.ts — Defensa CSRF para POST de login.
// Un navegador moderno manda Sec-Fetch-Site; si dice otra cosa que
// same-origin, se rechaza. Si llega Origin, su host tiene que ser el mismo del
// request. Clientes sin esos headers (navegadores viejos) siguen protegidos por
// la exigencia de application/json, que fuerza preflight entre orígenes.

type HeaderBag = { headers: { get(name: string): string | null } };

export function isSameOriginRequest(request: HeaderBag): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (origin) {
    const host = (request.headers.get("host") ?? "").toLowerCase();
    try {
      if (new URL(origin).host.toLowerCase() !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
