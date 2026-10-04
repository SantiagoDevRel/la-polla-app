"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowRight, Check, CirclePlus, KeyRound } from "lucide-react";
import ProfileSectionHeading from "./ProfileSectionHeading";

export default function PasswordAccess() {
  const en = useLocale() === "en";
  const [status, setStatus] = useState<{ enabled: boolean; hasPassword?: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setStatus(null);
    void fetch("/api/auth/password/status", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { enabled: boolean; hasPassword?: boolean } = await response.json();
        if (typeof data.enabled !== "boolean" || (data.enabled && typeof data.hasPassword !== "boolean")) throw new Error();
        if (!controller.signal.aborted) setStatus(data);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  if (status?.enabled === false) return null;
  return <section className="lp-card space-y-3 border-profile-security/40 bg-profile-security/10 p-4 hover:border-profile-security/60" aria-labelledby="profile-password-title">
    <ProfileSectionHeading icon={KeyRound} tone="security" id="profile-password-title" title={en ? "Password" : "Contraseña"} />
    {status?.enabled && <>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${status.hasPassword ? "bg-turf/10 text-turf" : "bg-profile-security/20 text-profile-security"}`}>
          {status.hasPassword ? <Check className="h-5 w-5" /> : <CirclePlus className="h-5 w-5" />}
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-text-primary">{status.hasPassword
          ? (en ? "You already have a password." : "Ya tienes una contraseña.")
          : (en ? "You have not created a password yet." : "Aún no tienes una contraseña creada.")}</p>
      </div>
      <p className="text-sm leading-relaxed text-text-secondary">{status.hasPassword
        ? (en ? "If you forget it, change it here without entering the previous one." : "Si no la recuerdas, cámbiala aquí sin ingresar la anterior.")
        : (en ? "Create a new 6-digit password to sign in." : "Crea una nueva contraseña de 6 dígitos para ingresar.")}</p>
      <Link href="/set-password?returnTo=%2Fperfil"
        className="flex min-h-11 w-full flex-wrap items-center justify-center gap-2 rounded-full bg-profile-security px-4 py-3 text-center text-sm font-semibold leading-snug text-bg-base transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-profile-security">
        <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 basis-32 [overflow-wrap:anywhere]">{status.hasPassword
          ? (en ? "Change password" : "Cambiar contraseña")
          : (en ? "Create password" : "Crear contraseña")}</span>
        <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
      </Link></>}
    {status === null && !error && <div className="h-24 animate-pulse rounded-xl bg-bg-elevated" role="status" aria-label={en ? "Loading password status" : "Cargando estado de contraseña"} />}
    {error && <div role="alert" className="space-y-2 text-sm leading-relaxed text-red-alert">
      <p>{en ? "Could not load this option." : "No pudimos cargar esta opción."}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 cursor-pointer underline hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{en ? "Try again" : "Reintentar"}</button>
    </div>}
  </section>;
}
