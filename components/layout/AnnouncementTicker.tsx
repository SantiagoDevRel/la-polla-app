// components/layout/AnnouncementTicker.tsx — Cinta de advertencia roja
// con texto en marquee infinito + botón X para cerrarla, debajo del
// BrandHeader. Nació del feedback "¿hasta qué hora se pueden poner los
// marcadores?" (2026-06-11): recuerda que los pronósticos cierran 5
// minutos antes de cada partido.
//
// Dismiss persistente: al cerrar se guarda DISMISS_KEY en localStorage
// y no vuelve a aparecer en ese browser. Para lanzar un aviso NUEVO en
// el futuro, cambiá DISMISS_KEY (ej. sumar fecha/slug) y todos lo ven
// de nuevo aunque hayan cerrado el anterior.
//
// SSR: arranca oculta y se muestra post-mount si no está dismisseada —
// evita hydration mismatch y el flash para quienes ya la cerraron.
//
// Marquee CSS-only (keyframes ticker-scroll en globals.css): el track
// tiene 2 mitades idénticas y anima translateX(-50%), loop seamless.
// Cada mitad repite el mensaje 4 veces para cubrir anchos grandes.
// prefers-reduced-motion → texto estático (animation: none).
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTranslations } from "next-intl";

// "10min" en el mensaje a propósito (el lock real es 5 min): margen para
// que nadie llegue a los 6 minutos y se queje de que "decía 5".
const DISMISS_KEY = "lp_ticker_dismissed:pred-deadline-10min";

export default function AnnouncementTicker() {
  const t = useTranslations("Ticker");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) !== "1") {
        setVisible(true);
      }
    } catch {
      // localStorage bloqueado (modo privado estricto) → mostrar igual.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const msg = t("predictionDeadline");
  const copies = [0, 1, 2, 3];

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Sin storage no persiste, pero al menos se cierra esta sesión.
    }
  }

  return (
    <div
      className="relative overflow-hidden bg-red-alert text-white h-[34px] flex items-center"
      role="status"
      aria-label={msg}
    >
      <div className="flex whitespace-nowrap animate-ticker" aria-hidden="true">
        {[0, 1].map((half) => (
          <div key={half} className="flex shrink-0">
            {copies.map((i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 px-5 text-[12px] font-semibold uppercase tracking-[0.06em]"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                {msg}
              </span>
            ))}
          </div>
        ))}
      </div>
      {/* X de cierre: fade rojo a la izquierda para que el texto del
          marquee "desaparezca" suave debajo del botón. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismissAria")}
        className="absolute right-0 top-0 h-full w-11 flex items-center justify-end pr-2.5 bg-gradient-to-l from-red-alert via-red-alert/90 to-transparent cursor-pointer active:scale-90 transition-transform duration-150"
      >
        <X className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
