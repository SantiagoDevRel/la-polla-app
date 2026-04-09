// app/(auth)/verify/page.tsx — Página de verificación del código OTP
"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";

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
      router.push("/dashboard");
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || "Código inválido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-colombia-blue">🔐 Verificación</h1>
        <p className="text-gray-600 mt-2">
          Ingresá el código de 6 dígitos que te enviamos por WhatsApp
        </p>
        {phone && (
          <p className="text-sm text-colombia-blue font-medium mt-1">
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
            className="w-full px-4 py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none text-center text-3xl tracking-[0.5em] font-mono"
            required
          />
        </div>

        {error && (
          <p className="text-colombia-red text-sm text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full bg-colombia-yellow text-colombia-blue font-bold py-3 px-4 rounded-xl hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg"
        >
          {loading ? "Verificando..." : "Verificar código"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="w-full text-colombia-blue font-medium py-2 hover:underline"
        >
          ← Cambiar número
        </button>
      </form>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-colombia-blue flex flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 text-center">
            <p className="text-gray-500">Cargando...</p>
          </div>
        }
      >
        <VerifyForm />
      </Suspense>
    </div>
  );
}
