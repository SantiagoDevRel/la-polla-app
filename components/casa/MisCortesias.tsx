"use client";

// components/casa/MisCortesias.tsx — los cupos que me dio la casa para regalar.
//
// Cada cortesía es un enlace distinto que sirve UNA vez: por eso se comparte de
// a uno y se ve enseguida cuál ya usaron. En la polla llega con sus cortesías
// por props (sin fetch ni parpadeo); en Perfil las pide al abrir.

import { useEffect, useState } from "react";
import { Check, Copy, Share2, Ticket } from "lucide-react";
import { SectionHead, Tape } from "@/components/street";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  COURTESY_FINE_PRINT,
  courtesyLabel,
  courtesyLink,
  courtesyShareText,
  isCourtesyLive,
  type MyCourtesy,
} from "@/lib/casa/courtesies-shared";

/** Dominio público, incluso desde localhost o un preview. */
function publicOrigin(): string {
  const english = ["chickenpicks.app", "www.chickenpicks.app"].includes(window.location.hostname);
  return english ? "https://chickenpicks.app" : "https://lapollacolombiana.com";
}

function Cortesia({ cortesia, mostrarPolla }: { cortesia: MyCourtesy; mostrarPolla: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const estado = courtesyLabel(cortesia);
  const viva = isCourtesyLive(cortesia);

  async function compartir() {
    const url = courtesyLink(publicOrigin(), cortesia.slug, cortesia.code);
    const texto = courtesyShareText(cortesia.polla, url);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: cortesia.polla, text: texto, url });
        return;
      } catch (error) {
        // Cancelar no debe tocar el portapapeles.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copiar();
  }

  async function copiar() {
    const url = courtesyLink(publicOrigin(), cortesia.slug, cortesia.code);
    try {
      await navigator.clipboard.writeText(`${courtesyShareText(cortesia.polla, url)}`);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    } catch {
      // Sin permiso de portapapeles el enlace queda visible en la fila.
    }
  }

  return (
    <li className="bg-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <span className="min-w-0 grow basis-40">
          {mostrarPolla && <span className="block text-[15px] text-text-primary [overflow-wrap:anywhere]">{cortesia.polla}</span>}
          <span className="mt-0.5 block font-mono text-[13px] tracking-[0.08em] text-text-muted">{cortesia.code}</span>
        </span>
        <Tape tone={estado.tone}>{estado.text}</Tape>
      </div>
      {viva && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={compartir} className="lp-btn lp-btn-ghost grow basis-40 !px-4">
            <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            Regalar este cupo
          </button>
          <button
            type="button"
            onClick={copiar}
            aria-label={`Copiar el enlace de la cortesía ${cortesia.code}`}
            className="lp-btn lp-btn-ghost shrink-0 !px-4"
          >
            {copiado ? <Check className="h-4 w-4 text-turf" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
          </button>
        </div>
      )}
    </li>
  );
}

export function MisCortesias({
  initial = null,
  mostrarPolla = true,
  titulo = "Cortesías para regalar",
}: {
  /** Las cortesías ya leídas en el servidor (pantalla de la polla). */
  initial?: MyCourtesy[] | null;
  /** En la polla el nombre ya está en el encabezado: no se repite en cada fila. */
  mostrarPolla?: boolean;
  titulo?: string;
}) {
  const [cortesias, setCortesias] = useState<MyCourtesy[] | null>(initial);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (initial !== null) return;
    let vivo = true;
    (async () => {
      try {
        const response = await fetch("/api/casa/cortesias", { cache: "no-store" });
        if (!response.ok) throw new Error("no se pudieron leer las cortesías");
        const data = await response.json();
        if (vivo) setCortesias(data.cortesias ?? []);
      } catch {
        if (vivo) setError(true);
      }
    })();
    return () => { vivo = false; };
  }, [initial]);

  if (error) return null;
  if (cortesias !== null && cortesias.length === 0) return null;

  const disponibles = (cortesias ?? []).filter(isCourtesyLive).length;

  return (
    <section className="mt-6">
      <SectionHead title={titulo} meta={cortesias === null ? undefined : `${disponibles} sin usar`} />
      {cortesias === null ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">Cargando cortesías...</span>
          <Skeleton className="h-20 w-full" aria-hidden="true" />
        </div>
      ) : (
        <>
          <p className="mb-3 flex items-start gap-2 text-[15px] leading-relaxed text-text-secondary">
            <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
            <span>Cada enlace le da un cupo gratis a una persona distinta y sirve una sola vez.</span>
          </p>
          <ul className="space-y-px">
            {cortesias.map((cortesia) => (
              <Cortesia key={cortesia.id} cortesia={cortesia} mostrarPolla={mostrarPolla} />
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-snug text-text-muted">{COURTESY_FINE_PRINT}</p>
        </>
      )}
    </section>
  );
}

export default MisCortesias;
