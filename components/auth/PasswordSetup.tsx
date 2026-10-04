"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { KeyRound, Loader2 } from "lucide-react";
import { LOGIN_CARD, LOGIN_TITLE, PRIMARY_BTN, GHOST_BTN } from "@/components/auth/login-styles";
import PasswordInput from "./PasswordInput";

export default function PasswordSetup({ returnTo, manage = false, hasPassword = false }: { returnTo: string; manage?: boolean; hasPassword?: boolean }) {
  const en = useLocale() === "en";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!/^\d{6}$/.test(password) || password !== confirmation) {
      setError(en ? "Enter and confirm the same 6-digit password." : "Escribe y confirma la misma contraseña de 6 dígitos."); return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }) });
      if (!response.ok) { const body = await response.json(); setError(body.error || (en ? "Try again." : "Intenta de nuevo.")); return; }
      setPassword(""); setConfirmation(""); window.location.assign(returnTo);
    } catch { setError(en ? "Could not save your password. Try again." : "No pudimos guardar tu contraseña. Intenta de nuevo."); }
    finally { setSaving(false); }
  }
  return <main className="min-h-screen flex items-center justify-center p-4">
    <section className={LOGIN_CARD}>
      <KeyRound className="h-6 w-6 text-text-secondary mx-auto" aria-hidden="true" />
      <div className="text-center space-y-2">
        <h1 className={`${LOGIN_TITLE} -mx-4 leading-tight`}>{hasPassword ? (en ? "CHANGE YOUR PASSWORD" : "CAMBIA TU CONTRASEÑA") : (en ? "CREATE YOUR PASSWORD" : "CREA TU CONTRASEÑA")}</h1>
        <p className="text-sm leading-relaxed text-text-primary">{hasPassword ? (en
          ? "Choose a new 6-digit password. You do not need to remember the previous one."
          : "Elige una nueva contraseña de 6 dígitos. No necesitas recordar la anterior.") : manage ? (en
          ? "Choose a 6-digit password and confirm it. You can still sign in by WhatsApp or SMS."
          : "Elige una contraseña de 6 dígitos y confírmala. Puedes seguir entrando por WhatsApp o SMS.") : en
          ? "Create a 6-digit password so you do not need a code every time. If you forget it, sign in by WhatsApp or SMS and change it in Profile."
          : "Crea una contraseña de 6 dígitos para ingresar. Si la olvidas, entra por WhatsApp o SMS y cámbiala en Perfil."}</p>
      </div>
      <form onSubmit={save} className="space-y-4">
        <PasswordInput id="new-password" label={en ? "6-digit password" : "Contraseña de 6 dígitos"}
          value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-help" disabled={saving} />
        <PasswordInput id="confirm-password" label={en ? "Confirm password" : "Confirma tu contraseña"}
          value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={saving} />
        <p id="password-help" className="text-sm leading-relaxed text-text-secondary">{en ? "Avoid your birthday and repeated digits." : "Evita tu fecha de nacimiento y los números repetidos."}</p>
        {error && <p role="alert" className="text-sm text-red-alert bg-red-dim p-3 rounded-xl">{error}</p>}
        <button type="submit" className={PRIMARY_BTN} disabled={saving}>{saving && <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />}<span className="min-w-0 [overflow-wrap:anywhere]">{saving ? (en ? "Saving…" : "Guardando…") : (en ? "Save password" : "Guardar contraseña")}</span></button>
      </form>
      <a href={returnTo} className={GHOST_BTN} aria-disabled={saving} onClick={e => { if (saving) e.preventDefault(); }}>{manage ? (en ? "Back to profile" : "Volver a Perfil") : (en ? "Skip for now" : "Omitir por ahora")}</a>
    </section>
  </main>;
}
