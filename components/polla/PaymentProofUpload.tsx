// components/polla/PaymentProofUpload.tsx
//
// Subir comprobante de pago a una polla admin_collects. Muestra cuenta
// + monto, pide la imagen, preprocesa client-side y POSTea a
// /api/pollas/:slug/payment-proof. El server corre Sonnet vision; si
// confirma → marca paid=true al instante. Si no, status banner inline
// dice que el organizador lo va a revisar manualmente.
"use client";

import { useState } from "react";
import axios from "axios";
import { Upload, Check, AlertTriangle, X as XIcon, Copy, ShieldCheck, Clock } from "lucide-react";
import { preprocessImageForVision } from "@/lib/vision/preprocess-image";

type SubmitStatus = {
  kind: "pending_review" | "verifier_unavailable";
  reason: string | null;
} | null;

interface Props {
  pollaSlug: string;
  buyInAmount: number;
  payoutMethod: "nequi" | "bancolombia" | "otro" | null;
  payoutAccount: string | null;
  payoutAccountName: string | null;
  /** Texto libre extra que el admin agregó (opcional). */
  extraInstructions: string | null;
  onApproved: () => void;
  onPendingReview: (rejectionReason: string | null) => void;
}

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function PaymentProofUpload({
  pollaSlug,
  buyInAmount,
  payoutMethod,
  payoutAccount,
  extraInstructions,
  onApproved,
  onPendingReview,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setError(null);
    setStatus(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function copyAccount() {
    if (!payoutAccount) return;
    try {
      await navigator.clipboard.writeText(payoutAccount);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function submit() {
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const pre = await preprocessImageForVision(file);
      const fd = new FormData();
      fd.append("image", new File([pre.blob], "proof.jpg", { type: "image/jpeg" }));
      const { data } = await axios.post<{
        ok: boolean;
        autoApproved: boolean;
        valid?: boolean;
        rejectionReason?: string | null;
        sourceType?: string;
        reason?: string;
      }>(`/api/pollas/${pollaSlug}/payment-proof`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (data.autoApproved) {
        // Parent va a desmontarnos al refetchar y ver paid=true.
        onApproved();
        return;
      }
      const fallbackReason = data.reason ?? null;
      const kind: SubmitStatus = data.valid === undefined && fallbackReason
        ? { kind: "verifier_unavailable", reason: fallbackReason }
        : { kind: "pending_review", reason: data.rejectionReason ?? null };
      setStatus(kind);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setFile(null);
      onPendingReview(data.rejectionReason ?? null);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error).message ??
        "Error subiendo el comprobante";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Si el admin no configuró la cuenta estructurada (polla vieja) no
  // podemos verificar con AI — caemos al flow original (esperar admin).
  if (!payoutMethod || !payoutAccount) {
    return null;
  }

  return (
    <div className="rounded-2xl p-5 space-y-4 bg-bg-card/80 border border-gold/30">
      <h3 className="font-bold text-text-primary flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-gold" /> Subir comprobante
      </h3>

      {/* Datos del admin a quien transferir — minimal: cuenta + monto */}
      <div className="rounded-xl px-3 py-3 bg-bg-elevated border border-border-subtle space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Pagale a</p>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[16px] font-semibold text-text-primary tabular-nums truncate" style={{ fontFeatureSettings: '"tnum"' }}>
            {payoutAccount}
          </p>
          <button
            type="button"
            onClick={copyAccount}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold transition-colors flex-shrink-0"
          >
            {copied ? (<><Check className="w-3 h-3" /> Copiado</>) : (<><Copy className="w-3 h-3" /> Copiar</>)}
          </button>
        </div>
        <p
          className="font-display text-[20px] text-gold tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {fmtCOP(buyInAmount)}
        </p>
        {extraInstructions ? (
          <p className="text-[11px] text-text-secondary whitespace-pre-wrap leading-snug">
            {extraInstructions}
          </p>
        ) : null}
      </div>

      {/* Status del último intento — visible cuando AI no auto-aprobó.
          Se limpia cuando el user elige un archivo nuevo. */}
      {status ? (
        <div className="rounded-xl px-3 py-3 bg-amber/10 border border-amber/40 space-y-1">
          <p className="text-[14px] text-amber font-bold flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> Comprobante recibido
          </p>
          <p className="text-[12px] text-text-secondary leading-snug">
            El organizador va a revisarlo y aprobarte manualmente.
          </p>
        </div>
      ) : null}

      {/* File picker — CTA prominente, gold, grande */}
      {!file ? (
        <label className="flex flex-col items-center justify-center gap-2 w-full bg-gold/10 border-2 border-dashed border-gold/50 rounded-2xl px-4 py-7 cursor-pointer hover:bg-gold/15 transition-colors">
          <Upload className="w-7 h-7 text-gold" />
          <span className="font-display text-[16px] tracking-wide text-gold uppercase text-center">
            Sube tu screenshot aquí
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      ) : (
        <p className="text-[12px] text-text-secondary text-center truncate">{file.name}</p>
      )}

      {previewUrl ? (
        <div className="rounded-xl overflow-hidden border border-border-subtle relative" style={{ height: 240 }}>
          {/* Preview crudo — usamos <img> para no pegar al optimizer
              de Next con un blob URL temporal. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="comprobante"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
          <button
            type="button"
            onClick={() => pickFile(null)}
            aria-label="Cambiar"
            className="absolute top-2 right-2 inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-base/90 border border-border-subtle text-text-muted hover:text-text-primary"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-[12px] text-red-alert flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!file || submitting}
        className="w-full bg-gold text-bg-base font-display text-base tracking-wide py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(255,215,0,0.2)]"
      >
        {submitting ? "VERIFICANDO…" : "SUBIR Y VERIFICAR"}
      </button>
    </div>
  );
}
