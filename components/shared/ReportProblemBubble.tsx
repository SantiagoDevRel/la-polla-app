// components/shared/ReportProblemBubble.tsx — Botón circular en el header
// que abre un modal con un textarea para "reportar problema". Drop-anywhere:
// se monta junto al WhatsAppBubble en BrandHeader y POSTea a /api/feedback.
// El user_id sale del cookie de Supabase server-side, así que el form solo
// pide el mensaje — nada más para no agregar fricción.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquareWarning, Send, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface Props {
  /** Visual size in px. Default 34 to match WhatsAppBubble. */
  size?: number;
  className?: string;
}

export default function ReportProblemBubble({ size = 34, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Portal target only exists client-side. Avoids SSR mismatch.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit() {
    const trimmed = message.trim();
    if (trimmed.length < 1 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const pageUrl =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : null;

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, pageUrl }),
      });
      if (!res.ok) {
        // Inline error: el toast queda tapado por el modal (z-index), por
        // eso lo mostramos dentro del propio modal mientras siga abierto.
        if (res.status === 401) {
          setError("Tienes que iniciar sesión para reportar.");
        } else {
          setError("No pudimos enviar tu reporte. Inténtalo de nuevo.");
        }
        return;
      }
      // Cerramos primero, después el toast — así el toast queda visible.
      setMessage("");
      setOpen(false);
      showToast(
        "¡Gracias por reportar el problema/feedback! Lo solucionaremos pronto",
        "success",
      );
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    if (submitting) return;
    setOpen(false);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Reportar un problema"
        className={`inline-flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: "var(--red-alert, #E4463A)",
          boxShadow: "0 0 12px rgba(228,70,58,0.35)",
        }}
      >
        <MessageSquareWarning
          size={Math.round(size * 0.55)}
          color="white"
          strokeWidth={2.25}
        />
      </button>

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-problem-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl p-5 animate-slide-up"
            style={{
              backgroundColor: "var(--bg-card-elevated)",
              border: "1px solid var(--border-medium)",
              boxShadow: "0 12px 48px rgba(0,0,0,0.7)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2
                id="report-problem-title"
                className="font-display text-lg leading-none"
                style={{ color: "var(--text-primary)" }}
              >
                Reportar un problema/feedback
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                disabled={submitting}
                className="p-1 rounded-full hover:bg-white/10 disabled:opacity-50 transition-colors shrink-0"
              >
                <X size={20} color="var(--text-secondary)" />
              </button>
            </div>

            {error && (
              <div
                className="mb-3 rounded-lg px-3 py-2 text-sm"
                style={{
                  backgroundColor: "rgba(228,70,58,0.12)",
                  border: "1px solid var(--red-alert, #E4463A)",
                  color: "var(--red-alert, #E4463A)",
                }}
                role="alert"
              >
                {error}
              </div>
            )}

            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError(null);
              }}
              maxLength={4000}
              rows={6}
              placeholder="Contanos qué pasó…"
              className="w-full rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--green-live)]"
              style={{
                backgroundColor: "var(--bg-base)",
                border: "1px solid var(--border-medium)",
                color: "var(--text-primary)",
              }}
              autoFocus
              disabled={submitting}
            />

            <div className="flex items-center justify-between mt-3">
              <span
                className="text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {message.length}/4000
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || message.trim().length < 1}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "var(--green-live)",
                  color: "var(--bg-base)",
                }}
              >
                <Send size={16} strokeWidth={2.5} />
                {submitting ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
