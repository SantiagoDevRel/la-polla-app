// app/(auth)/onboarding/page.tsx — "Como te llamas?" screen for first-time users
// Shown after OTP verification if display_name looks like a phone number
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { createClient } from "@/lib/supabase/client";
import { UserCircle } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function checkProfile() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        // Check if user already has a real display name
        const { data: profile } = await supabase
          .from("users")
          .select("display_name, whatsapp_number")
          .eq("id", user.id)
          .single();

        if (profile) {
          const displayName = profile.display_name || "";
          const phone = profile.whatsapp_number || "";
          const phoneWithoutPlus = phone.replace("+", "");

          // If display_name is a real name (not phone number), skip onboarding
          const isPhoneNumber = displayName === phone
            || displayName === phoneWithoutPlus
            || /^\d{8,15}$/.test(displayName);

          if (!isPhoneNumber && displayName.length >= 2) {
            router.push("/dashboard");
            return;
          }
        }
      } catch {
        // If anything fails, just show the form
      } finally {
        setChecking(false);
      }
    }
    checkProfile();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("El nombre debe tener al menos 2 caracteres");
      return;
    }

    setLoading(true);
    try {
      await axios.patch("/api/users/me", { display_name: trimmed });
      router.push("/dashboard");
    } catch {
      setError("Error guardando tu nombre. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-muted text-sm">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
        style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
      >
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
            <UserCircle className="w-8 h-8 text-gold" />
          </div>
          <h1 className="font-display text-[32px] text-gold tracking-wide">
            Como te llamas?
          </h1>
          <p className="text-text-secondary mt-1">
            Los demas participantes veran este nombre
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            autoFocus
            maxLength={50}
            className="w-full px-4 py-4 rounded-xl outline-none text-center text-lg font-medium transition-colors duration-200 bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
          />

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-alert/10 rounded-xl p-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || name.trim().length < 2}
            className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed text-lg cursor-pointer"
            style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
          >
            {loading ? "Guardando..." : "Continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
