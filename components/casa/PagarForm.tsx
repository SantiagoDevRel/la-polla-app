"use client";

// components/casa/PagarForm.tsx — el pantallazo.
//
// Un solo campo y un solo botón. La gente está en la calle, con una mano, con
// mala señal: cualquier paso extra acá se traduce en alguien que no entra.
//
// La imagen se prepara UNA vez al elegirla (lib/casa/prepare-proof.ts): una
// captura de varios MB baja a unos cientos de KB antes del hash. Ese mismo
// Blob se reutiliza en begin, reintento y reemplazo, y el original válido
// queda como segundo candidato para retomar cargas iniciadas con otros bytes.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SelectorBoleta } from "./Boletas";
import { casaPost, uploadSignedFile } from "@/lib/casa/upload-client";
import { ImagePreparationError, prepareImageUpload, type PreparedImage } from "@/lib/casa/prepare-proof";
import { submitProof } from "@/lib/casa/proof-submit";
import { Label, StreetCard } from "@/components/street";

interface Props {
  slug: string;
  esRifa: boolean;
  ticketCount: number | null;
  initialTicket?: string;
  resumeOnly?: boolean;
  /**
   * Participación (migración 131): número = completar esa, `null` = abrir una
   * nueva. Sin valor en rifas (ahí manda la boleta).
   */
  entryNumber?: number | null;
  /**
   * Varios cupos a la vez (CuposForm): cada tarjeta es un comprobante de UN cupo.
   * Con `slot`, al registrar no navega: avisa con `onRegistered`.
   */
  slot?: { index: number; total: number };
  onRegistered?: (entryNumber: number | null) => void;
}

export function PagarForm({ slug, esRifa, initialTicket = "", resumeOnly = false, entryNumber, slot, onRegistered }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // Cada selección recibe un turno: si la persona elige otra imagen mientras
  // se prepara la anterior, el resultado viejo se descarta.
  const selectionRef = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [ticket, setTicket] = useState(initialTicket);
  const [revision, setRevision] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [registrado, setRegistrado] = useState<number | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function elegir(f: File | null) {
    if (!f) return;
    const turn = ++selectionRef.current;
    setError(null);
    setPrepared(null);
    setPreview(null);
    setFileName(f.name);
    setPreparando(true);
    try {
      const result = await prepareImageUpload(f);
      if (turn !== selectionRef.current) return;
      setPrepared(result);
      setPreview(URL.createObjectURL(result.candidates[0].blob));
    } catch (cause) {
      if (turn !== selectionRef.current) return;
      setFileName(null);
      setError(cause instanceof ImagePreparationError ? cause.message : "No pudimos preparar la imagen. Toma una captura de pantalla y sube esa imagen.");
    } finally {
      if (turn === selectionRef.current) setPreparando(false);
    }
  }

  async function enviar() {
    if (!prepared) {
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
      // Cada participación guarda su propio intento: retomar la 2 nunca reusa el de la 3.
      const target = esRifa ? ticket : entryNumber == null ? `nueva${slot ? `-${slot.index}` : ""}` : `p${entryNumber}`;
      const key = `casa-proof:${slug}:${target || "entry"}`;
      const result = await submitProof({
        sourceSha256: prepared.sourceSha256,
        candidates: prepared.candidates,
        ticketNumber: esRifa ? Number(ticket) : null,
        preserveStoredAttempt: resumeOnly,
        entryNumber: esRifa ? undefined : entryNumber ?? null,
      }, {
        post: (body) => casaPost(url, body),
        upload: (upload, blob) => uploadSignedFile(upload, blob),
        readRecord: () => sessionStorage.getItem(key),
        writeRecord: (value) => sessionStorage.setItem(key, value),
        newRequestId: () => crypto.randomUUID(),
      });
      // Registrado: la próxima participación nueva empieza su propio intento.
      // Si alguien vuelve a elegir el mismo comprobante, SQL lo rechaza en vez
      // de devolver en silencio la participación anterior.
      try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
      setListo(true);
      setRegistrado(result.entryNumber);
      if (onRegistered) { onRegistered(result.entryNumber); return; }
      // Un respiro para que se lea la confirmación antes de volver.
      setTimeout(() => router.push(`/polla/${slug}${result.entryNumber ? `?p=${result.entryNumber}` : ""}`), 1600);
    } catch (cause) {
      setRevision((n) => n + 1);
      setError(cause instanceof Error ? cause.message : "Error de conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo && slot) {
    return (
      <StreetCard className="border-turf/40 p-4">
        <p className="lp-label text-turf">Comprobante {slot.index} de {slot.total} enviado</p>
        <p className="mt-1 text-[13px] text-text-secondary">
          {registrado ? `Quedó como tu cupo #${registrado}. ` : ""}Suma puntos cuando confirmemos este pago.
        </p>
      </StreetCard>
    );
  }

  if (listo) {
    return (
      <StreetCard hero className="p-6 text-center">
        <p className="lp-display-sm text-gold">Pago registrado</p>
        <p className="mt-2 text-[13px] text-text-secondary">
          {esRifa
            ? "Comprobante recibido. Te avisamos al confirmar."
            : "Comprobante recibido. Ya puedes pronosticar; suma al confirmar."}
        </p>
      </StreetCard>
    );
  }

  return (
    <StreetCard className="p-4">
      {resumeOnly && <p className="mb-4 text-[15px] text-text-secondary">La inscripción cerró. Sube el mismo comprobante; no vuelvas a transferir.</p>}
      {esRifa && <div className="mb-4"><SelectorBoleta slug={slug} value={ticket} onChange={setTicket} disabled={enviando || resumeOnly} revision={revision} /></div>}

      <Label>{slot && slot.total > 1 ? `Comprobante del cupo ${slot.index} de ${slot.total}` : "Comprobante de la transferencia"}</Label>

      <input
        ref={inputRef}
        type="file"
        // Sin `capture`: el comprobante es un PANTALLAZO que ya está en la
        // galería, no una foto que se toma ahora. Con capture="environment"
        // varios Android abren la cámara directo y no ofrecen galería, o sea
        // que el pago quedaba imposible de completar.
        accept="image/jpeg,image/png,image/webp"
        disabled={enviando}
        onChange={(e) => {
          void elegir(e.target.files?.[0] ?? null);
          // Permite volver a elegir el mismo archivo después de un error.
          e.target.value = "";
        }}
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
        ) : preparando ? (
          <span role="status" className="text-[15px] text-text-secondary">
            Preparando la imagen…
          </span>
        ) : (
          <span className="text-[13px] text-text-muted">
            Sube aquí el comprobante
          </span>
        )}
      </button>

      {prepared && fileName && (
        <p className="mt-2 text-center text-[13px] text-text-muted [overflow-wrap:anywhere]">
          {fileName} · toca la imagen para cambiarla
        </p>
      )}

      {error && (
        <p className="mt-3 border border-red-alert/40 bg-red-alert/10 p-2 text-center text-[13px] text-red-alert">
          {error}
          <span className="mt-2 block">Si ya transferiste, no repitas el pago. <a href="/soporte" className="underline">Pide ayuda en Soporte</a>.</span>
        </p>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando || preparando || !prepared}
        className="lp-btn lp-btn-primary mt-4 w-full"
      >
        {enviando ? "Enviando..." : "Enviar el comprobante"}
      </button>
    </StreetCard>
  );
}
