"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { KeyRound } from "lucide-react";
import ProfileSectionHeading from "./ProfileSectionHeading";

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
  return <section className="lp-card space-y-3 border-profile-security/40 bg-profile-security/10 p-4 hover:border-profile-security/60" aria-labelledby="profile-password-title">
    <ProfileSectionHeading icon={KeyRound} tone="security" id="profile-password-title" title={en ? "Password" : "Contraseña"} />
    <p className="text-sm leading-relaxed text-text-secondary">{en
      ? "Sign in with 6 digits. Create or change your password here."
      : "Entra con 6 dígitos. Crea o cambia tu contraseña aquí."}</p>
    {enabled && <Link href="/set-password?returnTo=%2Fperfil"
      className="flex min-h-11 w-full flex-wrap items-center justify-center gap-2 rounded-full bg-profile-security px-4 py-3 text-center text-sm font-semibold leading-snug text-bg-base transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-profile-security">
      <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 basis-32 [overflow-wrap:anywhere]">{en ? "Create or change password" : "Crear o cambiar contraseña"}</span>
    </Link>}
    {enabled === null && !error && <div className="h-12 animate-pulse rounded-xl bg-bg-elevated" role="status" aria-label={en ? "Loading" : "Cargando"} />}
    {error && <div role="alert" className="space-y-2 text-sm leading-relaxed text-red-alert">
      <p>{en ? "Could not load this option." : "No pudimos cargar esta opción."}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 cursor-pointer underline hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{en ? "Try again" : "Reintentar"}</button>
    </div>}
  </section>;
}
