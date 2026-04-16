// app/(auth)/verify/page.tsx — OTP verification page
// Linked from WhatsApp bot CTA button after sending the OTP.
// Two states: waiting_for_whatsapp (default) → entering_code.
"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ArrowLeft, MessageCircle } from "lucide-react";

const BOT_PHONE = "573117312391";
const RETURN_TO_KEY = "lp_returnTo";

type VerifyStep = "waiting_for_whatsapp" | "entering_code";

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneFromParams = searchParams.get("phone") || "";
  const [phone, setPhone] = useState(phoneFromParams);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<VerifyStep>("waiting_for_whatsapp");

  useEffect(() => {
    if (!phone) {
      const stored = typeof window !== "undefined" ? localStorage.getItem("la_polla_verify_phone") : null;
      if (stored) setPhone(stored);
    }
  }, [phone]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone) {
      setError("Numero de telefono no encontrado. Vuelve al login.");
      return;
    }

    setLoading(true);

    try {
      await axios.put("/api/auth/otp", { phone, code });
      if (typeof window !== "undefined") {
        localStorage.removeItem("la_polla_verify_phone");
      }
      const rt = typeof window !== "undefined"
        ? window.sessionStorage.getItem(RETURN_TO_KEY)
        : null;
      if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
      router.push(rt || "/onboarding");
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || "Codigo invalido o expirado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(80% 60% at 50% 0%, rgba(255,215,0,0.08), transparent 60%), #080c10",
      }}
    >
      {/* State 1: waiting_for_whatsapp */}
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
            <p className="text-text-secondary text-sm">
              Abrí WhatsApp y escribile al bot para recibir tu código
            </p>
          </div>

          <a
            href={`https://wa.me/${BOT_PHONE}?text=Parce%2C%20quiero%20entrar%20a%20La%20Polla%20%F0%9F%90%A3%20%E2%80%94%20m%C3%A1ndame%20el%20c%C3%B3digo%20de%20verificaci%C3%B3n`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 font-bold py-4 px-4 rounded-xl hover:brightness-110 transition-all text-lg cursor-pointer text-white"
            style={{ backgroundColor: "#25D366" }}
          >
            <MessageCircle className="w-5 h-5" />
            Escribirle al bot
          </a>

          <button
            type="button"
            onClick={() => { setError(""); setStep("entering_code"); }}
            className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors text-sm"
          >
            Ya tengo mi código &rarr;
          </button>
        </div>
      )}

      {/* State 2: entering_code */}
      {step === "entering_code" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl text-gold tracking-wide">INGRESÁ TU CÓDIGO</h2>
            <p className="text-text-secondary text-sm">
              Copiá el código de 6 dígitos que te envió el bot
            </p>
            {phone && (
              <p className="text-xs text-gold font-medium">{phone}</p>
            )}
          </div>

          {!phone && (
            <div className="rounded-xl p-4 bg-bg-elevated border border-border-subtle">
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Numero de WhatsApp
              </label>
              <input
                type="tel"
                placeholder="+573001234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 rounded-xl outline-none transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
              />
            </div>
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
              autoFocus
            />

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {loading ? "Verificando..." : "Verificar código"}
            </button>

            <button
              type="button"
              onClick={() => { setError(""); setCode(""); setStep("waiting_for_whatsapp"); }}
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Volver
            </button>

            <button
              type="button"
              onClick={() => router.push("/login")}
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

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 text-center bg-bg-card border border-border-subtle">
            <p className="text-text-muted">Cargando...</p>
          </div>
        </div>
      }
    >
      <VerifyForm />
    </Suspense>
  );
}
