// components/layout/AppBackground.tsx — el fondo de la app.
//
// PARCHE v1.0 (2026-08-25): antes esto era un video de estadio en loop con
// el pollito gigante de fondo. Se sacó por dos razones concretas:
//   1. Peleaba con el skin nuevo. Todo el lenguaje es plano, duro y de alto
//      contraste; un video con blur encima convierte cada tarjeta en un
//      sticker flotando y devuelve el look "burbuja" que justamente se quiso
//      matar.
//   2. Pesaba. 5 variantes de video en una app que se usa en la calle, con
//      datos móviles, en teléfonos de gama media.
//
// Queda un fondo de concreto: negro profundo, una caída de luz muy sutil
// arriba (como el resplandor de un reflector lejano) y el grano que ya define
// globals.css. Sin video, sin blur, sin autoplay.
//
// Los archivos de video siguen en /public/videos por si se quieren usar en
// otro lado; simplemente ya nadie los pide.

interface AppBackgroundProps {
  className?: string;
  /** Se acepta por compatibilidad con los llamados existentes; ya no aplica. */
  overlayOpacity?: number;
  variant?: string;
}

export function AppBackground({ className }: AppBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 bg-bg-base ${className ?? ""}`}
    >
      {/* Caída de luz superior. Muy tenue: da profundidad sin ensuciar el
          contraste del texto que va encima. */}
      <div
        className="absolute inset-x-0 top-0 h-[46vh]"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 0%, rgba(216,255,71,0.055) 0%, rgba(216,255,71,0.018) 34%, transparent 68%)",
        }}
      />
      {/* Piso: refuerza el negro abajo para que el nav flotante despegue. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[30vh]"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </div>
  );
}

export default AppBackground;
