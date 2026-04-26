// app/(auth)/login/password/page.tsx — Password input for returning users.
// Reached from /login when check-phone confirms the phone is registered
// and has a custom password. Skips the bot/OTP loop entirely.
"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { motion } from "framer-motion";
import { ArrowLeft, Eye, EyeOff, Lock } from "lucide-react";

const RETURN_TO_KEY = "lp_returnTo";

function LoginPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") ?? "";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Phone is required to be on this page; if missing, bounce back to /login.
  useEffect(() => {
    if (!phone) {
      router.replace("/login");
    }
  }, [phone, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone) {
      setError("Falta el número. Volvé al login.");
      return;
    }
    if (password.length < 4) {
      setError("La contraseña debe tener al menos 4 caracteres");
      return;
    }

    setLoading(true);
    try {
      await axios.post("/api/auth/login-password", { phone, password });
      const rt =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(RETURN_TO_KEY)
          : null;
      if (rt) window.sessionStorage.removeItem(RETURN_TO_KEY);
      router.push(rt || "/inicio");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(
        e.response?.data?.error ?? "Teléfono o contraseña incorrectos",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = () => {
    const url = new URL("/login", window.location.origin);
    url.searchParams.set("forgot", "1");
    if (phone) url.searchParams.set("phone", phone);
    router.push(url.pathname + url.search);
  };

  // Hide everything but a tiny shell while we redirect on missing phone.
  if (!phone) {
    return <div className="min-h-screen" />;
  }

  // Pretty-print the phone with leading + so it reads naturally to the user.
  const displayPhone = phone.startsWith("+") ? phone : `+${phone}`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle relative z-10"
        style={{ boxShadow: "0 0 60px rgba(255,215,0,0.08)" }}
      >
        <div className="text-center space-y-2">
          <motion.div
            className="mx-auto"
            style={{ width: 80, height: 80, position: "relative" }}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <div
              style={{
                position: "absolute",
                inset: -8,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%)",
                filter: "blur(8px)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pollitos/logo_realistic.webp"
              alt="La Polla"
              width={80}
              height={80}
              style={{
                width: 80,
                height: 80,
                objectFit: "contain",
                position: "relative",
              }}
            />
          </motion.div>
          <h1
            className="font-display text-4xl tracking-wide"
            style={{ color: "#FFD700", textShadow: "0 0 18px rgba(255,215,0,0.3)" }}
          >
            BIENVENIDO DE VUELTA
          </h1>
          <p className="text-text-muted text-sm">{displayPhone}</p>
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
              <Lock
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4"
                aria-hidden="true"
              />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                minLength={4}
                maxLength={128}
                placeholder="Tu contraseña"
                className="w-full pl-9 pr-11 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
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

          {error && (
            <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || password.length < 4}
            className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
            style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <button
            type="button"
            onClick={handleForgot}
            className="w-full text-text-secondary text-sm py-2 hover:text-gold transition-colors"
          >
            ¿Olvidaste tu contraseña?
          </button>

          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full text-text-muted font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Cambiar número
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginPasswordInner />
    </Suspense>
  );
}
