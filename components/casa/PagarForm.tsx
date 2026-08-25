"use client";

// components/casa/PagarForm.tsx — el pantallazo.
//
// Un solo campo y un solo botón. La gente está en la calle, con una mano, con
// mala señal: cualquier paso extra acá se traduce en alguien que no entra.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Label, StreetCard } from "@/components/street";

interface Props {
  slug: string;
  esRifa: boolean;
  ticketCount: number | null;
}

const MAX_MB = 8;

export function PagarForm({ slug, esRifa, ticketCount }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ticket, setTicket] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  function elegir(f: File | null) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`Esa imagen pesa mucho (máx ${MAX_MB} MB).`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function enviar() {
    if (!file) {
      setError("Subí el pantallazo de la transferencia.");
      return;
    }
    if (esRifa && !ticket) {
      setError("Elegí el número de boleta.");
      return;
    }

    setEnviando(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("proof", file);
      if (esRifa) fd.append("ticketNumber", ticket);

      const res = await fetch(`/api/casa/pollas/${slug}/join`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "No pude registrar tu pago.");
        return;
      }
      setListo(true);
      // Un respiro para que se lea la confirmación antes de volver.
      setTimeout(() => router.push(`/casa/${slug}`), 1600);
    } catch {
      setError("Se cayó la conexión. Probá otra vez.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <StreetCard hero className="p-6 text-center">
        <p className="lp-display-sm text-gold">Listo, ya quedó</p>
        <p className="mt-2 text-[13px] text-text-secondary">
          A Tama le llegó tu pantallazo. Apenas lo confirme, entrás al pozo y
          tus pronósticos cuentan.
        </p>
      </StreetCard>
    );
  }

  return (
    <StreetCard className="p-4">
      {esRifa && (
        <div className="mb-4">
          <Label>Número de boleta</Label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={ticketCount ?? 999}
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder={`Del 1 al ${ticketCount ?? "?"}`}
            className="lp-input lp-money mt-2 text-[20px]"
          />
        </div>
      )}

      <Label>Pantallazo de la transferencia</Label>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => elegir(e.target.files?.[0] ?? null)}
        className="sr-only"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-2 flex w-full items-center justify-center border border-dashed border-border-strong bg-bg-elevated p-6 text-center"
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
            Tocá acá para subir la foto
          </span>
        )}
      </button>

      {file && (
        <p className="mt-2 text-center text-[11px] text-text-muted">
          {file.name} · tocá la imagen para cambiarla
        </p>
      )}

      {error && (
        <p className="mt-3 border border-red-alert/40 bg-red-alert/10 p-2 text-center text-[12px] text-red-alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando || !file}
        className="lp-btn lp-btn-primary mt-4 w-full"
      >
        {enviando ? "Mandando..." : "Mandar el comprobante"}
      </button>
    </StreetCard>
  );
}
