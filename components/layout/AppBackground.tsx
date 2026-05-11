// components/layout/AppBackground.tsx — Ambient background, server picker.
//
// Server component que en CADA request elige uno de los 5 videos del pool
// (ver background-variants.ts) y renderea el client renderer con esa
// variant. Asi:
//   - El SSR HTML ya trae el poster correcto horneado: primer frame se
//     ve al instante, sin flash a negro mientras carga el JS.
//   - Cada refresh = nuevo render server = nuevo video random.
//   - Cero "play button" nativo: el client intenta autoplay, si falla
//     queda con la imagen estatica.
//
// Forzamos render dinamico via `headers()` para que Next no estatice el
// layout y termine sirviendo siempre el mismo video.

import { headers } from "next/headers";
import { AppBackgroundClient } from "./AppBackgroundClient";
import { pickRandomVariant, type BackgroundVariant } from "./background-variants";

export interface AppBackgroundProps {
  className?: string;
  /** Opacity del overlay negro sobre el video (0-1). Default 0.78
   *  mantiene la motion visible y garantiza contraste de texto. */
  overlayOpacity?: number;
  /** Forzar una variant especifica (testing / pages tematicas).
   *  Si se omite, el server elige random por request. */
  variant?: BackgroundVariant;
}

export async function AppBackground({
  className,
  overlayOpacity,
  variant,
}: AppBackgroundProps) {
  // Llamar `headers()` opta el render por request (no estatico). Sin esto
  // Next puede cachear el HTML del layout y servir el mismo video a todos.
  await headers();
  const picked = variant ?? pickRandomVariant();

  return (
    <AppBackgroundClient
      variant={picked}
      className={className}
      overlayOpacity={overlayOpacity}
    />
  );
}

export default AppBackground;
