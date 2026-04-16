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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [isNewUser, setIsNewUser] = useState(true);

  const handlePhoneChange = useCallback((value: string) => {
    setPhone(value);
  }, []);

  const BOT_PHONE = "573117312391";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone || phone.length < 10) {
      setError("Ingresa un numero de telefono valido");
      return;
    }

    setLoading(true);

    try {
      const { data: otpRes } = await axios.post("/api/auth/otp", {
        phone,
        turnstileToken,
      });
      setIsNewUser(otpRes.newUser ?? true);
      setStep("code");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || "Error al enviar el codigo");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerifying(true);

    try {
      await axios.put("/api/auth/otp", { phone, code });
      if (isNewUser) {
        router.push("/onboarding");
      } else {
        const rt = typeof window !== "undefined"
          ? window.sessionStorage.getItem(RETURN_TO_KEY)
          : null;
        if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
        router.push(rt || "/dashboard");
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || "Codigo invalido o expirado");
    } finally {
      setVerifying(false);
    }
  };

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
              disabled={loading || !turnstileToken || !phone}
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              <MessageCircle className="w-5 h-5" />
              {loading ? "Enviando..." : "Pedir código por WhatsApp"}
            </button>
          </form>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-sm text-text-muted">
              Al continuar, aceptas nuestros terminos y condiciones
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Code input */}
      {step === "code" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <div className="mx-auto mb-1" style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pollitos/pollito_whatsapp_logo.webp"
                alt="Bot La Polla"
                width={64}
                height={64}
                style={{ width: 64, height: 64, objectFit: "cover" }}
              />
            </div>
            <p className="text-text-secondary text-sm">
              {isNewUser
                ? "Abrí WhatsApp, escribile al bot y copiá el código."
                : "Te enviamos el código por WhatsApp. Revisá tu chat con La Polla."}
            </p>
          </div>

          {isNewUser && (
            <a
              href={`https://wa.me/${BOT_PHONE}?text=Parce%2C%20quiero%20entrar%20a%20La%20Polla%20%F0%9F%90%A3%20%E2%80%94%20m%C3%A1ndame%20el%20c%C3%B3digo%20de%20verificaci%C3%B3n`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all text-base cursor-pointer text-white"
              style={{ backgroundColor: "#25D366" }}
            >
              <MessageCircle className="w-5 h-5" />
              Escribirle al bot
            </a>
          )}

          <form onSubmit={handleVerify} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] tracking-[0.5em] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
              required
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
              {verifying ? "Verificando..." : "Verificar codigo"}
            </button>

            <button
              type="button"
              onClick={() => { setStep("phone"); setError(""); setCode(""); }}
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> {isNewUser ? "¿No llegó? Reenviar" : "Cambiar número o reenviar"}
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
