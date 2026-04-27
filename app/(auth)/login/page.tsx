// app/(auth)/login/page.tsx — Phone + SMS OTP login. Two steps:
//   1) phone: user enters number + Turnstile, server triggers Twilio Verify
//      via Supabase signInWithOtp.
//   2) code: user enters 6-digit code, server verifies via Supabase
//      verifyOtp. On success, session cookies are set and we redirect.
"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { motion } from "framer-motion";
import axios from "axios";
import { ArrowLeft, MessageSquare } from "lucide-react";
import PhoneInput from "@/components/ui/PhoneInput";
import TournamentBadge from "@/components/shared/TournamentBadge";

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

type Step = "phone" | "code";

const RETURN_TO_KEY = "lp_returnTo";

interface PollaPreview {
  slug: string;
  name: string;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneFromParams = searchParams.get("phone") ?? "";

  const [step, setStep] = useState<Step>("phone");
  const [preview, setPreview] = useState<PollaPreview | null>(null);
  const [phone, setPhone] = useState(phoneFromParams);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const turnstileRef = useRef<TurnstileInstance>(null);

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

  const handlePhoneChange = useCallback((value: string) => {
    setPhone(value);
  }, []);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone || phone.length < 10) {
      setError("Ingresá un número de teléfono válido");
      return;
    }
    if (!turnstileToken) {
      setError("Completá la verificación anti-bot");
      return;
    }

    setSending(true);
    try {
      await axios.post("/api/auth/otp", { phone, turnstileToken });
      setStep("code");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(
        e.response?.data?.error ??
          "No pudimos enviar el código. Intentá de nuevo.",
      );
      // Reset Turnstile so user can re-verify; the token may be consumed.
      turnstileRef.current?.reset();
      setTurnstileToken("");
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerifying(true);

    try {
      const { data } = await axios.put<{ newUser: boolean }>(
        "/api/auth/otp",
        { phone, code },
      );

      if (data?.newUser) {
        router.push("/onboarding");
        return;
      }
      const rt =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(RETURN_TO_KEY)
          : null;
      if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
      router.push(rt || "/inicio");
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(
        axiosError.response?.data?.error || "Código inválido o expirado",
      );
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setCode("");
    setStep("phone");
  };

  // Turnstile site key. When unset (dev), we render a placeholder so the
  // CTA isn't permanently disabled; the server still skips verification
  // when CLOUDFLARE_TURNSTILE_SECRET_KEY is unset (see lib/auth/turnstile).
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? "";
  const turnstileConfigured = turnstileSiteKey.length > 0;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {step === "phone" && (
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
                <TournamentBadge tournamentSlug={preview.tournament} size="sm" />
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

          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Tu número de celular
              </label>
              <PhoneInput onChange={handlePhoneChange} />
              <p className="text-xs text-text-muted mt-1.5">
                Te enviamos un código por SMS al toque.
              </p>
            </div>

            {turnstileConfigured ? (
              <div className="flex flex-col items-center gap-2">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={turnstileSiteKey}
                  options={{ theme: "dark", retry: "auto", refreshExpired: "auto" }}
                  onSuccess={(token) => {
                    setTurnstileToken(token);
                    setTurnstileError(false);
                  }}
                  onError={() => {
                    setTurnstileError(true);
                    setTurnstileToken("");
                  }}
                  onExpire={() => {
                    setTurnstileToken("");
                  }}
                />
                {turnstileError && (
                  <p className="text-xs text-red-alert text-center">
                    No se pudo cargar la verificación. Recargá la página o
                    revisá tu conexión.
                  </p>
                )}
              </div>
            ) : null}

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={
                sending ||
                !phone ||
                (turnstileConfigured && !turnstileToken)
              }
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              <MessageSquare className="w-5 h-5" />
              {sending ? "Enviando código..." : "Enviame el código"}
            </button>
          </form>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-sm text-text-muted">
              Al continuar, aceptás nuestros términos y condiciones
            </p>
          </div>
        </div>
      )}

      {step === "code" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl text-gold tracking-wide">
              INGRESÁ TU CÓDIGO
            </h2>
            <p className="text-text-secondary text-sm">
              Te mandamos un SMS con un código de 6 dígitos al{" "}
              <span className="text-text-primary">+{phone}</span>
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] tracking-[0.5em] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
              required
              autoFocus
            />

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="w-full bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {verifying ? "Verificando..." : "Verificar código"}
            </button>

            <button
              type="button"
              onClick={handleResend}
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Cambiar número o reenviar
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
