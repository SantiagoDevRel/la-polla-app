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
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
        style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
      >
        <div className="text-center">
          <h1 className="font-display text-[40px] text-gold tracking-wide">
            La Polla
          </h1>
          <p className="text-text-secondary mt-1">
            Ingresá tu número de WhatsApp para recibir tu código de acceso
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-text-secondary mb-1.5">
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
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !turnstileToken || !phone}
            className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-lg"
            style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
          >
            {loading ? "Enviando..." : "Recibir código por WhatsApp"}
          </button>
        </form>

        <div className="border-t border-border-subtle pt-4">
          <p className="text-center text-sm text-text-muted">
            Al continuar, aceptás nuestros términos y condiciones
          </p>
        </div>
      </div>
    </div>
  );
}
