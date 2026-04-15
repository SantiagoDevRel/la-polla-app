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
            className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copiar link
          </button>
          {token ? (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full py-3 rounded-xl text-center font-semibold text-white hover:brightness-110 transition-all inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: "#25D366" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
              </svg>
              Compartir por WhatsApp
            </a>
          ) : (
            <button
              disabled
              className="block w-full py-3 rounded-xl text-center font-semibold text-white opacity-50 cursor-not-allowed inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: "#25D366" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
              </svg>
              Compartir por WhatsApp
            </button>
          )}
          <button onClick={onClose} className="w-full text-text-muted font-medium py-2 text-sm">✕ Cerrar</button>
        </div>
      </div>
    </div>
  );
}
