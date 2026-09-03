// components/layout/AppBackground.tsx — el fondo ambiente de la app.
//
// (2026-09-03) Este archivo dejo de hacer trabajo de servidor.
//
// Antes llamaba a `headers()` para elegir una variante de video AL AZAR en
// cada request. Dos problemas, los dos caros:
//   · Un video distinto por navegacion = el cache del browser no servia para
//     nada. Cada visita bajaba entre 0,8 y 2,4 MB otra vez.
//   · `headers()` opta a TODO el layout por render dinamico. O sea: la
//     aleatoriedad de una decoracion le estaba costando el render estatico a
//     la aplicacion entera.
//
// Ahora es un componente sin logica y la rotacion vive en el cliente, DESPUES
// de `load` (ver AppBackgroundClient). El primer video es siempre el mismo,
// asi que se cachea; los que rotan entran cuando ya no le quitan ancho de
// banda a nadie. Mientras tanto se ve el humo en CSS, que no cuesta bytes.

import { AppBackgroundClient } from "./AppBackgroundClient";
import type { BackgroundVariant } from "./background-variants";

export interface AppBackgroundProps {
  className?: string;
  /** Opacidad del velo oscuro sobre el video (0-1). El default 0.78 deja ver
   *  el movimiento y garantiza el contraste del texto que va encima. */
  overlayOpacity?: number;
  /** Forzar una variante (testing / pantallas tematicas). Si se pasa, no rota. */
  variant?: BackgroundVariant;
}

export function AppBackground({
  className,
  overlayOpacity,
  variant,
}: AppBackgroundProps) {
  return (
    <AppBackgroundClient
      variant={variant}
      className={className}
      overlayOpacity={overlayOpacity}
    />
  );
}

export default AppBackground;
