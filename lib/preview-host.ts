import { headers } from "next/headers";

// La bracket "Road to World Cup" está EN TESTING: se muestra SOLO en hosts
// de preview (los *.vercel.app de Vercel + localhost), NUNCA en los dominios
// reales de producción (lapollacolombiana.com / chickenpicks.app). Así la
// probamos en lapollacolombiana.vercel.app sin que los usuarios reales la
// vean todavía. Cuando esté lista, se quita este gate.
export function isPreviewHost(): boolean {
  const host = (headers().get("host") ?? "").toLowerCase();
  if (!host) return false;
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return true;
  if (host.endsWith("lapollacolombiana.com")) return false;
  if (host.endsWith("chickenpicks.app")) return false;
  return host.endsWith(".vercel.app");
}
