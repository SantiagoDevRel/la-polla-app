// app/(app)/admin/testing/screenshot/page.tsx
//
// Página admin-only para probar Haiku Vision contra screenshots reales
// antes de cablearlo al flow de pollas. Mobile-friendly: input file
// con `capture` para abrir la cámara/galería del celu, y form simple
// con método + cuenta + monto. Al subir, llama a
// /api/admin/test/verify-screenshot que preprocesa client-side, manda
// a Haiku con temperature=0 y devuelve el veredicto + tokens + costo.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Image from "next/image";
import { ArrowLeft, Upload, Check, X as XIcon, AlertTriangle } from "lucide-react";
import { preprocessImageForVision } from "@/lib/vision/preprocess-image";

type PayoutMethod = "nequi" | "bancolombia" | "otro";

const METHODS: Array<{ id: PayoutMethod; label: string; hint: string }> = [
  { id: "nequi", label: "Nequi", hint: "Verifica monto + celular. Ignora nombre." },
  { id: "bancolombia", label: "Bancolombia", hint: "Verifica monto + cuenta + nombre." },
  { id: "otro", label: "Otro", hint: "Haiku extrae lo que puede; el organizador siempre revisa manual." },
];

interface VerifyResultUI {
  valid: boolean;
  confidence: "high" | "low";
  sourceType: string;
  sourceEvidence: string;
  detectedAmount: number | null;
  detectedAccount: string | null;
  detectedMethod: string | null;
  detectedRecipientName: string | null;
  detectedDate: string | null;
  checks: {
    source: boolean;
    amount: boolean;
    account: boolean;
    name: boolean;
    date: "today_or_newer" | "older" | "missing";
  };
  rejectionReason: string | null;
  warning: string | null;
  tokensIn: number;
  tokensOut: number;
  costUSD: number;
}

const SOURCE_LABEL: Record<string, string> = {
  bank_app: "App bancaria",
  wallet: "Wallet de pago",
  notes_app: "App de notas",
  messaging: "Chat (WhatsApp/etc)",
  browser: "Browser",
  edited: "Imagen editada",
  physical: "Foto de papel",
  other: "Otro",
  unclear: "No determinado",
};

function fmtCOP(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function ScreenshotTestPage() {
  const router = useRouter();
  const [method, setMethod] = useState<PayoutMethod>("bancolombia");
  const [account, setAccount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<VerifyResultUI | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bytesInfo, setBytesInfo] = useState<{ before: number; after: number } | null>(null);
  const [resultMethod, setResultMethod] = useState<PayoutMethod | null>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setResult(null);
    setError(null);
    setBytesInfo(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!file || submitting) return;
    if (!account.trim() || !amount.trim()) {
      setError("Completá cuenta y monto.");
      return;
    }
    // Para nequi el nombre es opcional. Para bancolombia + otro, requerido.
    if (method !== "nequi" && !recipientName.trim()) {
      setError(`Para ${method} hay que poner el nombre del beneficiario.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      // Preprocesar client-side: cualquier screenshot → ~1568px long edge,
      // JPEG 80%. Garantiza ~1700 tokens consistentes en Vision.
      const pre = await preprocessImageForVision(file);
      setBytesInfo({ before: pre.bytesIn, after: pre.bytesOut });

      const fd = new FormData();
      fd.append("image", new File([pre.blob], "screenshot.jpg", { type: "image/jpeg" }));
      fd.append("method", method);
      fd.append("account", account.trim());
      fd.append("recipient_name", recipientName.trim());
      fd.append("amount", amount.replace(/\D/g, ""));

      const { data } = await axios.post<{ result: VerifyResultUI }>(
        "/api/admin/test/verify-screenshot",
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setResult(data.result);
      setResultMethod(method);
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } }; message?: string })
          ?.response?.data?.error ??
        (err as Error)?.message ??
        "Error desconocido";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#080c10" }}>
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/admin")}
            className="text-text-secondary hover:text-gold transition-colors"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Test · Verificar screenshot</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <p className="text-[12px] text-text-muted">
          Probá Haiku Vision contra screenshots reales. NADA se persiste —
          la imagen se manda a Anthropic y se descarta.
        </p>

        {/* Form */}
        <section className="rounded-2xl p-4 lp-card space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">Método</p>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    method === m.id
                      ? "bg-gold text-bg-base border-gold"
                      : "bg-bg-elevated text-text-secondary border-border-subtle"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-muted mt-1.5">
              {METHODS.find((m) => m.id === method)?.hint}
            </p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted block mb-1">
              Cuenta esperada
            </label>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="ej. 0123456789 o 311 314 7831"
              className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50"
            />
          </div>

          {method !== "nequi" ? (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-text-muted block mb-1">
                Nombre del beneficiario (full)
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="ej. Juan Pablo Pérez Gómez"
                className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50"
              />
            </div>
          ) : null}

          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted block mb-1">
              Monto exacto (COP)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="ej. 20000"
              className="w-full bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-gold/50 tabular-nums"
              style={{ fontFeatureSettings: '"tnum"' }}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted block mb-1">
              Screenshot
            </label>
            <label className="flex items-center justify-center gap-2 w-full bg-bg-elevated border border-dashed border-border-subtle rounded-xl px-4 py-6 cursor-pointer hover:border-gold/40 transition-colors text-[13px] text-text-secondary">
              <Upload className="w-4 h-4" />
              {file ? file.name : "Tocá para elegir / sacar foto"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
          </div>

          {previewUrl ? (
            <div className="rounded-xl overflow-hidden border border-border-subtle relative" style={{ height: 200 }}>
              <Image
                src={previewUrl}
                alt="preview"
                fill
                style={{ objectFit: "contain" }}
                unoptimized
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={
                !file ||
                !account.trim() ||
                !amount.trim() ||
                (method !== "nequi" && !recipientName.trim()) ||
                submitting
              }
            className="w-full bg-gold text-bg-base font-display text-base tracking-wide py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
          >
            {submitting ? "VERIFICANDO…" : "VERIFICAR CON HAIKU"}
          </button>

          {error ? (
            <p className="text-[12px] text-red-alert flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </p>
          ) : null}
        </section>

        {/* Result */}
        {result ? (
          <section
            className={`rounded-2xl p-4 space-y-3 border ${
              result.valid
                ? "bg-turf/5 border-turf/30"
                : "bg-amber/5 border-amber/30"
            }`}
          >
            <div className="flex items-center gap-2">
              {result.valid ? (
                <Check className="w-5 h-5 text-turf" />
              ) : (
                <XIcon className="w-5 h-5 text-amber" />
              )}
              <p
                className={`font-display text-[18px] tracking-[0.04em] uppercase ${
                  result.valid ? "text-turf" : "text-amber"
                }`}
              >
                {result.valid ? "Valid" : "Invalid"}
              </p>
              <span
                className={`ml-auto text-[10px] uppercase px-2 py-0.5 rounded-full border ${
                  result.confidence === "high"
                    ? "border-turf/40 text-turf"
                    : "border-amber/40 text-amber"
                }`}
              >
                {result.confidence}
              </span>
            </div>

            <dl className="text-[12px] grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1.5 items-center">
              <dt className="text-text-muted">Tipo de imagen</dt>
              <dd className="text-right text-text-primary truncate">
                {SOURCE_LABEL[result.sourceType] ?? result.sourceType}
              </dd>
              <CheckMark ok={result.checks.source} />

              <dt className="text-text-muted">Monto</dt>
              <dd
                className="text-right text-text-primary tabular-nums"
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {fmtCOP(result.detectedAmount)}
              </dd>
              <CheckMark ok={result.checks.amount} />

              <dt className="text-text-muted">Cuenta</dt>
              <dd className="text-right text-text-primary truncate">
                {result.detectedAccount ?? "—"}
              </dd>
              <CheckMark ok={result.checks.account} />

              <dt className="text-text-muted">Beneficiario</dt>
              <dd className="text-right text-text-primary truncate">
                {result.detectedRecipientName ?? "—"}
              </dd>
              {resultMethod === "nequi" ? (
                <span
                  className="text-[9px] uppercase px-1.5 py-0.5 rounded-md bg-text-muted/15 text-text-muted border border-border-subtle whitespace-nowrap"
                  title="Nequi no valida nombre"
                >
                  N/A
                </span>
              ) : (
                <CheckMark ok={result.checks.name} />
              )}

              <dt className="text-text-muted">Método</dt>
              <dd className="text-right text-text-primary truncate">
                {result.detectedMethod ?? "—"}
              </dd>
              <span />

              <dt className="text-text-muted">Fecha</dt>
              <dd className="text-right text-text-primary truncate tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                {result.detectedDate ?? "—"}
              </dd>
              <DateMark status={result.checks.date} />
            </dl>

            {result.sourceEvidence ? (
              <div className="rounded-lg px-3 py-2 bg-bg-base border border-border-subtle">
                <p className="text-[10px] uppercase text-text-muted mb-0.5">Por qué Haiku clasificó así la imagen</p>
                <p className="text-[11px] text-text-secondary">{result.sourceEvidence}</p>
              </div>
            ) : null}

            {result.rejectionReason ? (
              <div className="rounded-lg px-3 py-2 bg-bg-base border border-border-subtle">
                <p className="text-[10px] uppercase text-text-muted mb-0.5">Razón</p>
                <p className="text-[12px] text-text-primary">{result.rejectionReason}</p>
              </div>
            ) : null}

            {result.warning ? (
              <div className="rounded-lg px-3 py-2 bg-amber/10 border border-amber/30">
                <p className="text-[10px] uppercase text-amber mb-0.5">Warning</p>
                <p className="text-[11px] text-amber/90">{result.warning}</p>
              </div>
            ) : null}

            <div className="flex items-center justify-between pt-1 text-[10px] text-text-muted tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
              <span>Tokens · in {result.tokensIn} / out {result.tokensOut}</span>
              <span>Costo: ${result.costUSD.toFixed(4)} USD</span>
            </div>

            {bytesInfo ? (
              <p className="text-[10px] text-text-muted text-center">
                Imagen: {(bytesInfo.before / 1024).toFixed(0)} KB → {(bytesInfo.after / 1024).toFixed(0)} KB tras preprocess
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-turf/20 text-turf">
      <Check className="w-3 h-3" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-alert/20 text-red-alert">
      <XIcon className="w-3 h-3" />
    </span>
  );
}

function DateMark({ status }: { status: "today_or_newer" | "older" | "missing" }) {
  if (status === "today_or_newer") {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-turf/20 text-turf">
        <Check className="w-3 h-3" />
      </span>
    );
  }
  if (status === "older") {
    return (
      <span
        className="text-[9px] uppercase px-1.5 py-0.5 rounded-md bg-amber/15 text-amber border border-amber/30 whitespace-nowrap"
        title="Fecha anterior a hoy — posible screenshot reusado"
      >
        Vieja
      </span>
    );
  }
  return (
    <span
      className="text-[9px] uppercase px-1.5 py-0.5 rounded-md bg-text-muted/15 text-text-muted border border-border-subtle whitespace-nowrap"
      title="No se pudo extraer la fecha"
    >
      ?
    </span>
  );
}
