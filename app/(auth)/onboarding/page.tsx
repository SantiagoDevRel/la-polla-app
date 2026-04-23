// app/(auth)/onboarding/page.tsx — Onboarding: name + pollito selection
// Step 1: "¿Cómo te llamas?" → Step 2: "Elige tu pollito"
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import {
  POLLITO_TYPES,
  DEFAULT_POLLITO,
  getPollitoBase,
  getPollitoByPosition,
} from "@/lib/pollitos";
import FootballLoader from "@/components/ui/FootballLoader";
import { needsName } from "@/lib/users/needs-name";

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1 mb-3" aria-label={`Paso ${current} de ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={
            "flex-1 h-[3px] rounded-full " +
            (i < current ? "bg-gold" : "bg-[rgba(255,255,255,0.08)]")
          }
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [selectedPollito, setSelectedPollito] = useState(DEFAULT_POLLITO);
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

        const { data: profile } = await supabase
          .from("users")
          .select("display_name, whatsapp_number")
          .eq("id", user.id)
          .single();

        if (profile && !needsName(profile.display_name)) {
          const rt = typeof window !== "undefined"
            ? window.sessionStorage.getItem("lp_returnTo")
            : null;
          if (rt) window.sessionStorage.removeItem("lp_returnTo");
          router.push(rt || "/inicio");
          return;
        }
      } catch {
        // If anything fails, just show the form
      } finally {
        setChecking(false);
      }
    }
    checkProfile();
  }, [router]);

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("El nombre debe tener al menos 2 caracteres");
      return;
    }
    setStep(2);
  }

  async function handleFinish() {
    setError("");
    setLoading(true);
    try {
      await axios.patch("/api/users/me", {
        display_name: name.trim(),
        avatar_url: selectedPollito,
      });
      const rt = typeof window !== "undefined"
        ? window.sessionStorage.getItem("lp_returnTo")
        : null;
      if (rt) window.sessionStorage.removeItem("lp_returnTo");
      router.push(rt || "/inicio");
    } catch {
      setError("Error guardando tu perfil. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <FootballLoader />
          <p className="text-text-muted text-sm">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {step === 1 && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-6"
          style={{
            background: "#0e1420",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 0 60px rgba(255,215,0,0.05)",
          }}
        >
          <StepDots total={2} current={1} />
          <div className="text-center">
            <div className="text-[10px] font-bold tracking-[0.14em] text-text-muted uppercase">
              Paso 1 de 2
            </div>
            <motion.img
              src={getPollitoBase(DEFAULT_POLLITO)}
              alt=""
              style={{ width: 72, height: 72, objectFit: "contain", margin: "8px auto 8px" }}
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            <h1 className="font-display text-gold" style={{ fontSize: 28, letterSpacing: "0.1em" }}>
              ¿Cómo te llamas?
            </h1>
            <p style={{ color: "#F5F7FA", fontSize: 13, marginTop: 4 }}>
              Los demás participantes verán este nombre
            </p>
          </div>

          <form onSubmit={handleNameSubmit} className="space-y-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
              autoFocus
              maxLength={50}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 12,
                outline: "none",
                textAlign: "center",
                fontSize: 16,
                fontWeight: 500,
                fontFamily: "'Outfit', sans-serif",
                background: "#131d2e",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#f0f4ff",
              }}
            />

            {error && (
              <p style={{ color: "#ff3d57", fontSize: 13, textAlign: "center", background: "rgba(255,61,87,0.1)", borderRadius: 10, padding: 8 }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={name.trim().length < 2}
              style={{
                width: "100%",
                background: "#FFD700",
                color: "#080c10",
                fontWeight: 700,
                padding: "14px 16px",
                borderRadius: 12,
                border: "none",
                fontSize: 16,
                cursor: "pointer",
                fontFamily: "'Outfit', sans-serif",
                opacity: name.trim().length < 2 ? 0.4 : 1,
                boxShadow: "0 0 20px rgba(255,215,0,0.15)",
              }}
            >
              Continuar
            </button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div
          className="w-full max-w-md rounded-2xl p-5 space-y-4"
          style={{
            background: "#0e1420",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 0 60px rgba(255,215,0,0.05)",
            maxHeight: "90vh",
            overflowY: "auto",
          }}
        >
          <StepDots total={2} current={2} />
          <div className="text-center">
            <div className="text-[10px] font-bold tracking-[0.14em] text-text-muted uppercase">
              Paso 2 de 2
            </div>
            <h1
              className="font-display text-gold mt-1"
              style={{ fontSize: 28, letterSpacing: "0.06em", lineHeight: 1 }}
            >
              ELEGÍ TU POLLITO
            </h1>
            <p style={{ color: "#F5F7FA", fontSize: 13, marginTop: 4 }}>
              Tu avatar en todas las pollas
            </p>
          </div>

          {/* Breathing hero pollito with radial glow — mirrors the design
              spec; always shows the current selection in its lider pose so
              users get instant visual feedback on tap. */}
          <div
            className="mx-auto flex items-center justify-center"
            style={{
              width: 140,
              height: 140,
              position: "relative",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(255,215,0,0.28) 0%, transparent 70%)",
                filter: "blur(6px)",
              }}
            />
            <motion.img
              key={selectedPollito}
              src={getPollitoByPosition(selectedPollito, 1, 1)}
              alt=""
              style={{
                width: 120,
                height: 120,
                objectFit: "contain",
                position: "relative",
              }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              initial={{ opacity: 0.6, scale: 0.96 }}
              onAnimationStart={undefined}
            />
          </div>
          <div className="text-center">
            <div
              className="font-display text-gold"
              style={{ fontSize: 18, letterSpacing: "0.08em" }}
            >
              {(POLLITO_TYPES.find((p) => p.id === selectedPollito)?.label || "").toUpperCase()}
            </div>
          </div>

          {/* Pollito grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {POLLITO_TYPES.map((p) => {
              const isSelected = selectedPollito === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPollito(p.id)}
                  style={{
                    background: isSelected ? "rgba(255,215,0,0.08)" : "#131d2e",
                    border: isSelected ? "2px solid #FFD700" : "2px solid rgba(255,255,255,0.06)",
                    borderRadius: 12,
                    padding: "8px 4px 6px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <img
                    src={getPollitoBase(p.id)}
                    alt={p.label}
                    style={{ width: 48, height: 48, objectFit: "contain" }}
                  />
                  <span style={{
                    fontSize: 9,
                    color: isSelected ? "#FFD700" : "#F5F7FA",
                    fontWeight: isSelected ? 600 : 400,
                    fontFamily: "'Outfit', sans-serif",
                    textAlign: "center",
                    lineHeight: 1.2,
                  }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          {error && (
            <p style={{ color: "#ff3d57", fontSize: 13, textAlign: "center", background: "rgba(255,61,87,0.1)", borderRadius: 10, padding: 8 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                flex: 1,
                background: "#131d2e",
                color: "#F5F7FA",
                fontWeight: 600,
                padding: "12px",
                borderRadius: 11,
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
                fontFamily: "'Outfit', sans-serif",
                fontSize: 14,
              }}
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={handleFinish}
              disabled={loading}
              style={{
                flex: 2,
                background: "#FFD700",
                color: "#080c10",
                fontWeight: 700,
                padding: "12px",
                borderRadius: 11,
                border: "none",
                cursor: "pointer",
                fontFamily: "'Outfit', sans-serif",
                fontSize: 14,
                opacity: loading ? 0.4 : 1,
                boxShadow: "0 0 20px rgba(255,215,0,0.15)",
              }}
            >
              {loading ? "Guardando..." : "¡DALE, LISTO!"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
