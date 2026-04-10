// app/(app)/pollas/page.tsx — Mis Pollas con tabs Activas/Terminadas "estadio de noche"
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import PollaCard from "@/components/polla/PollaCard";
import { AnimatedList, AnimatedItem } from "@/components/ui/AnimatedList";

interface PollaData {
  id: string; name: string; slug: string; description?: string;
  tournament: string; status: string; buy_in_amount: number;
  currency: string; payment_mode: string; type: string;
}

type TabFilter = "active" | "finished";

export default function MisPollasPage() {
  const router = useRouter();
  const [pollas, setPollas] = useState<PollaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabFilter>("active");

  useEffect(() => {
    async function load() {
      try { const { data } = await axios.get("/api/pollas"); setPollas(data.pollas || []); }
      catch { /* silently fail */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = pollas.filter((p) => tab === "active" ? p.status === "active" : p.status === "finished");

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-3" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="text-text-secondary text-xl">←</button>
          <h1 className="text-xl font-bold text-text-primary">Mis Pollas</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Tabs */}
        <div className="flex rounded-xl overflow-hidden border border-border-subtle">
          {(["active", "finished"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                tab === t ? "bg-bg-elevated text-gold" : "bg-bg-card text-text-muted"
              }`}>
              {t === "active" ? "⚽ Activas" : "✅ Terminadas"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">⚽</div>
            <p className="text-text-muted text-sm">Cargando pollas...</p>
          </div>
        ) : filtered.length > 0 ? (
          <AnimatedList className="space-y-3">
            {filtered.map((polla) => (
              <AnimatedItem key={polla.id}>
                <PollaCard polla={polla} />
              </AnimatedItem>
            ))}
          </AnimatedList>
        ) : (
          <div className="rounded-2xl p-8 text-center bg-bg-card border border-border-subtle">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-text-muted text-sm">
              {tab === "active" ? "No tenés pollas activas" : "No tenés pollas terminadas"}
            </p>
          </div>
        )}

        <div className="sticky bottom-[80px]">
          <a href="/pollas/crear" className="block w-full bg-gold text-bg-base font-semibold py-3 rounded-xl text-center hover:brightness-110 transition-all text-lg shadow-lg">
            Crear nueva polla ➕
          </a>
        </div>
      </main>
    </div>
  );
}
