// components/layout/BrandHeader.tsx — la marca, arriba, en todas las pantallas.
//
// (2026-09-02) Vuelve el header de Tribuna Caliente. El interludio "Parche"
// lo habia dejado monocromo, sobre una barra opaca, con el pollito reducido a
// 26px "de firma". El resultado era un encabezado que podia ser el de
// cualquier app: sin bandera, sin mascota y sin el fondo asomandose.
//
// Lo que vuelve, y por que:
//   · Pollito a 40px. Es LA marca de este producto, no una firma al pie.
//     (40 y no los 44 originales: con el text-zoom de accesibilidad al 200%
//     los 44 empujaban el wordmark contra las burbujas.)
//   · Wordmark tricolor — oro/azul/rojo es la bandera, y es lo que hace que
//     se lea "colombiana" antes de leer la palabra.
//   · Barra translucida con blur en vez de opaca: deja ver el estadio
//     pasando por debajo al hacer scroll, que es la capa que da profundidad.
"use client";

import { useTranslations } from "next-intl";
import ReportProblemBubble from "@/components/shared/ReportProblemBubble";

export default function BrandHeader() {
  const t = useTranslations("Brand");
  const part1 = t("wordmarkPart1");
  const part2 = t("wordmarkPart2");
  const part3 = t("wordmarkPart3");

  return (
    <header
      className="sticky top-0 z-40 px-4 pb-3 pt-3.5 backdrop-blur-md"
      style={{
        // Translucido a proposito: lo que scrollea por debajo se difumina
        // pero el estadio sigue insinuandose. Opaco mataba esa capa.
        background: "rgba(8, 12, 16, 0.85)",
      }}
    >
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        {/* min-w-0 + overflow-hidden: con el text-zoom de accesibilidad el
            wordmark crecia y se metia DEBAJO de las burbujas (feedback real
            2026-06-11). Preferimos clipearlo antes que dejar que se monte. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          {/* Responsive a proposito: a 390px (el ancho real de la mayoria)
              el wordmark entra con 50px de sobra, pero a 320px — un iPhone SE
              — se comia la ultima "A" de COLOMBIANA. Bajar el pollito a 32 y
              el texto a 17 recupera los ~57px que faltaban, y arriba de 360
              todo vuelve al tamano pleno.

              (2026-09-03) El archivo pesaba 116 KB (1024x1024) y aca se dibuja a 40 px:
              el browser bajaba los 116 KB enteros para escalarlos hacia
              abajo, en TODAS las pantallas porque el header es global. Ahora
              apunta a la variante de 128 px, que pesa 6,6 KB.
              NO se usa next/image a proposito: en Vercel consume cuota de
              Image Optimization, y el repo tiene regla dura de free-tier.
              Un archivo ya del tamano correcto no gasta nada. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pollitos/pollito_pibe_lider-128.webp"
            alt=""
            width={40}
            height={40}
            className="h-8 w-8 max-w-none shrink-0 object-contain min-[360px]:h-10 min-[360px]:w-10"
          />
          <span className="lp-stencil flex items-baseline gap-[5px] whitespace-nowrap text-[17px] min-[360px]:text-[20px]">
            {part3 ? (
              <>
                {/* Tricolor — los colores de la bandera. */}
                <span className="text-gold">{part1}</span>
                <span style={{ color: "#2F6DF4" }}>{part2}</span>
                <span style={{ color: "#E4463A" }}>{part3}</span>
              </>
            ) : (
              // Locales sin la metafora de la bandera: todo en el acento.
              <>
                <span className="text-gold">{part1}</span>
                <span className="text-gold">{part2}</span>
              </>
            )}
          </span>
        </div>

        {/* (2026-09-02) Se fue el boton de WhatsApp. Decision del dueno: "por
            ahora nada de bots, solo la UI del website" — el bot del backend
            sigue existiendo, lo que se quita es la puerta de entrada desde el
            header. WhatsAppBubble no se borro, quedo sin usar por si vuelve.
            OJO: esto NO es el boton de WhatsApp del /login, que es el segundo
            metodo de acceso a la cuenta cuando el SMS falla.
            Se cae el gap-2 porque ya no hay dos burbujas que separar; el
            flex-shrink-0 se queda porque con el text-zoom de accesibilidad es
            lo que evita que el wordmark aplaste la burbuja. */}
        <div className="flex flex-shrink-0 items-center">
          <ReportProblemBubble size={34} />
        </div>
      </div>
    </header>
  );
}
