// app/(auth)/login/page.tsx — Página de inicio de sesión con OTP por WhatsApp
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import axios from "axios";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await axios.post("/api/auth/otp", {
        phone,
        turnstileToken,
      });
      router.push(`/verify?phone=${encodeURIComponent(phone)}`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || "Error al enviar el código");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-colombia-blue flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-6">
        {process.env.NODE_ENV === "development" && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 text-sm rounded-lg px-4 py-2 text-center">
            Modo desarrollo — el OTP aparece en consola y en la respuesta del API
          </div>
        )}
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
            <input
              id="phone"
              type="tel"
              placeholder="573001234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none text-lg"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Incluí el código de país (57 para Colombia)
            </p>
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
            disabled={loading || !turnstileToken}
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
