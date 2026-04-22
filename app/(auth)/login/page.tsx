// app/(auth)/login/page.tsx — Login with reversed OTP flow
// Step 1: Phone input + "Pedir código" CTA
// Step 2: Code input + Verify
"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import axios from "axios";
import { ArrowLeft, MessageCircle } from "lucide-react";
import PhoneInput from "@/components/ui/PhoneInput";
import TournamentBadge from "@/components/shared/TournamentBadge";

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
  const [step, setStep] = useState<Step>("phone");
  const [preview, setPreview] = useState<PollaPreview | null>(null);

  useEffect(() => {
    const rt = searchParams.get("returnTo");
    if (rt && typeof window !== "undefined") {
      window.sessionStorage.setItem(RETURN_TO_KEY, rt);
    }
    const stored = rt
      ?? (typeof window !== "undefined"
            ? window.sessionStorage.getItem(RETURN_TO_KEY)
            : null);
    if (!stored) return;
    const slugMatch = stored.match(/^\/(?:pollas|unirse)\/([^/?#]+)/);
    const tokenMatch = stored.match(/^\/invites\/polla\/([^/?#]+)/);
    if (!slugMatch && !tokenMatch) return;
    const params = new URLSearchParams(
      slugMatch ? { slug: slugMatch[1] } : { token: tokenMatch![1] }
    );
    axios
      .get<{ polla: Omit<PollaPreview, "participantCount">; participantCount: number }>(
        `/api/pollas/preview?${params.toString()}`
      )
      .then(({ data }) => setPreview({ ...data.polla, participantCount: data.participantCount }))
      .catch(() => {});
  }, [searchParams]);

  const [phone, setPhone] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [isNewUser] = useState(true);

  const handlePhoneChange = useCallback((value: string) => {
    setPhone(value);
  }, []);

  const BOT_PHONE = "573117312391";

  // Phone submit no longer sends the OTP directly. We first park the user on
  // the bot-gate screen so they open the WhatsApp chat with the bot and
  // (re)open the 24h service window. OTP is sent after they tap "Ya le
  // escribí al bot". Without this gate Meta silently rejects free-text
  // messages outside the window and users never see the code.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone || phone.length < 10) {
      setError("Ingresa un numero de telefono valido");
      return;
    }
    if (!turnstileToken) {
      setError("Completá la verificación anti-bot");
      return;
    }

    setStep("waiting_for_whatsapp");
  };

  // Tap on "Abrir WhatsApp": register the phone as waiting, open the deep
  // link in a new tab, and transition to the polling step. The bot webhook
  // will generate + send the OTP once the user messages the bot; the poll
  // endpoint sees code_sent=true and we advance to the code-entry step.
  const handleOpenWhatsApp = async () => {
    setError("");
    try {
      await axios.post("/api/auth/login-wait", { phone });
    } catch (err) {
      console.warn("[login] login-wait register failed:", err);
      // Non-fatal: polling still works if the upsert races with the webhook.
    }
    if (typeof window !== "undefined") {
      window.open(
        `https://wa.me/${BOT_PHONE}?text=Hola%20parce%2C%20mandame%20el%20c%C3%B3digo%20de%20la%20polla`,
        "_blank"
      );
    }
    setStep("polling_for_otp");
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerifying(true);

    try {
      const { data: verifyRes } = await axios.put("/api/auth/otp", { phone, code });
      const newUser = verifyRes?.newUser ?? isNewUser;
      if (newUser) {
        router.push("/onboarding");
      } else {
        const rt = typeof window !== "undefined"
          ? window.sessionStorage.getItem(RETURN_TO_KEY)
          : null;
        if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
        router.push(rt || "/inicio");
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || "Codigo invalido o expirado");
    } finally {
      setVerifying(false);
    }
  };

  // Poll login_pending_sessions every 3 seconds while the user messages the
  // bot. Advance to the code-entry step as soon as the webhook flips
  // code_sent=true, or surface an error on expiry (~15 min TTL) or hard
  // frontend timeout at 5 min.
  useEffect(() => {
    if (step !== "polling_for_otp") return;
    let cancelled = false;
    const startedAt = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;

    async function tick() {
      if (cancelled) return;
      try {
        const { data } = await axios.get<{ status: string }>(
          `/api/auth/login-poll?phone=${encodeURIComponent(phone)}`
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
      if (Date.now() - startedAt > TIMEOUT_MS) {
        if (!cancelled) {
          setError("No recibimos tu mensaje al bot. Volvé a intentar.");
          setStep("waiting_for_whatsapp");
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

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(80% 60% at 50% 0%, rgba(255,215,0,0.08), transparent 60%)," +
          "radial-gradient(60% 50% at 80% 100%, rgba(0,230,118,0.05), transparent 60%)," +
          "#080c10",
      }}
    >
      {/* Step 1: Phone input */}
      {step === "phone" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle relative z-10"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.08)" }}
        >
          {/* Brand header */}
          <div className="text-center space-y-2">
            <div className="mx-auto" style={{ width: 80, height: 80, position: "relative" }}>
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
                style={{ width: 80, height: 80, objectFit: "contain", position: "relative" }}
              />
            </div>
            <h1
              className="font-display text-5xl tracking-wide"
              style={{ color: "#FFD700", textShadow: "0 0 24px rgba(255,215,0,0.35)" }}
            >
              LA POLLA
            </h1>
            <p className="text-text-muted text-sm">
              La polla deportiva de tus amigos
            </p>
          </div>

          {/* Polla preview (only when arriving from an invite/polla link) */}
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
              <label htmlFor="phone" className="block text-sm font-medium text-text-secondary mb-1.5">
                Numero de WhatsApp
              </label>
              <PhoneInput onChange={handlePhoneChange} />
            </div>

            <div className="flex justify-center">
              <Turnstile
                siteKey={process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY || ""}
                onSuccess={setTurnstileToken}
              />
            </div>

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={!turnstileToken || !phone}
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              <MessageCircle className="w-5 h-5" />
              Continuar
            </button>
          </form>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-sm text-text-muted">
              Al continuar, aceptas nuestros terminos y condiciones
            </p>
          </div>
        </div>
      )}

      {/* State: waiting_for_whatsapp — bot-chat gate before OTP send.
          User must open the WhatsApp chat with the bot and send "Hola" so
          Meta's 24h service window opens; only then do we send the OTP. */}
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
                style={{ width: 80, height: 80, objectFit: "cover", borderRadius: "50%" }}
              />
            </div>
            <h2 className="font-display text-2xl text-gold tracking-wide">ABRÍ WHATSAPP CON EL BOT</h2>
            <p className="text-text-secondary text-sm leading-snug">
              Para recibir el código, escribile al bot y te mandamos el código acá.
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
            Después de escribirle al bot, volvé acá y esperá el código.
          </p>

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
          )}

          <button
            type="button"
            onClick={() => { setError(""); setStep("phone"); }}
            className="w-full text-text-muted font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Cambiar número
          </button>
        </div>
      )}

      {/* State: polling_for_otp — waiting for the bot webhook to flip
          code_sent=true on login_pending_sessions. */}
      {step === "polling_for_otp" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-3">
            <div className="mx-auto flex items-center justify-center" style={{ width: 80, height: 80 }}>
              <div
                className="w-12 h-12 rounded-full border-4 border-gold/30 border-t-gold animate-spin"
                aria-hidden="true"
              />
            </div>
            <h2 className="font-display text-2xl text-gold tracking-wide">ESPERANDO TU MENSAJE AL BOT...</h2>
            <p className="text-text-secondary text-sm leading-snug">
              Apenas le escribas al bot, te mandamos el código acá.
            </p>
          </div>

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
          )}

          <button
            type="button"
            onClick={() => { setError(""); setStep("phone"); }}
            className="w-full text-text-muted font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Cancelar y volver
          </button>
        </div>
      )}

      {/* State: entering_code — code input + verify */}
      {step === "entering_code" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl text-gold tracking-wide">INGRESÁ TU CÓDIGO</h2>
            <p className="text-text-secondary text-sm">
              {isNewUser
                ? "Copiá el código de 6 dígitos que te envió el bot"
                : "Revisá tu chat con La Polla en WhatsApp"}
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] tracking-[0.5em] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
              required
              autoFocus
            />

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="w-full bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {verifying ? "Verificando..." : "Verificar código"}
            </button>

            {isNewUser ? (
              <button
                type="button"
                onClick={() => { setError(""); setCode(""); setStep("waiting_for_whatsapp"); }}
                className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Volver
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setStep("phone"); setError(""); setCode(""); }}
                className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Cambiar número o reenviar
              </button>
            )}

            {isNewUser && (
              <button
                type="button"
                onClick={() => { setStep("phone"); setError(""); setCode(""); }}
                className="w-full text-text-muted text-xs py-1 hover:text-gold transition-colors"
              >
                ¿No llegó? Reenviar
              </button>
            )}
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
