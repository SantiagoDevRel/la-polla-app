"use client";

import { useRef, useState } from "react";
import { loginRequest } from "@/lib/auth/login-request";
import { requestJson } from "@/lib/http/json-request";
import { useLocale } from "next-intl";
import { KeyRound, Loader2 } from "lucide-react";
import { LOGIN_CARD, LOGIN_TITLE, PRIMARY_BTN, GHOST_BTN } from "@/components/auth/login-styles";
import PasswordInput from "./PasswordInput";

export default function PasswordSetup({ returnTo, manage = false, hasPassword = false, ownerId, revision }: { returnTo: string; manage?: boolean; hasPassword?: boolean; ownerId: string; revision: number }) {
  const en = useLocale() === "en";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveLock = useRef(false);
  const baseline = useRef(revision);
  const pending = useRef<{ password: string; requestId: string; revision: number } | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (saveLock.current) return;
    if (!/^\d{6}$/.test(password) || password !== confirmation) {
      setError(en ? "Enter and confirm the same 6-digit password." : "Escribe y confirma la misma contraseña de 6 dígitos."); return;
    }
    saveLock.current = true;
    setSaving(true);
    try {
      const attempt = pending.current ?? { password, requestId: crypto.randomUUID(), revision: baseline.current };
      pending.current = attempt;
      const response = await loginRequest("/api/auth/password", { password: attempt.password, confirmation: attempt.password,
        expected_user_id: ownerId, request_id: attempt.requestId, expected_revision: attempt.revision });
      if (!response.ok) {
        if (response.body.code === "PASSWORD_CHANGED") {
          // Observing an advanced revision proves the old request cannot commit
          // later. Only then may the user explicitly submit a new operation.
          const state = await requestJson("/api/auth/password/status", { method: "GET" },
            (value): value is { enabled: true; userId: string; revision: number } => !!value && typeof value === "object" &&
              "enabled" in value && value.enabled === true && "userId" in value && value.userId === ownerId &&
              "revision" in value && Number.isSafeInteger(value.revision) && (value.revision as number) > attempt.revision);
          if (state.ok) { baseline.current = state.data.revision; pending.current = null; setConfirmationPending(false); }
          else setConfirmationPending(true);
        } else if (response.body.code === "PASSWORD_REFRESH_REQUIRED" || response.body.code === "SESSION_CHANGED" || response.body.code === "PASSWORD_REQUEST_REUSED") {
          setRefreshRequired(true); setConfirmationPending(true);
        } else if (response.status >= 500) setConfirmationPending(true);
        else { pending.current = null; setConfirmationPending(false); }
        setError(typeof response.body.error === "string" ? response.body.error : (en ? "Try again." : "Intenta de nuevo."));
        return;
      }
      if (response.body.ok !== true || response.body.userId !== ownerId || response.body.requestId !== attempt.requestId || response.body.revision !== attempt.revision + 1) throw new Error("Invalid password acknowledgement");
      pending.current = null; setConfirmationPending(false);
      setPassword(""); setConfirmation(""); window.location.assign(returnTo);
    } catch { setConfirmationPending(true); setError(en ? "We could not confirm your password was saved. Your digits are kept here; retry saving the same password when your connection returns." : "No pudimos confirmar el guardado. Conservamos tus dígitos; vuelve a guardar la misma contraseña cuando regrese tu conexión."); }
    finally { saveLock.current = false; setSaving(false); }
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
          value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-help" disabled={saving || confirmationPending} />
        <PasswordInput id="confirm-password" label={en ? "Confirm password" : "Confirma tu contraseña"}
          value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={saving || confirmationPending} />
        <p id="password-help" className="text-sm leading-relaxed text-text-secondary">{en ? "Avoid your birthday and repeated digits." : "Evita tu fecha de nacimiento y los números repetidos."}</p>
        {error && <p role="alert" className="text-sm text-red-alert bg-red-dim p-3 rounded-xl">{error}</p>}
        {refreshRequired ? <button type="button" className={PRIMARY_BTN} onClick={() => window.location.reload()}>{en ? "Refresh page" : "Actualizar página"}</button>
          : <button type="submit" className={PRIMARY_BTN} disabled={saving}>{saving && <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />}<span className="min-w-0 [overflow-wrap:anywhere]">{saving ? (en ? "Saving…" : "Guardando…") : (en ? "Save password" : "Guardar contraseña")}</span></button>}
      </form>
      <a href={returnTo} className={GHOST_BTN} aria-disabled={saving} onClick={e => { if (saving) e.preventDefault(); }}>{manage ? (en ? "Back to profile" : "Volver a Perfil") : (en ? "Skip for now" : "Omitir por ahora")}</a>
    </section>
  </main>;
}
