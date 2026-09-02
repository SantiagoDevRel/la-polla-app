// components/layout/AppBackground.tsx — el fondo ambiente de la app.
//
// (2026-09-02) VUELVE el estadio. Entre agosto y hoy esto fue un plano negro
// con una caida de luz, y esa pantalla es exactamente la que el dueño llamo
// "basica": sin el fondo, cada tarjeta flota sobre la nada y la app pierde la
// unica capa que le daba profundidad.
//
// Lo que SI era cierto de la objecion vieja (y por eso no se revierte a ciegas)
// es el costo en datos moviles. Se resuelve en el cliente, no matando el
// fondo: el poster (~80 kB) se pinta siempre y el video solo arranca si la
// conexion lo aguanta — ver el guard de Save-Data en AppBackgroundClient.
// Asi el que tiene wifi ve el estadio y el que anda con 3G ve la foto.
//
// Server component que en CADA request elige uno de los 5 videos del pool
// (ver background-variants.ts) y renderea el client renderer con esa variant:
//   - El SSR HTML ya trae el poster correcto horneado: primer frame al
//     instante, sin flash a negro mientras carga el JS.
//   - Cada refresh = nuevo render server = nuevo video.
//   - Cero "play button" nativo: el client intenta autoplay; si falla, queda
//     con la imagen estatica.
//
// Forzamos render dinamico via `headers()` para que Next no estatice el layout
// y termine sirviendo siempre el mismo video.

import { headers } from "next/headers";
import { AppBackgroundClient } from "./AppBackgroundClient";
import { pickRandomVariant, type BackgroundVariant } from "./background-variants";

export interface AppBackgroundProps {
  className?: string;
  /** Opacidad del velo oscuro sobre el video (0-1). El default 0.78 deja ver
   *  el movimiento y garantiza el contraste del texto que va encima. */
  overlayOpacity?: number;
  /** Forzar una variant especifica (testing / pantallas tematicas). Si se
   *  omite, el server elige una por request. */
  variant?: BackgroundVariant;
}

export async function AppBackground({
  className,
  overlayOpacity,
  variant,
}: AppBackgroundProps) {
  // Llamar `headers()` opta el render por request (no estatico). Sin esto Next
  // puede cachear el HTML del layout y servirle el mismo video a todos.
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
