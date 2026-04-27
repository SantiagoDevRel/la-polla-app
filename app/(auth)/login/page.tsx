// app/(auth)/login/page.tsx — Login con SMS OTP via Twilio Verify (orquestado
// por Supabase Phone Auth). Mismo patrón que los-del-sur-app:
//   • Send OTP corre client-side (no hay sesión todavía, signInWithOtp directo)
//   • Verify OTP corre server-side (/api/auth/verify-otp) para que las cookies
//     queden persistidas via Set-Cookie HttpOnly — fix del bug iOS Safari.
// 2 pasos (input → otp). Sin contraseña, sin Turnstile, sin WhatsApp bot.
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, MessageSquare, Loader2 } from "lucide-react";
import axios from "axios";
import { createClient } from "@/lib/supabase/client";
import TournamentBadge from "@/components/shared/TournamentBadge";
import PhoneInput from "@/components/ui/PhoneInput";
import { botDeepLink } from "@/lib/whatsapp/bot-phone";

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

const RETURN_TO_KEY = "lp_returnTo";

type Step = "input" | "otp";

interface PollaPreview {
  slug: string;
  name: string;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

function LoginInner() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [step, setStep] = useState<Step>("input");
  // E.164 phone (e.g. "+573001234567") emitted by PhoneInput. The
  // country selector defaults to Colombia but accepts any country
  // Twilio Verify supports.
  const [phoneE164, setPhoneE164] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PollaPreview | null>(null);

  // Visiting /login means "I want to start fresh" — even if the user
  // already has a session for another account (legitimate: same person
  // can have a +57 account and a +351 account). Sign out on mount so
  // the channel buttons below always create a brand-new session, and
  // the user can't accidentally end up in the OLD account just because
  // /inicio happened to render first.
  useEffect(() => {
    void supabase.auth.signOut().catch(() => {});
  }, [supabase]);

  // Capturar returnTo + cargar preview de polla si viene de invite link.
  useEffect(() => {
    const rt = searchParams.get("returnTo");
    if (rt && typeof window !== "undefined") {
      window.sessionStorage.setItem(RETURN_TO_KEY, rt);
    }
    const stored =
      rt ??
      (typeof window !== "undefined"
        ? window.sessionStorage.getItem(RETURN_TO_KEY)
        : null);
    if (!stored) return;
    const slugMatch = stored.match(/^\/(?:pollas|unirse)\/([^/?#]+)/);
    const tokenMatch = stored.match(/^\/invites\/polla\/([^/?#]+)/);
    if (!slugMatch && !tokenMatch) return;
    const params = new URLSearchParams(
      slugMatch ? { slug: slugMatch[1] } : { token: tokenMatch![1] },
    );
    axios
      .get<{
        polla: Omit<PollaPreview, "participantCount">;
        participantCount: number;
      }>(`/api/pollas/preview?${params.toString()}`)
      .then(({ data }) =>
        setPreview({ ...data.polla, participantCount: data.participantCount }),
      )
      .catch(() => {});
  }, [searchParams]);

  // PhoneInput emits an E.164 string already (e.g. "+573001234567")
  // or "" while the user types. We just trust it and validate the
  // overall length before sending.
  function buildPhone(): string {
    return phoneE164.trim();
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const phone = buildPhone();
    // Smallest plausible E.164 is "+CCNNNNNNN" (~9 chars total). Twilio
    // Verify itself will reject anything malformed.
    if (!phone.startsWith("+") || phone.replace(/\D/g, "").length < 8) {
      setError("Ingresá un número válido con código de país");
      return;
    }
    setSending(true);
    try {
      // Client-side: no hay sesión todavía, no necesitamos cookies.
      // Mismo patrón que los-del-sur-app — el server-side intermediate
      // creaba quirks raros con rate-limit.
      const { error: authErr } = await supabase.auth.signInWithOtp({
        phone,
        options: { channel: "sms" },
      });
      if (authErr) {
        const msg = (authErr.message || "").toLowerCase();
        if (msg.includes("phone signups") || msg.includes("provider")) {
          setError("Login por celular no está activado. Contactá soporte.");
        } else if (msg.includes("rate") || msg.includes("limit")) {
          setError("Muchos intentos. Esperá un minuto y reintentá.");
        } else {
          setError(authErr.message || "No pudimos enviar el código");
        }
        return;
      }
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (otp.length !== 6) {
      setError("El código tiene 6 dígitos");
      return;
    }
    setVerifying(true);
    try {
      const phone = buildPhone();
      // Server-side: persiste cookies via Set-Cookie HttpOnly (crítico
      // para iOS Safari, donde verifyOtp en el browser deja la sesión
      // en memory pero pierde cookies y al navegar parece no logueado).
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, token: otp }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Código inválido o vencido");
        return;
      }
      const body = (await res.json()) as { newUser?: boolean };
      const rt =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(RETURN_TO_KEY)
          : null;
      if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
      // Hard redirect para asegurar que las cookies se apliquen al
      // siguiente request (router.push a veces las pierde en middleware).
      window.location.href = body?.newUser ? "/onboarding" : rt || "/inicio";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {step === "input" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle relative z-10"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.08)" }}
        >
          <div className="text-center space-y-2">
            <motion.div
              className="mx-auto"
              style={{ width: 80, height: 80, position: "relative" }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: -8,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255,215,0,0.35) 0%, transparent 70%)",
                  filter: "blur(8px)",
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pollitos/logo_realistic.webp"
                alt="La Polla"
                width={80}
                height={80}
                style={{
                  width: 80,
                  height: 80,
                  objectFit: "contain",
                  position: "relative",
                }}
              />
            </motion.div>
            <h1
              className="font-display text-5xl tracking-wide"
              style={{
                color: "#FFD700",
                textShadow: "0 0 24px rgba(255,215,0,0.35)",
              }}
            >
              LA POLLA
            </h1>
            <p className="text-text-muted text-sm">
              La polla deportiva de tus amigos
            </p>
          </div>

          {preview && (
            <div className="rounded-2xl p-4 border border-gold/30 bg-gold/5 space-y-1.5 text-center">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">
                Te invitaron a unirte a
              </p>
              <p className="font-display text-2xl text-text-primary tracking-wide">
                {preview.name}
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
                <TournamentBadge
                  tournamentSlug={preview.tournament}
                  size="sm"
                />
              </div>
              <p className="text-xs text-text-secondary">
                {preview.participantCount} participante
                {preview.participantCount === 1 ? "" : "s"}
                {preview.buy_in_amount > 0
                  ? ` · ${fmtCOP(preview.buy_in_amount)} por persona`
                  : " · gratis"}
              </p>
            </div>
          )}

          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Tu número de celular
              </label>
              <PhoneInput onChange={setPhoneE164} />
            </div>

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
              </p>
            )}

            {/* Two channels side by side. SMS submits the form (gold,
                primary). WhatsApp doesn't need the typed phone — the
                bot identifies the user from the WA sender — so its
                button is always enabled and just deep-links to wa.me. */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="submit"
                disabled={
                  sending ||
                  !phoneE164.startsWith("+") ||
                  phoneE164.replace(/\D/g, "").length < 8
                }
                className="bg-gold text-bg-base font-bold py-3.5 px-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base inline-flex items-center justify-center gap-2"
                style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5" />
                    SMS
                  </>
                )}
              </button>

              <a
                href={botDeepLink("Quiero entrar a La Polla")}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold py-3.5 px-3 rounded-xl hover:brightness-110 transition-all text-base inline-flex items-center justify-center gap-2"
                style={{
                  background: "#25D366",
                  color: "#080c10",
                  boxShadow: "0 0 20px rgba(37,211,102,0.18)",
                }}
                aria-label="Recibir código por WhatsApp"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                </svg>
                WhatsApp
              </a>
            </div>
          </form>

          <p className="text-[10px] text-text-muted/70 text-center pt-1">
            Al continuar, aceptás nuestros términos y condiciones
          </p>
        </div>
      )}

      {step === "otp" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl text-gold tracking-wide">
              INGRESÁ TU CÓDIGO
            </h2>
            <p className="text-text-secondary text-sm">
              Enviado a{" "}
              <span className="text-text-primary font-semibold">
                {buildPhone()}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setStep("input");
                setOtp("");
                setError(null);
              }}
              className="text-xs text-gold/70 hover:text-gold transition-colors"
            >
              ← Cambiar número
            </button>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] tracking-[0.5em] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
              required
              autoFocus
              disabled={verifying}
            />

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={verifying || otp.length !== 6}
              className="w-full bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {verifying ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Verificando...
                </>
              ) : (
                "Verificar código"
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("input");
                setOtp("");
                setError(null);
              }}
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Reenviar código o cambiar número
            </button>
          </form>

          {/* SMS fallback: a small "no me llegó" line that links straight
              to WhatsApp with a pre-filled login intent. The bot replies
              with a one-tap CTA button that hits /api/auth/wa-magic and
              signs the user in without ever copying a code. Kept tiny
              on purpose — gold is reserved for the primary CTA. */}
          <div className="text-center pt-1">
            <a
              href={botDeepLink("Quiero entrar a La Polla")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-muted hover:text-gold transition-colors inline-flex items-center gap-1"
            >
              ¿No te llegó? <span className="underline">Probá con WhatsApp</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner />
    </Suspense>
  );
}
