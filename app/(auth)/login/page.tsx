// app/(auth)/login/page.tsx — Phone gateway. Routes to:
//   - /login/password when the phone has a custom password (fast path)
//   - the bot-OTP flow otherwise (registration or forgot-password)
//
// ?forgot=1 forces the OTP flow regardless of password state, used by the
// "Olvidé mi contraseña" link from /login/password.
"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { motion } from "framer-motion";
import axios from "axios";
import { ArrowLeft, MessageCircle } from "lucide-react";
import PhoneInput from "@/components/ui/PhoneInput";
import TournamentBadge from "@/components/shared/TournamentBadge";
import { BOT_PHONE, botDeepLink } from "@/lib/whatsapp/bot-phone";
import { normalizePhone } from "@/lib/auth/phone";

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

type Step =
  | "phone"
  | "waiting_for_whatsapp"
  | "polling_for_otp"
  | "entering_code";

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
  const forgotMode = searchParams.get("forgot") === "1";
  const phoneFromParams = searchParams.get("phone") ?? "";

  const [step, setStep] = useState<Step>("phone");
  const [preview, setPreview] = useState<PollaPreview | null>(null);
  const [phone, setPhone] = useState(phoneFromParams);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pollingElapsed, setPollingElapsed] = useState(0);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
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

  // Phone submit: validate phone + Turnstile, then either route to the
  // password page (fast path for returning users) or start the bot OTP
  // flow. forgotMode skips the password fast-path so the user can reset.
  const handleSubmit = async (e: React.FormEvent) => {
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

    setChecking(true);
    try {
      if (!forgotMode) {
        const { data } = await axios.post<{
          exists: boolean;
          hasCustomPassword: boolean;
        }>("/api/auth/check-phone", {
          phone,
          turnstileToken,
        });

        if (data.exists && data.hasCustomPassword) {
          router.push(
            `/login/password?phone=${encodeURIComponent(normalizePhone(phone))}`,
          );
          return;
        }
      }

      // No password yet (new user, mid-registration, or forgot-password): go
      // through the bot-first OTP flow.
      setStep("waiting_for_whatsapp");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(
        e.response?.data?.error ??
          "No pudimos verificar el número. Intentá de nuevo.",
      );
      // Reset Turnstile so user can re-verify; the token may be consumed.
      turnstileRef.current?.reset();
      setTurnstileToken("");
    } finally {
      setChecking(false);
    }
  };

  // Sync open of WhatsApp deep link — must stay sync for iOS user-activation.
  const handleOpenWhatsApp = () => {
    setError("");
    if (typeof window !== "undefined") {
      window.open(
        botDeepLink("Hola parce, mandame el código de la polla"),
        "_blank",
      );
    }
    setStep("polling_for_otp");
    axios.post("/api/auth/login-wait", { phone }).catch((err) => {
      console.error("[login] login-wait failed:", err);
    });
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerifying(true);

    try {
      const { data: verifyRes } = await axios.put<{
        newUser: boolean;
        needsPassword: boolean;
      }>("/api/auth/otp", { phone, code });

      // After OTP success, the user always lands on /set-password — the
      // OTP route rotated their password to a temp value the user does
      // not know. The middleware enforces this redirect on every other
      // route, but we also push directly so the URL bar updates cleanly.
      if (verifyRes?.needsPassword) {
        router.push("/set-password");
      } else if (verifyRes?.newUser) {
        router.push("/onboarding");
      } else {
        const rt =
          typeof window !== "undefined"
            ? window.sessionStorage.getItem(RETURN_TO_KEY)
            : null;
        if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
        router.push(rt || "/inicio");
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(
        axiosError.response?.data?.error || "Código inválido o expirado",
      );
    } finally {
      setVerifying(false);
    }
  };

  // Polling loop while user messages the bot. Same TTL behavior as before.
  useEffect(() => {
    if (step !== "polling_for_otp") return;
    let cancelled = false;
    const startedAt = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    setPollingElapsed(0);
    setPollingTimedOut(false);

    async function tick() {
      if (cancelled) return;
      try {
        const { data } = await axios.get<{ status: string }>(
          `/api/auth/login-poll?phone=${encodeURIComponent(phone)}`,
        );
        if (cancelled) return;
        if (data.status === "code_sent") {
          setStep("entering_code");
          return;
        }
        if (data.status === "expired") {
          setError("La sesión expiró. Volvé a intentar.");
          setStep("waiting_for_whatsapp");
          return;
        }
      } catch (err) {
        console.warn("[login] poll failed:", err);
      }
      const elapsed = Date.now() - startedAt;
      setPollingElapsed(elapsed);
      if (elapsed > TIMEOUT_MS) {
        if (!cancelled) {
          setPollingTimedOut(true);
        }
        return;
      }
      setTimeout(tick, 3000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [step, phone]);

  const handleReopenWhatsApp = () => {
    setError("");
    if (typeof window !== "undefined") {
      window.open(
        botDeepLink("Hola parce, mandame el código de la polla"),
        "_blank",
      );
    }
    setStep("waiting_for_whatsapp");
    setTimeout(() => setStep("polling_for_otp"), 0);
    axios.post("/api/auth/login-wait", { phone }).catch((err) => {
      console.error("[login] login-wait retry failed:", err);
    });
  };

  // Turnstile site key. When unset (dev), we render a placeholder so the
  // CTA isn't permanently disabled; the server still skips verification
  // when CLOUDFLARE_TURNSTILE_SECRET_KEY is unset (see lib/auth/turnstile).
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ?? "";
  const turnstileConfigured = turnstileSiteKey.length > 0;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Step 1: Phone input */}
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
              {forgotMode
                ? "Recuperá tu contraseña con un código de WhatsApp"
                : "La polla deportiva de tus amigos"}
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Número de WhatsApp
              </label>
              <PhoneInput onChange={handlePhoneChange} />
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
                checking ||
                !phone ||
                (turnstileConfigured && !turnstileToken)
              }
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              <MessageCircle className="w-5 h-5" />
              {checking ? "Verificando..." : "Continuar"}
            </button>
          </form>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-sm text-text-muted">
              Al continuar, aceptas nuestros términos y condiciones
            </p>
          </div>
        </div>
      )}

      {step === "waiting_for_whatsapp" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-3">
            <div className="mx-auto" style={{ width: 80, height: 80 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pollitos/pollito_whatsapp_logo.webp"
                alt="Bot La Polla"
                width={80}
                height={80}
                style={{
                  width: 80,
                  height: 80,
                  objectFit: "cover",
                  borderRadius: "50%",
                }}
              />
            </div>
            <h2 className="font-display text-2xl text-gold tracking-wide">
              ABRÍ WHATSAPP CON EL BOT
            </h2>
            <p className="text-text-secondary text-sm leading-snug">
              {forgotMode
                ? "Para recuperar tu contraseña, escribile al bot y te mandamos un código."
                : "Para recibir el código, escribile al bot y te mandamos el código acá."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleOpenWhatsApp}
            className="w-full flex items-center justify-center gap-2 font-bold py-4 px-4 rounded-xl hover:brightness-110 transition-all text-lg cursor-pointer text-white"
            style={{ backgroundColor: "#25D366" }}
          >
            <MessageCircle className="w-5 h-5" />
            Abrir WhatsApp
          </button>

          <p className="text-xs text-text-muted text-center leading-snug">
            Después de escribirle al bot ({BOT_PHONE}), volvé acá y esperá el
            código.
          </p>

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setError("");
              setStep("phone");
            }}
            className="w-full text-text-muted font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Cambiar número
          </button>
        </div>
      )}

      {step === "polling_for_otp" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-3">
            <div
              className="mx-auto flex items-center justify-center"
              style={{ width: 80, height: 80 }}
            >
              {pollingTimedOut ? (
                <MessageCircle className="w-10 h-10 text-gold" aria-hidden="true" />
              ) : (
                <div
                  className="w-12 h-12 rounded-full border-4 border-gold/30 border-t-gold animate-spin"
                  aria-hidden="true"
                />
              )}
            </div>
            <h2 className="font-display text-2xl text-gold tracking-wide">
              {pollingTimedOut ? "TARDÓ MUCHO" : "ESPERANDO TU MENSAJE AL BOT..."}
            </h2>
            <p className="text-text-secondary text-sm leading-snug">
              {pollingTimedOut
                ? "Mandá un mensaje al bot por WhatsApp y volvé a intentar."
                : "Apenas le escribas al bot, te mandamos el código acá."}
            </p>
          </div>

          {!pollingTimedOut && pollingElapsed >= 20_000 ? (
            <div className="rounded-xl p-3 space-y-3 bg-bg-elevated border border-border-subtle">
              <p className="text-xs text-text-secondary leading-snug">
                ¿No te llegó? Asegurate de mandarle al menos un mensaje al bot.
                Puede ser &ldquo;Hola&rdquo; o cualquier cosa.
              </p>
              <button
                type="button"
                onClick={handleReopenWhatsApp}
                className="w-full flex items-center justify-center gap-2 font-semibold py-2.5 px-3 rounded-lg transition-all text-sm text-white"
                style={{ backgroundColor: "#25D366" }}
              >
                <MessageCircle className="w-4 h-4" />
                Volver a abrir WhatsApp
              </button>
            </div>
          ) : null}

          {pollingTimedOut ? (
            <button
              type="button"
              onClick={handleReopenWhatsApp}
              className="w-full flex items-center justify-center gap-2 font-bold py-3.5 px-4 rounded-xl transition-all text-base text-white"
              style={{ backgroundColor: "#25D366" }}
            >
              <MessageCircle className="w-5 h-5" />
              Volver a abrir WhatsApp
            </button>
          ) : null}

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setError("");
              setStep("phone");
            }}
            className="w-full text-text-muted font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Cambiar número
          </button>
        </div>
      )}

      {step === "entering_code" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl text-gold tracking-wide">
              INGRESÁ TU CÓDIGO
            </h2>
            <p className="text-text-secondary text-sm">
              Copiá el código de 6 dígitos que te envió el bot
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              inputMode="numeric"
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
              onClick={() => {
                setError("");
                setCode("");
                setStep("waiting_for_whatsapp");
              }}
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Volver
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setError("");
                setCode("");
              }}
              className="w-full text-text-muted text-xs py-1 hover:text-gold transition-colors"
            >
              ¿No llegó? Reenviar
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
