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
"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { formatCop } from "@/lib/casa/format";

export function CompartirPolla({
  slug,
  nombre,
  entradaCop,
}: {
  slug: string;
  nombre: string;
  entradaCop: number;
}) {
  const [copiado, setCopiado] = useState(false);

  function textoYUrl() {
    // Compartimos el dominio público, incluso desde localhost o un preview.
    // Conservamos Chicken Picks cuando la visita viene de su propio dominio.
    const english = ["chickenpicks.app", "www.chickenpicks.app"].includes(
      window.location.hostname,
    );
    const origin = english
      ? "https://chickenpicks.app"
      : "https://lapollacolombiana.com";
    const url = `${origin}/casa/${slug}`;
    const texto = english
      ? `Join ${nombre} on Chicken Picks.\nEntry: ${formatCop(entradaCop)} COP`
      : `Únete a ${nombre} en La Polla Colombiana.\nEntrada: ${formatCop(entradaCop)}`;
    return { url, texto };
  }

  async function compartir() {
    const { url, texto } = textoYUrl();
    // navigator.share es lo que abre la hoja nativa de Android/iOS con
    // WhatsApp de primero. En desktop casi nunca existe -> copiamos.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: nombre, text: texto, url });
        return;
      } catch (error) {
        // Cancelar no debe modificar el portapapeles del usuario.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${texto}\n${url}`);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    } catch {
      // clipboard puede fallar sin HTTPS o sin permiso. No hay tercer plan:
      // el link esta visible en la barra de direcciones.
    }
  }

  return (
    <button
      type="button"
      onClick={compartir}
      className="lp-btn lp-btn-ghost h-11 min-h-0 w-full text-[14px]"
      aria-label={`Compartir ${nombre}`}
    >
      {copiado ? (
        <>
          <Check className="h-4 w-4" aria-hidden="true" />
          Mensaje copiado
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
