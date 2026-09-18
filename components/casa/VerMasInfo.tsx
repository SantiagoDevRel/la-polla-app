"use client";

// components/casa/VerMasInfo.tsx — «Ver más»: abre Info en la regla exacta.
//
// La pantalla de la polla ya no explica nada fuera de Info. Donde antes iba un
// párrafo, va este botón: quien quiere el detalle lo abre con un toque, y quien
// viene a pronosticar no lo lee. PollaTabs escucha el evento, cambia de pestaña
// y despliega la regla.

import { ChevronRight } from "lucide-react";
import { INFO_EVENT, infoAnchor, type InfoSection } from "@/lib/casa/info-sections";

export function VerMasInfo({ section, children = "Ver más", className = "" }: {
  section: InfoSection;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(INFO_EVENT, { detail: infoAnchor(section) }))}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-0.5 text-[13px] font-semibold text-text-secondary underline-offset-4 transition-colors hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${className}`}
    >
      {children}
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
    </button>
  );
}
