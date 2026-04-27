// components/layout/BrandHeader.tsx — Header global de marca para todas
// las páginas dentro de (app)/. Sticky arriba, con el wordmark tricolor,
// el pollito-pibe líder y el botón flotante de WhatsApp para chatear con
// el bot. Originalmente vivía solo en /inicio; lo extraemos al layout
// para que la marca no desaparezca cuando el user navega a /pollas, /avisos,
// /perfil, etc.
"use client";

import WhatsAppBubble from "@/components/shared/WhatsAppBubble";
import ReportProblemBubble from "@/components/shared/ReportProblemBubble";

export default function BrandHeader() {
  return (
    <header
      className="sticky top-0 z-40 px-4 pt-4 pb-3 backdrop-blur-md"
      style={{
        // Slightly translucent background so what scrolls underneath
        // gets a subtle blur, but the header itself stays readable.
        background: "rgba(8, 12, 16, 0.85)",
      }}
    >
      <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pollitos/pollito_pibe_lider.webp"
            alt=""
            width={44}
            height={44}
            style={{ objectFit: "contain" }}
          />
          <span
            className="font-display leading-none tracking-[0.04em] flex items-baseline gap-[5px]"
            style={{
              fontSize: 20,
              textShadow: "0 2px 6px rgba(0,0,0,0.55)",
            }}
          >
            <span style={{ color: "#FFD700" }}>LA</span>
            <span style={{ color: "#2F6DF4" }}>POLLA</span>
            <span style={{ color: "#E4463A" }}>COLOMBIANA</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ReportProblemBubble size={34} />
          <WhatsAppBubble size={34} />
        </div>
      </div>
    </header>
  );
}
