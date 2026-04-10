// app/(app)/explorar/page.tsx — Explorar pollas abiertas "estadio de noche"
"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import PollaCard from "@/components/polla/PollaCard";
import { AnimatedList, AnimatedItem } from "@/components/ui/AnimatedList";

interface PublicPolla {
  id: string; name: string; slug: string; description?: string;
  tournament: string; buy_in_amount: number; currency: string;
  payment_mode: string; type: string; status: string; participant_count: number;
}

export default function ExplorarPage() {
  const [pollas, setPollas] = useState<PublicPolla[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const { data } = await axios.get("/api/pollas/public");
        setPollas((data.pollas || []).map((p: PublicPolla) => ({ ...p, status: "active" })));
      } catch { /* silently fail */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = search ? pollas.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) : pollas;

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-4" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-base) 100%)" }}>
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-bold text-text-primary mb-3">🔍 Explorar pollas</h1>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full px-4 py-2.5 rounded-xl text-sm text-text-primary placeholder-text-muted outline-none bg-bg-elevated border border-border-medium focus:border-gold transition-colors"
          />
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        {loading ? (
          <div className="text-center py-8"><div className="text-4xl mb-2">🔍</div><p className="text-text-muted text-sm">Buscando pollas...</p></div>
        ) : filtered.length > 0 ? (
          <AnimatedList className="space-y-3">
            {filtered.map((polla) => (
              <AnimatedItem key={polla.id}>
                <PollaCard polla={polla} participantCount={polla.participant_count} />
              </AnimatedItem>
            ))}
          </AnimatedList>
        ) : (
          <div className="rounded-2xl p-8 text-center bg-bg-card border border-border-subtle">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-text-muted text-sm mb-4">{search ? "No hay pollas que coincidan" : "No hay pollas abiertas"}</p>
            <a href="/pollas/crear" className="inline-block bg-gold text-bg-base font-semibold py-2 px-4 rounded-xl text-sm">¡Creá una!</a>
          </div>
        )}
      </main>
    </div>
  );
}
