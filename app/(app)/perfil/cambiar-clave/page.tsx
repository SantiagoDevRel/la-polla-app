// app/(app)/perfil/cambiar-clave/page.tsx — Authenticated password rotation.
// Different from /set-password (post-OTP, mandatory) in that it requires the
// CURRENT password to prevent session-hijacking-based silent password changes.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function CambiarClavePage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 4) {
      setError("La nueva contraseña debe tener al menos 4 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (currentPassword === newPassword) {
      setError("La nueva contraseña debe ser distinta a la actual");
      return;
    }

    setLoading(true);
    try {
      await axios.post("/api/auth/set-password", {
        password: newPassword,
        currentPassword,
      });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error guardando la contraseña");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <div className="w-full max-w-md mt-6 space-y-4">
        <button
          type="button"
          onClick={() => router.push("/perfil")}
          className="text-text-secondary hover:text-gold transition-colors flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Volver al perfil
        </button>

        <div
          className="rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          style={{ boxShadow: "0 0 60px rgba(255,215,0,0.05)" }}
        >
          <div className="text-center space-y-2">
            <ShieldCheck
              className="w-10 h-10 text-gold mx-auto"
              aria-hidden="true"
            />
            <h1 className="font-display text-2xl tracking-wide text-gold">
              CAMBIAR CONTRASEÑA
            </h1>
            <p className="text-text-secondary text-sm">
              Mínimo 4 caracteres. Te vamos a pedir tu contraseña actual.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="currentPassword"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Contraseña actual
              </label>
              <input
                id="currentPassword"
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                minLength={4}
                maxLength={128}
                placeholder="••••"
                className="w-full px-4 py-3 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
              />
            </div>

            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Nueva contraseña
              </label>
              <div className="relative">
                <input
                  id="newPassword"
                  type={showPasswords ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={4}
                  maxLength={128}
                  placeholder="••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl outline-none transition-colors bg-bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-gold/40 focus:border-gold/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-gold transition-colors"
                  aria-label={
                    showPasswords ? "Ocultar contraseñas" : "Mostrar contraseñas"
                  }
                >
                  {showPasswords ? (
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
                Confirmá la nueva contraseña
              </label>
              <input
                id="confirmPassword"
                type={showPasswords ? "text" : "password"}
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

            {success && (
              <p className="text-green-live text-sm text-center bg-green-live/10 rounded-xl p-2.5">
                ¡Contraseña actualizada!
              </p>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                currentPassword.length < 4 ||
                newPassword.length < 4 ||
                confirmPassword.length < 4
              }
              className="w-full bg-gold text-bg-base font-bold py-3.5 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: "0 0 20px rgba(255,215,0,0.15)" }}
            >
              {loading ? "Guardando..." : "Cambiar contraseña"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
