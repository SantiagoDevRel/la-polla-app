// app/(auth)/login/page.tsx — Login with reversed OTP flow
// User enters phone → OTP saved to DB → user opens WhatsApp → bot sends code
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import axios from "axios";
import { ArrowLeft, MessageCircle } from "lucide-react";
import PhoneInput from "@/components/ui/PhoneInput";

type Step = "phone" | "whatsapp" | "verify";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
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
      setStep("whatsapp");
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
      router.push("/onboarding");
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || "Codigo invalido o expirado");
    } finally {
      setVerifying(false);
    }
  };

  // BOT_PHONE: the WhatsApp bot number without the + prefix
  const BOT_PHONE = "573117312391";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {/* Step 1: Phone input */}
      {step === "phone" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center">
            <h1 className="font-display text-[40px] text-gold tracking-wide">
              La Polla
            </h1>
            <p className="text-text-secondary mt-1">
              Ingresa tu numero de WhatsApp para recibir tu codigo de acceso
            </p>
          </div>

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
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {loading ? "Enviando..." : "Enviar codigo"}
            </button>
          </form>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-sm text-text-muted">
              Al continuar, aceptas nuestros terminos y condiciones
            </p>
          </div>
        </div>
      )}

      {/* Step 2: WhatsApp prompt + OTP input */}
      {step === "whatsapp" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center">
            <div className="mx-auto mb-3" style={{ width: 80, height: 80, borderRadius: "50%", overflow: "hidden" }}>
              <img
                src="/pollitos/pollito_whatsapp_logo.webp"
                alt="Bot La Polla"
                width={80}
                height={80}
                style={{ width: 80, height: 80, objectFit: "cover" }}
              />
            </div>
            {isNewUser ? (
              <>
                <h1 className="font-display text-[28px] text-gold tracking-wide">
                  ABRE WHATSAPP
                </h1>
                <p className="text-text-secondary text-sm mt-2 leading-relaxed">
                  Tocá el botón, enviá el mensaje y en segundos te llega el código 🔐
                </p>
              </>
            ) : (
              <>
                <h1 className="font-display text-[28px] text-gold tracking-wide">
                  CODIGO ENVIADO
                </h1>
                <p className="text-text-secondary text-sm mt-2 leading-relaxed">
                  Te enviamos el codigo por WhatsApp.
                  <br />
                  Revisá tu chat con La Polla 🐔
                </p>
              </>
            )}
          </div>

          {isNewUser ? (
            <>
              {/* New user: must message bot first (WhatsApp policy) */}
              <a
                href={`https://wa.me/${BOT_PHONE}?text=Parce%2C%20quiero%20entrar%20a%20La%20Polla%20%F0%9F%90%A3%20%E2%80%94%20m%C3%A1ndame%20el%20c%C3%B3digo%20de%20verificaci%C3%B3n`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-gold text-bg-base font-bold py-4 px-4 rounded-xl hover:brightness-110 transition-all text-lg cursor-pointer"
                style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
              >
                <MessageCircle className="w-5 h-5" />
                Escribirle al bot 💬
              </a>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-text-muted text-xs whitespace-nowrap">o ingresa el codigo si ya lo tienes</span>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
            </>
          ) : (
            <>
              {/* Returning user: fallback link in case they didn't receive it */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-text-muted text-xs whitespace-nowrap">ingresa el codigo de 6 digitos</span>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
            </>
          )}

          {/* OTP input */}
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
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> Cambiar numero
            </button>

            {!isNewUser && (
              <a
                href={`https://wa.me/${BOT_PHONE}?text=Parce%2C%20quiero%20entrar%20a%20La%20Polla%20%F0%9F%90%A3%20%E2%80%94%20m%C3%A1ndame%20el%20c%C3%B3digo%20de%20verificaci%C3%B3n`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-text-muted text-xs text-center hover:text-gold transition-colors flex items-center justify-center gap-1"
              >
                <MessageCircle className="w-3 h-3" />
                ¿No te llegó el código? Escríbele al bot 💬
              </a>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
