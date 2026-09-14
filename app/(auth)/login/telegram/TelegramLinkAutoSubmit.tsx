// app/(auth)/login/telegram/TelegramLinkAutoSubmit.tsx — Envía solo el canje
// cuando el servidor ya comprobó que este navegador es el que pidió el ingreso
// (cookie propia): no hay nada que confirmar. Sin JS, el botón de <noscript>
// hace lo mismo; si el envío no arrancó en unos segundos, aparece el botón.
"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn } from "lucide-react";
import { PRIMARY_BTN, PRIMARY_GLOW } from "@/components/auth/login-styles";

export default function TelegramLinkAutoSubmit({
  action,
  token,
  label,
}: {
  action: string;
  token: string;
  label: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  // Un solo envío: un segundo POST del mismo token volvería «ya se usó» (en
  // desarrollo, StrictMode monta el efecto dos veces).
  const submitted = useRef(false);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    if (!submitted.current) {
      submitted.current = true;
      form.current?.submit();
    }
    const timer = window.setTimeout(() => setShowButton(true), 4_000);
    return () => window.clearTimeout(timer);
  }, []);

  const button = (
    <button type="submit" className={PRIMARY_BTN} style={PRIMARY_GLOW}>
      <LogIn className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );

  return (
    <form ref={form} method="post" action={action} data-testid="telegram-link-auto">
      <input type="hidden" name="t" value={token} />
      {showButton ? button : <noscript>{button}</noscript>}
    </form>
  );
}
