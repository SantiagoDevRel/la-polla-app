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

export function CompartirPolla({
  slug,
  nombre,
  entradaCop,
  pozoCop,
}: {
  slug: string;
  nombre: string;
  entradaCop: number;
  pozoCop: number;
}) {
  const [copiado, setCopiado] = useState(false);

  function textoYUrl() {
    // Se arma en el cliente y no en el server a proposito: el link tiene que
    // ser el del host por el que la persona esta navegando (hay dos dominios,
    // lapollacolombiana.com y chickenpicks.app) y no uno horneado en build.
    const url = `${window.location.origin}/casa/${slug}`;
    const cop = (n: number) =>
      new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n);
    const texto =
      pozoCop > 0
        ? `${nombre}\nEntrada ${cop(entradaCop)} · pozo ${cop(pozoCop)}\n${url}`
        : `${nombre}\nEntrada ${cop(entradaCop)}\n${url}`;
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
      } catch {
        // El usuario cancelo la hoja nativa, o el navegador la rechazo.
        // En los dos casos copiar es un fallback razonable, no un error.
      }
    }
    try {
      await navigator.clipboard.writeText(texto);
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
          Link copiado
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
