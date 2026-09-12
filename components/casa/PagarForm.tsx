"use client";

// components/casa/PagarForm.tsx — el pantallazo.
//
// Un solo campo y un solo botón. La gente está en la calle, con una mano, con
// mala señal: cualquier paso extra acá se traduce en alguien que no entra.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SelectorBoleta } from "./Boletas";
import { casaPost, fileDigest, uploadSignedFile } from "@/lib/casa/upload-client";
import { Label, StreetCard } from "@/components/street";

interface Props {
  slug: string;
  esRifa: boolean;
  ticketCount: number | null;
  initialTicket?: string;
  resumeOnly?: boolean;
}

const MAX_MB = 8;

export function PagarForm({ slug, esRifa, initialTicket = "", resumeOnly = false }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ticket, setTicket] = useState(initialTicket);
  const [revision, setRevision] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function elegir(f: File | null) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`La imagen supera los ${MAX_MB} MB.`);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { setError("Usa una imagen JPG, PNG o WEBP. En iPhone puedes tomar una captura de la transferencia."); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function enviar() {
    if (!file) {
      setError("Sube el comprobante de la transferencia.");
      return;
    }
    if (esRifa && !ticket) {
      setError("Elige el número de boleta.");
      return;
    }

    setEnviando(true);
    setError(null);
    try {
      const url = `/api/casa/pollas/${slug}/join`;
      const sha256 = await fileDigest(file);
      const key = `casa-proof:${slug}:${ticket || "entry"}`;
      let stored: { sha256: string; requestId: string; attemptId?: string } | null = null;
      try { stored = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { /* Storage may be disabled. */ }
      if (stored && stored.sha256 !== sha256) {
        if (stored.attemptId) await casaPost(url, { action: "fail", attemptId: stored.attemptId });
        stored = null;
      }
      const record = stored ?? { sha256, requestId: crypto.randomUUID() };
      const save = () => { try { sessionStorage.setItem(key, JSON.stringify(record)); } catch { /* Retry within this render still works. */ } };
      save();
      let begun;
      for (let retry = 0; retry < 2; retry += 1) {
        try {
          begun = await casaPost(url, { action: "begin", requestId: record.requestId, ticketNumber: esRifa ? Number(ticket) : null,
            sha256, contentType: file.type, bytes: file.size });
          break;
        } catch (cause) {
          if (retry === 0 && ["UPLOAD_EXPIRED", "ATTEMPT_REPLACED"].includes((cause as { code?: string }).code ?? "")) {
            record.requestId = crypto.randomUUID(); delete record.attemptId; save();
          } else throw cause;
        }
      }
      if (!begun) throw new Error("No se pudo iniciar la carga.");
      record.attemptId = begun.attempt_id; save();
      if (begun.state !== "confirmed") {
        await uploadSignedFile(begun.upload, file);
        // A timed-out upload may have succeeded. Verification resolves that ambiguity.
        try { await casaPost(url, { action: "confirm", attemptId: begun.attempt_id }); }
        catch (cause) {
          if ((cause as { code?: string }).code !== "UPLOAD_MISMATCH") throw cause;
          await casaPost(url, { action: "fail", attemptId: begun.attempt_id });
          record.requestId = crypto.randomUUID(); delete record.attemptId; save();
          const replacement = await casaPost(url, { action: "begin", requestId: record.requestId, ticketNumber: esRifa ? Number(ticket) : null,
            sha256, contentType: file.type, bytes: file.size });
          record.attemptId = replacement.attempt_id; save();
          await uploadSignedFile(replacement.upload, file);
          await casaPost(url, { action: "confirm", attemptId: replacement.attempt_id });
        }
      }
      setListo(true);
      // Un respiro para que se lea la confirmación antes de volver.
      setTimeout(() => router.push(`/casa/${slug}`), 1600);
    } catch (cause) {
      setRevision((n) => n + 1);
      setError(cause instanceof Error ? cause.message : "Error de conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <StreetCard hero className="p-6 text-center">
        <p className="lp-display-sm text-gold">Pago registrado</p>
        <p className="mt-2 text-[13px] text-text-secondary">
          Recibimos tu comprobante. Tu participación se activa cuando confirmemos el pago.
        </p>
      </StreetCard>
    );
  }

  return (
    <StreetCard className="p-4">
      {resumeOnly && <p className="mb-4 text-[15px] text-text-secondary">La inscripción cerró. Puedes completar la carga que ya iniciaste; selecciona el mismo comprobante. No repitas la transferencia.</p>}
      {esRifa && <div className="mb-4"><SelectorBoleta slug={slug} value={ticket} onChange={setTicket} disabled={enviando || resumeOnly} revision={revision} /></div>}

      <Label>Comprobante de la transferencia</Label>

      <input
        ref={inputRef}
        type="file"
        // Sin `capture`: el comprobante es un PANTALLAZO que ya está en la
        // galería, no una foto que se toma ahora. Con capture="environment"
        // varios Android abren la cámara directo y no ofrecen galería, o sea
        // que el pago quedaba imposible de completar.
        accept="image/jpeg,image/png,image/webp"
        disabled={enviando}
        onChange={(e) => elegir(e.target.files?.[0] ?? null)}
        className="sr-only"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
        className="mt-2 flex w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-border-strong bg-bg-elevated p-6 text-center transition-colors hover:border-gold/40 focus-visible:outline focus-visible:outline-gold"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Vista previa del comprobante"
            className="max-h-[240px] w-auto"
          />
        ) : (
          <span className="text-[13px] text-text-muted">
            Sube aquí el comprobante
          </span>
        )}
      </button>

      {file && (
        <p className="mt-2 text-center text-[13px] text-text-muted">
          {file.name} · toca la imagen para cambiarla
        </p>
      )}

      {error && (
        <p className="mt-3 border border-red-alert/40 bg-red-alert/10 p-2 text-center text-[13px] text-red-alert">
          {error}
          <span className="mt-2 block">Si ya transferiste, no repitas el pago. <a href="/soporte" className="underline">Contacta a soporte</a> si no puedes registrar el comprobante.</span>
        </p>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando || !file}
        className="lp-btn lp-btn-primary mt-4 w-full"
      >
        {enviando ? "Enviando..." : "Enviar el comprobante"}
      </button>
    </StreetCard>
  );
}
