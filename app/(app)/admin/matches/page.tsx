// app/(app)/admin/matches/page.tsx — Panel de admin de mantenimiento de partidos
// Protected server-side by app/(app)/admin/layout.tsx — no client-side access check needed
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { purgeMatchesAction } from "./actions";

// Los partidos llegan solos desde API-Football, la única fuente (2026-09-13):
// el calendario lo refresca el cron `discover` cada 6 h y el vivo/resultados
// el cron `sync-live` cada minuto. Los botones de sync manual (Mundial por
// openfootball, ligas por football-data) se retiraron con esos proveedores.
// Para refrescar el calendario de una liga desde el panel: crear polla de la
// casa → "Actualizar calendario" (/api/admin/sync-ligas).

export default function AdminMatchesPage() {
  const router = useRouter();
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  async function handlePurge() {
    if (!confirm("Eliminar todos los partidos anteriores al 1 enero 2026?")) return;
    setPurging(true);
    setPurgeResult(null);
    try {
      const result = await purgeMatchesAction();
      setPurgeResult(`${result.deleted} partidos eliminados`);
    } catch {
      setPurgeResult("Error al purgar partidos");
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header
        className="px-4 pt-4 pb-4"

      >
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/inicio")} className="text-text-secondary hover:text-gold transition-colors duration-200 cursor-pointer">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Admin — Partidos</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <p className="text-sm text-text-secondary">
          Los partidos se actualizan solos desde API-Football: el calendario cada
          6 horas y el vivo y los resultados cada minuto.
        </p>

        {/* Purgar partidos antiguos */}
        <div className="rounded-xl p-4 lp-card space-y-3">
          <p className="text-sm font-bold text-text-primary">Mantenimiento</p>
          <button
            onClick={handlePurge}
            disabled={purging}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-red-alert text-white hover:bg-red-alert/90 transition-all duration-200 disabled:opacity-40 cursor-pointer"
          >
            {purging ? "Purgando..." : "Purgar partidos anteriores a 2026"}
          </button>
          {purgeResult && (
            <p className="text-sm text-center text-text-secondary">{purgeResult}</p>
          )}
        </div>
      </main>
    </div>
  );
}
