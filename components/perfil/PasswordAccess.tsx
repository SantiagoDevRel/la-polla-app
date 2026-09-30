"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { KeyRound } from "lucide-react";

export default function PasswordAccess() {
  const en = useLocale() === "en";
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch("/api/auth/password", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { enabled: boolean } = await response.json();
        setEnabled(data.enabled);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  if (enabled === false) return null;
  return <section className="lp-card space-y-3 p-4" aria-labelledby="profile-password-title">
    <h2 id="profile-password-title" className="flex items-center gap-2 text-base font-semibold leading-snug text-text-primary">
      <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />{en ? "Password" : "Contraseña"}
    </h2>
    <p className="text-sm leading-relaxed text-text-secondary">{en
      ? "Create a 6-digit password or change the one you use to sign in. If you forget it, you can sign in by WhatsApp or SMS."
      : "Crea una contraseña de 6 dígitos o cambia la que usas para ingresar. Si la olvidas, puedes entrar por WhatsApp o SMS."}</p>
    {enabled && <Link href="/set-password?returnTo=%2Fperfil"
      className="flex min-h-11 w-full items-center justify-center rounded-full border border-border-default px-4 py-3 text-center text-sm font-semibold leading-snug text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
      {en ? "Create or change password" : "Crear o cambiar contraseña"}
    </Link>}
    {enabled === null && !error && <div className="h-12 animate-pulse rounded-xl bg-bg-elevated" role="status" aria-label={en ? "Loading" : "Cargando"} />}
    {error && <div role="alert" className="space-y-2 text-sm leading-relaxed text-red-alert">
      <p>{en ? "Could not load this option." : "No pudimos cargar esta opción."}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 cursor-pointer underline hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{en ? "Try again" : "Reintentar"}</button>
    </div>}
  </section>;
}
