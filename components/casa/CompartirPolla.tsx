// components/casa/CompartirPolla.tsx — pasar la polla al grupo de WhatsApp.
//
// POR QUE EXISTE (2026-09-02): no habia forma de compartir una polla. Un grep
// de share/compartir/invitar/clipboard sobre components/casa, app/(app)/casa y
// components/street daba CERO. Despues de publicar, el admin quedaba mirando la
// pantalla sin nada que copiar, y la casa vive de que la gente entre.
//
// Va de la mano del cambio en lib/supabase/middleware.ts que deja /casa/<slug>
// abierta sin sesion: sin eso el link que se pega en el grupo manda a /login y
// el que no tiene cuenta no ve ni de que se trata.
//
// Con `codigo`, el enlace lleva la invitación de quien comparte.
// (2026-09-20) Se comparte solo ese enlace, sin texto promocional.
"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import type { PremioCompartir } from "@/lib/casa/share-text";
import { referralLink } from "@/lib/casa/referrals-shared";
import { shareLink } from "@/lib/casa/share-link";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { useToast } from "@/components/ui/Toast";

export function CompartirPolla({
  slug,
  nombre,
  codigo = null,
  ayuda,
  variant = "ghost",
  className = "w-full",
}: {
  slug: string;
  nombre: string;
  entradaCop: number;
  /** Premio fijo u objeto; null en pozo proporcional (solo se anuncia la entrada). */
  premio?: PremioCompartir;
  /** Código de invitación de quien comparte; null = enlace sin código. */
  codigo?: string | null;
  /** Explicación al pasar el cursor (la regla de invitaciones). */
  ayuda?: string;
  /**
   * Principal solo donde compartir es la acción de la pantalla (el aviso de
   * invitaciones). `icon` (2026-09-18): botón redondo de 44 px para el
   * encabezado de quien ya está inscrito, donde un botón a todo el ancho
   * empujaba los partidos fuera del primer pantallazo.
   */
  variant?: "ghost" | "primary" | "icon";
  /** Ancho/flex según dónde va: sola ocupa toda la fila; junto al CTA se reparte. */
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const { showToast } = useToast();
  // En la app de iOS no hay invitaciones (como en Perfil): el enlace va sin código.
  const isIOSApp = useIsIOSApp();
  const code = isIOSApp ? null : codigo;
  const tip = isIOSApp ? undefined : ayuda;

  function enlace() {
    // Compartimos el dominio público, incluso desde localhost o un preview.
    // Conservamos Chicken Picks cuando la visita viene de su propio dominio.
    const english = ["chickenpicks.app", "www.chickenpicks.app"].includes(
      window.location.hostname,
    );
    const origin = english
      ? "https://chickenpicks.app"
      : "https://lapollacolombiana.com";
    return referralLink(origin, slug, code);
  }

  async function compartir() {
    try {
      if (await shareLink(enlace()) !== "copied") return;
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    } catch {
      showToast("No pudimos compartir el enlace. Intenta de nuevo.", "error");
    }
  }

  if (variant === "icon") return (
    <button
      type="button"
      onClick={compartir}
      title={copiado ? "Enlace copiado" : "Compartir"}
      aria-label={copiado ? "Enlace copiado" : `Compartir ${nombre}${tip ? `. ${tip}` : ""}`}
      className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border bg-bg-card/80 backdrop-blur-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-95 ${copiado ? "border-turf/60 text-turf" : "border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary"}`}
    >
      {copiado ? <Check className="h-5 w-5" aria-hidden="true" /> : <Share2 className="h-5 w-5" aria-hidden="true" />}
    </button>
  );

  return (
    <button
      type="button"
      onClick={compartir}
      title={tip}
      className={`lp-btn ${variant === "primary" ? "lp-btn-primary" : "lp-btn-ghost"} !px-4 ${className}`}
      aria-label={`Compartir ${nombre}${tip ? `. ${tip}` : ""}`}
    >
      {copiado ? (
        <>
          <Check className="h-4 w-4" aria-hidden="true" />
          Enlace copiado
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Compartir
        </>
      )}
    </button>
  );
}

export default CompartirPolla;
