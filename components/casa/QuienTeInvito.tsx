"use client";

// components/casa/QuienTeInvito.tsx — «¿Quién te invitó?» para personas nuevas (migración 135).
//
// Punto 3 del dueño (2026-09-17): quien entra directo a lapollacolombiana.com,
// sin el enlace, igual puede escribir el código de quien lo invitó. Si llegó por
// un enlace, ve quién es; se guarda al enviar su comprobante y «No es así» lo
// descarta. Se puede corregir hasta que se apruebe su primer pago: SQL lo vuelve
// a exigir (persona nueva, un solo invitador, tope de intentos).

import { useState, type FormEvent } from "react";
import { Check, UserPlus } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import { casaPost } from "@/lib/casa/upload-client";
import { REFERRAL_DISMISS_COOKIE, normalizeReferralCode } from "@/lib/casa/referrals-shared";
import type { ReferralInviteeState, ReferralPerson } from "@/lib/casa/types";

type Variant = "pagar" | "casa" | "perfil";

function Persona({ person }: { person: ReferralPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar avatarUrl={person.avatar} displayName={person.name ?? undefined} size="md" />
      <strong className="min-w-0 text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{person.name ?? "Sin nombre"}</strong>
    </span>
  );
}

export function QuienTeInvito({ initial, variant }: { initial: ReferralInviteeState; variant: Variant }) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { can_set_referrer: canSet, referrer, hint } = state;
  if (!canSet && !(variant === "perfil" && referrer)) return null;

  async function vincular(value: string) {
    const normalized = normalizeReferralCode(value);
    if (!normalized) return setError("Escribe el código de la persona que te invitó.");
    setSending(true);
    setError(null);
    try {
      const data = await casaPost("/api/casa/referidos", { accion: "vincular", codigo: normalized });
      setState((prev) => ({ ...prev, referrer: data.referrer ?? prev.referrer, hint: null }));
      setEditing(false);
      setCode("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar el código. Intenta de nuevo.");
    } finally {
      setSending(false);
    }
  }

  async function descartarEnlace() {
    setSending(true);
    try { await casaPost("/api/casa/referidos", { accion: "descartar" }); } catch { /* La cookie vence sola. */ }
    setSending(false);
    setState((prev) => ({ ...prev, hint: null }));
    setEditing(!referrer);
  }

  function noMeInvitaron() {
    document.cookie = `${REFERRAL_DISMISS_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    setDismissed(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void vincular(code);
  }

  // Perfil con el invitador ya fijo: solo el dato.
  if (!canSet && referrer) {
    return (
      <div className="lp-card p-4">
        <span className="lp-label">Te invitó</span>
        <div className="mt-2"><Persona person={referrer} /></div>
      </div>
    );
  }

  // En Casa, quien dijo que nadie lo invitó y no llegó por un enlace no vuelve a verlo.
  if (variant === "casa" && dismissed && !hint && !referrer) return null;

  const form = (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <label htmlFor={`codigo-invitacion-${variant}`} className="block text-[13px] text-text-secondary">
        Código de la persona que te invitó
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`codigo-invitacion-${variant}`}
          value={code}
          onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(null); }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={14}
          placeholder="Ej. JUAN4821"
          className="lp-input min-h-11 min-w-0 flex-[1_1_10rem] text-[15px] uppercase tracking-[0.06em]"
        />
        {/* Botones secundarios: el principal de la pantalla es entrar o pagar (un solo dorado). */}
        <button type="submit" disabled={sending || !code.trim()} className="lp-btn lp-btn-ghost min-h-11 flex-[1_0_auto] !px-4 text-[15px]">
          {sending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );

  return (
    <section aria-labelledby={`quien-invito-${variant}`} className="lp-card p-4">
      <div className="flex items-start gap-3">
        <UserPlus aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <h2 id={`quien-invito-${variant}`} className="text-[15px] font-semibold leading-snug text-text-primary">
            {referrer ? "Te invitó" : hint ? "¿Te invitó esta persona?" : "¿Alguien te invitó?"}
          </h2>

          {referrer && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Persona person={referrer} />
              {!editing && (
                <button type="button" onClick={() => { setEditing(true); setSaved(false); }} className="min-h-11 cursor-pointer rounded-full px-3 text-[13px] font-semibold text-text-secondary underline underline-offset-4 transition-colors hover:text-text-primary">
                  Cambiar
                </button>
              )}
            </div>
          )}
          {saved && referrer && (
            <p role="status" className="mt-2 flex items-center gap-1.5 text-[13px] text-turf">
              <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> Guardado. Puedes cambiarlo hasta que confirmemos tu primer pago.
            </p>
          )}

          {hint && (
            <div className="mt-2 space-y-2">
              {referrer && <p className="text-[13px] text-text-secondary">Abriste el enlace de otra persona:</p>}
              <Persona person={hint} />
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {referrer
                  ? "Si esa persona fue quien te invitó, cámbialo aquí."
                  : variant === "pagar"
                    ? "Lo guardamos cuando envíes tu comprobante. Así esa persona suma para su cupo de regalo."
                    : "Así esa persona suma para su cupo de regalo."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={sending} onClick={() => hint.code && vincular(hint.code)} className="lp-btn lp-btn-ghost min-h-11 flex-[1_0_auto] !px-4 text-[15px]">
                  {referrer ? `Cambiar a ${hint.name ?? "esta persona"}` : "Sí, me invitó"}
                </button>
                <button type="button" disabled={sending} onClick={descartarEnlace} className="lp-btn lp-btn-ghost min-h-11 flex-[1_0_auto] !px-4 text-[15px]">
                  No es así
                </button>
              </div>
            </div>
          )}

          {!referrer && !hint && !editing && (
            <>
              <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                Si una persona te recomendó La Polla, escribe su código. Es opcional y le ayuda a ganar un cupo de regalo.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(true)} className="lp-btn lp-btn-ghost min-h-11 flex-[1_0_auto] !px-4 text-[15px]">
                  Escribir código
                </button>
                {variant === "casa" && (
                  <button type="button" onClick={noMeInvitaron} className="min-h-11 flex-[1_0_auto] cursor-pointer rounded-full px-4 text-[15px] text-text-secondary transition-colors hover:text-text-primary">
                    Nadie me invitó
                  </button>
                )}
              </div>
            </>
          )}

          {editing && form}
          {error && <p role="alert" className="mt-2 text-[13px] leading-relaxed text-red-alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}
