// lib/auth/telegram-login/same-origin.ts — Defensa CSRF para POST de login.
// Un navegador moderno manda Sec-Fetch-Site; si dice otra cosa que
// same-origin, se rechaza. Si llega Origin, su host tiene que ser el mismo del
// request. Clientes sin esos headers (navegadores viejos) siguen protegidos por
// la exigencia de application/json, que fuerza preflight entre orígenes.
//
// requireProof: para POST de formulario (que otro sitio SÍ puede mandar sin
// preflight) no basta con que no haya señal contraria; tiene que llegar
// Sec-Fetch-Site: same-origin u Origin del mismo host.

type HeaderBag = { headers: { get(name: string): string | null } };

export function isSameOriginRequest(
  request: HeaderBag,
  options: { requireProof?: boolean } = {},
): boolean {
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

  if (options.requireProof && fetchSite !== "same-origin" && !origin) return false;
  return true;
}
