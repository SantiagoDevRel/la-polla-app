// components/polla/PaymentProofUpload.tsx
//
// Subir comprobante de pago a una polla admin_collects. Muestra los
// datos esperados (cuenta del admin), pide la imagen, preprocesa
// client-side y POSTea a /api/pollas/:slug/payment-proof. El server
// corre Sonnet vision; si confirma → marca paid=true al instante.
//
// Disclaimer obligatorio:
//   - Screenshot guardado 7 días.
//   - AI lo revisa primero (puede equivocarse).
//   - Organizador puede revertir el pago si detecta algo raro.
"use client";

import { useState } from "react";
import axios from "axios";
import { Upload, Check, AlertTriangle, X as XIcon, Copy, ShieldCheck } from "lucide-react";
import { preprocessImageForVision } from "@/lib/vision/preprocess-image";

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

const METHOD_LABEL: Record<string, string> = {
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  otro: "Otro",
};

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function PaymentProofUpload({
  pollaSlug,
  buyInAmount,
  payoutMethod,
  payoutAccount,
  payoutAccountName,
  extraInstructions,
  onApproved,
  onPendingReview,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function pickFile(f: File | null) {
    setFile(f);
    setError(null);
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
    try {
      const pre = await preprocessImageForVision(file);
      const fd = new FormData();
      fd.append("image", new File([pre.blob], "proof.jpg", { type: "image/jpeg" }));
      const { data } = await axios.post<{
        ok: boolean;
        autoApproved: boolean;
        valid: boolean;
        rejectionReason: string | null;
        sourceType: string;
      }>(`/api/pollas/${pollaSlug}/payment-proof`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (data.autoApproved) {
        onApproved();
      } else {
        onPendingReview(data.rejectionReason);
      }
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
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-bold text-text-primary">Subir comprobante</h3>
          <p className="text-[12px] text-text-muted mt-0.5">
            Subí el screenshot de la transferencia y la AI te aprueba al instante si los datos coinciden.
          </p>
        </div>
      </div>

      {/* Datos del admin a quien transferir */}
      <div className="rounded-xl px-3 py-3 bg-bg-elevated border border-border-subtle space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Pagale a</p>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
              {METHOD_LABEL[payoutMethod] ?? payoutMethod} · {payoutAccount}
            </p>
            {payoutAccountName ? (
              <p className="text-[11px] text-text-secondary truncate">A nombre de {payoutAccountName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={copyAccount}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold transition-colors flex-shrink-0"
          >
            {copied ? (<><Check className="w-3 h-3" /> Copiado</>) : (<><Copy className="w-3 h-3" /> Copiar</>)}
          </button>
        </div>
        <p
          className="font-display text-[18px] text-gold tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {fmtCOP(buyInAmount)} exactos
        </p>
        {extraInstructions ? (
          <p className="text-[11px] text-text-secondary whitespace-pre-wrap leading-snug pt-1">
            {extraInstructions}
          </p>
        ) : null}
      </div>

      {/* Disclaimer */}
      <div className="rounded-lg px-3 py-2 bg-amber/5 border border-amber/20 space-y-1">
        <p className="text-[11px] text-amber font-semibold">Antes de subir, leé:</p>
        <ul className="text-[11px] text-text-secondary space-y-0.5 list-disc list-inside">
          <li>El screenshot se guarda 7 días y después se borra solo.</li>
          <li>La AI revisa primero — si te aprueba, podés pronosticar al instante.</li>
          <li>El organizador puede revertir tu pago a no-aprobado si detecta algo raro.</li>
        </ul>
      </div>

      {/* File picker */}
      <label className="flex items-center justify-center gap-2 w-full bg-bg-elevated border border-dashed border-border-subtle rounded-xl px-4 py-5 cursor-pointer hover:border-gold/40 transition-colors text-[13px] text-text-secondary">
        <Upload className="w-4 h-4" />
        {file ? file.name : "Tocá para elegir tu screenshot"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </label>

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
