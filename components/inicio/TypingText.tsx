// components/inicio/TypingText.tsx — Efecto máquina de escribir.
//
// Revela el texto char-by-char al montar (o sea, cada vez que /inicio se
// refresca o se vuelve a montar). Usado por WorldCupFactsCard para que los
// datos curiosos "tipeen" al cargar.
//
// • Anti-layout-shift: un sizer invisible con el texto completo reserva el
//   alto/wrapping final; el texto tipeado se posiciona encima → la card no
//   salta mientras escribe.
// • Accesible: el contenedor lleva aria-label con el texto completo y los
//   spans visibles son aria-hidden (el lector no escucha letra por letra).
// • Respeta prefers-reduced-motion: si está activo, muestra todo de una.
"use client";

import { useEffect, useState } from "react";

interface TypingTextProps {
  text: string;
  /** ms por caracter. */
  speed?: number;
  /** ms antes de empezar (para escalonar varias líneas). */
  startDelay?: number;
  className?: string;
}

export function TypingText({ text, speed = 16, startDelay = 0, className }: TypingTextProps) {
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setCount(text.length);
      setDone(true);
      return;
    }

    setCount(0);
    setDone(false);
    let i = 0;
    let tickTimer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setCount(i);
      if (i < text.length) {
        tickTimer = setTimeout(tick, speed);
      } else {
        setDone(true);
      }
    };
    const startTimer = setTimeout(tick, startDelay);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(tickTimer);
    };
  }, [text, speed, startDelay]);

  return (
    <span className={`relative inline-block ${className ?? ""}`} aria-label={text}>
      {/* Sizer invisible: reserva alto + wrapping del texto completo. */}
      <span className="invisible" aria-hidden="true">
        {text}
      </span>
      {/* Texto tipeado, encima del sizer (mismo ancho → mismo wrap). */}
      <span className="absolute inset-0" aria-hidden="true">
        {text.slice(0, count)}
        {!done ? (
          <span className="ml-[1px] inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-text-primary/70 align-middle" />
        ) : null}
      </span>
    </span>
  );
}
