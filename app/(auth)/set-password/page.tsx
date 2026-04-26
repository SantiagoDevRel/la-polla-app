// app/(auth)/set-password/page.tsx — Mandatory after OTP success.
// Forces every freshly verified session to pick a password (min 4 chars,
// any type). Middleware enforces redirect to here whenever
// has_custom_password=false for the authenticated user.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

const RETURN_TO_KEY = "lp_returnTo";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 4) {
      setError("La contraseña debe tener al menos 4 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      await axios.post("/api/auth/set-password", { password });
      const rt =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(RETURN_TO_KEY)
          : null;
      if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
      // After setting the password the middleware no longer redirects, so
      // we send the user to /onboarding (which itself checks needsName and
      // forwards to /inicio when the profile is complete).
      router.push(rt || "/onboarding");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error guardando la contraseña");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle relative z-10"
        style={{ boxShadow: "0 0 60px rgba(255,215,0,0.08)" }}
      >
        {/* Brand mark */}
        <div className="text-center space-y-3">
          <motion.div
            className="mx-auto flex items-center justify-center"
            style={{ width: 72, height: 72 }}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <ShieldCheck className="w-12 h-12 text-gold" aria-hidden="true" />
          </motion.div>
          <h1
            className="font-display text-3xl tracking-wide"
            style={{ color: "#FFD700", textShadow: "0 0 18px rgba(255,215,0,0.3)" }}
          >
            CREÁ TU CONTRASEÑA
          </h1>
          <p className="text-text-secondary text-sm leading-snug">
            Para volver a iniciar sesión sin pasar por el bot. Mínimo 4
            caracteres, los que vos quieras.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Contraseña
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                minLength={4}
                maxLength={128}
                placeholder="••••"
                className="w-full px-4 py-3 pr-11 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-gold transition-colors"
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Confirmá la contraseña
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={4}
              maxLength={128}
              placeholder="••••"
              className="w-full px-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
            />
          </div>

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || password.length < 4 || confirmPassword.length < 4}
            className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
            style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
          >
            {loading ? "Guardando..." : "Guardar y continuar"}
          </button>
        </form>

        <p className="text-center text-xs text-text-muted leading-snug">
          La próxima vez que entres, solo vas a necesitar tu número y esta
          contraseña. Sin códigos.
        </p>
      </div>
    </div>
  );
}
