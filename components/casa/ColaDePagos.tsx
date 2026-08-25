"use client";

// components/casa/ColaDePagos.tsx — aprobar pagos desde la web.
//
// Respaldo del bot de Telegram. El bot sigue siendo el camino principal
// (llega solo, se resuelve de un toque), pero si Telegram falla, si el chat
// nunca se vinculó, o si Tama perdió el mensaje, esta lista es la que evita
// que la gente quede esperando para siempre.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Label, StreetCard } from "@/components/street";
import { formatCop } from "@/lib/casa/format";

interface Pendiente {
  id: string;
  jugador: string;
  polla: string;
  montoCop: number;
  boleta: number | null;
  comprobanteUrl: string | null;
}

export function ColaDePagos() {
  const router = useRouter();
  const [pendientes, setPendientes] = useState<Pendiente[] | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  async function cargar() {
    try {
      const r = await fetch("/api/casa/admin/entries");
      const j = await r.json();
      setPendientes(j.pendientes ?? []);
    } catch {
      setPendientes([]);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function decidir(id: string, decision: "aprobar" | "rechazar") {
    setResolviendo(id);
    try {
      const r = await fetch("/api/casa/admin/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: id, decision }),
      });
      if (r.ok) {
        setPendientes((prev) => (prev ?? []).filter((p) => p.id !== id));
        router.refresh(); // el pozo de arriba cambia
      }
    } finally {
      setResolviendo(null);
    }
  }

  if (pendientes === null) {
    return (
      <StreetCard className="p-4 text-[13px] text-text-muted">
        Buscando pagos...
      </StreetCard>
    );
  }

  if (pendientes.length === 0) {
    return (
      <StreetCard className="p-4 text-[13px] text-text-muted">
        No hay pagos esperando. Todo al día.
      </StreetCard>
    );
  }

  return (
    <ul className="space-y-px">
      {pendientes.map((p) => (
        <li key={p.id} className="bg-bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-text-primary">
                {p.jugador}
              </p>
              <Label className="mt-0.5">
                {p.polla}
                {p.boleta != null ? ` · boleta #${p.boleta}` : ""}
              </Label>
            </div>
            <span className="lp-money shrink-0 text-[18px] text-gold">
              {formatCop(p.montoCop)}
            </span>
          </div>

          {p.comprobanteUrl && (
            <button
              type="button"
              onClick={() => setAbierto(abierto === p.id ? null : p.id)}
              className="lp-btn lp-btn-ghost mt-3 w-full text-[12px]"
            >
              {abierto === p.id ? "Ocultar comprobante" : "Ver comprobante"}
            </button>
          )}

          {abierto === p.id && p.comprobanteUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.comprobanteUrl}
              alt={`Comprobante de ${p.jugador}`}
              className="mt-2 max-h-[420px] w-full object-contain"
            />
          )}

          <div className="mt-3 grid grid-cols-2 gap-px">
            <button
              type="button"
              disabled={resolviendo === p.id}
              onClick={() => decidir(p.id, "rechazar")}
              className="lp-btn lp-btn-ghost text-[13px] hover:border-red-alert hover:text-red-alert"
            >
              Rechazar
            </button>
            <button
              type="button"
              disabled={resolviendo === p.id}
              onClick={() => decidir(p.id, "aprobar")}
              className="lp-btn lp-btn-primary text-[13px]"
            >
              {resolviendo === p.id ? "..." : "Aprobar"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
