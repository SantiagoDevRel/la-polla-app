// app/(auth)/verify/page.tsx — Página de verificación del código OTP
"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ArrowLeft } from "lucide-react";

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") || "";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!phone) {
      router.push("/login");
    }
  }, [phone, router]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await axios.put("/api/auth/otp", { phone, code });
      router.push("/onboarding");
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || "Código inválido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
      style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
    >
      <div className="text-center">
        <h1 className="font-display text-[32px] text-gold tracking-wide">Verificación</h1>
        <p className="text-text-secondary mt-1">
          Ingresá el código de 6 dígitos que te enviamos por WhatsApp
        </p>
        {phone && (
          <p className="text-sm text-gold font-medium mt-1.5">
            📱 {phone}
          </p>
        )}
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <div>
          <input
            type="text"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] tracking-[0.5em] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
            required
          />
        </div>

        {error && (
          <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg"
          style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
        >
          {loading ? "Verificando..." : "Verificar código"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" /> Cambiar número
        </button>
      </form>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl p-6 text-center bg-bg-card border border-border-subtle">
            <p className="text-text-muted">Cargando...</p>
          </div>
        }
      >
        <VerifyForm />
      </Suspense>
    </div>
  );
}
