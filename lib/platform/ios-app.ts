// lib/platform/ios-app.ts
//
// Detecta si la request actual viene de la app iOS (Capacitor WebView).
// Se usa para renderizar UI genérica (sin logos de ligas, sin crests de
// clubes) en iOS, mientras web y Android ven la UI normal con branding.
//
// Detección por dos vías:
//   1. User-Agent — capacitor.config.ts setea appendUserAgent "LaPollaIOS/..."
//      en el wrapper iOS real. Producción.
//   2. Cookie `lp_ios_preview=1` — para preview local desde browser, se
//      activa visitando cualquier URL con ?ios=1 (middleware setea cookie).
//
// Server-only. Para client components ver `components/platform/PlatformProvider`.

import { headers } from "next/headers";

const UA_MARKER = "LaPollaIOS";
const PREVIEW_COOKIE = "lp_ios_preview";

export function isIOSAppRequest(): boolean {
  const h = headers();
  const ua = h.get("user-agent") ?? "";
  if (ua.includes(UA_MARKER)) return true;
  const cookie = h.get("cookie") ?? "";
  // match cookie "lp_ios_preview=1" en cualquier posición de la cookie header
  return new RegExp(`(?:^|;\\s*)${PREVIEW_COOKIE}=1(?:;|$)`).test(cookie);
}
