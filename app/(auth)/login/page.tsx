// app/(auth)/login/page.tsx — Página de inicio de sesión con OTP por WhatsApp
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import axios from "axios";
import PhoneInput from "@/components/ui/PhoneInput";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handlePhoneChange = useCallback((value: string) => {
    setPhone(value);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone || phone.length < 10) {
      setError("Ingresá un número de teléfono válido");
      return;
    }

    setLoading(true);

    try {
      await axios.post("/api/auth/otp", {
        phone,
        turnstileToken,
      });
      router.push(`/verify?phone=${encodeURIComponent(phone)}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || "Error al enviar el código");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-colombia-blue flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-colombia-blue">⚽ La Polla</h1>
          <p className="text-gray-600 mt-2">
            Ingresá tu número de WhatsApp para recibir tu código de acceso
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
              Número de WhatsApp
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
            <p className="text-colombia-red text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !turnstileToken || !phone}
            className="w-full bg-colombia-yellow text-colombia-blue font-bold py-3 px-4 rounded-xl hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg"
          >
            {loading ? "Enviando..." : "Recibir código por WhatsApp"}
          </button>
        </form>

        <div className="border-t border-colombia-yellow pt-4">
          <p className="text-center text-sm text-gray-500">
            Al continuar, aceptás nuestros términos y condiciones
          </p>
        </div>
      </div>
    </div>
  );
}
