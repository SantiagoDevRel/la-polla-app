// components/polla/InviteModal.tsx — Modal de invitación "estadio de noche"
// Bottom-sheet style, overlay oscuro, botones gold y verde WhatsApp
"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface InviteModalProps {
  pollaSlug: string;
  pollaName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function InviteModal({ pollaSlug, pollaName, isOpen, onClose }: InviteModalProps) {
  const { showToast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);

  // Fetch (or mint) the open invite token when the modal opens. Closed pollas
  // cannot be joined without this token appended to the link.
  useEffect(() => {
    if (!isOpen || token) return;
    let cancelled = false;
    setLoadingToken(true);
    axios
      .get<{ token: string }>(`/api/pollas/${pollaSlug}/invite-token`)
      .then(({ data }) => { if (!cancelled) setToken(data.token); })
      .catch((err) => {
        console.error("[InviteModal] token fetch failed:", err);
      })
      .finally(() => { if (!cancelled) setLoadingToken(false); });
    return () => { cancelled = true; };
  }, [isOpen, pollaSlug, token]);

  if (!isOpen) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = token
    ? `${origin}/unirse/${pollaSlug}?token=${token}`
    : `${origin}/unirse/${pollaSlug}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Únete a mi polla "${pollaName}": ${link}`)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      showToast("¡Link copiado!", "success");
    } catch {
      showToast("No se pudo copiar", "error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Overlay */}
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }} onClick={onClose} />

      {/* Card */}
      <div className="relative w-full max-w-lg p-6 space-y-4 animate-slide-up safe-bottom"
        style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-medium)", borderRadius: "24px 24px 0 0" }}>
        <div className="w-10 h-1 rounded-full mx-auto" style={{ backgroundColor: "var(--border-medium)" }} />

        <h3 className="text-lg font-bold text-text-primary text-center">
          Invitar amigos a {pollaName}
        </h3>

        <div className="rounded-xl p-3 text-sm break-all text-center"
          style={{ backgroundColor: "var(--bg-card-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
          {loadingToken && !token ? "Generando link…" : link}
        </div>

        <div className="space-y-2">
          <button
            onClick={handleCopy}
            disabled={loadingToken || !token}
            className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            📋 Copiar link
          </button>
          {token ? (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full py-3 rounded-xl text-center font-semibold text-white hover:brightness-110 transition-all"
              style={{ backgroundColor: "#25D366" }}>
              📱 Compartir por WhatsApp
            </a>
          ) : (
            <button
              disabled
              className="block w-full py-3 rounded-xl text-center font-semibold text-white opacity-50 cursor-not-allowed"
              style={{ backgroundColor: "#25D366" }}>
              📱 Compartir por WhatsApp
            </button>
          )}
          <button onClick={onClose} className="w-full text-text-muted font-medium py-2 text-sm">✕ Cerrar</button>
        </div>
      </div>
    </div>
  );
}
