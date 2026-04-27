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
  const [numero, setNumero] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PollaPreview | null>(null);

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

  // E.164: +57 + número limpio. Aceptamos solo Colombia desde la UI.
  function buildPhone(): string {
    const cleaned = numero.replace(/\D/g, "");
    return `+57${cleaned}`;
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleaned = numero.replace(/\D/g, "");
    if (cleaned.length < 10) {
      setError("Ingresá un número válido de 10 dígitos");
      return;
    }
    setSending(true);
    try {
      const phone = buildPhone();
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
              <div className="flex gap-2">
                <div
                  className="h-12 shrink-0 px-3 rounded-xl flex items-center justify-center text-text-primary font-semibold text-sm border"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.1)",
                  }}
                >
                  🇨🇴 +57
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="3001234567"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  required
                  disabled={sending}
                  className="h-12 w-full rounded-xl px-3 text-base font-semibold tracking-wide bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50 outline-none disabled:opacity-50"
                />
              </div>
              <p className="text-xs text-text-muted mt-1.5">
                Te mandamos un código de 6 dígitos por SMS.
              </p>
            </div>

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={sending || numero.replace(/\D/g, "").length < 10}
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {sending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <MessageSquare className="w-5 h-5" />
                  Enviame el código
                </>
              )}
            </button>
          </form>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-sm text-text-muted">
              Al continuar, aceptás nuestros términos y condiciones
            </p>
          </div>
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
              Te mandamos un SMS con un código de 6 dígitos a{" "}
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
