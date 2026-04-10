// app/(app)/unirse/[slug]/page.tsx — Unirse a una polla "estadio de noche"
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";
import { formatCOP } from "@/lib/formatCurrency";

interface PollaInfo {
  id: string; slug: string; name: string; description: string;
  tournament: string; buy_in_amount: number; currency: string;
  payment_mode: string; type: string;
}

const TRN: Record<string, string> = {
  worldcup_2026: "🌍 Mundial 2026", champions_2025: "⭐ Champions League",
  liga_betplay_2025: "🇨🇴 Liga BetPlay",
};

export default function UnirsePage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const slug = params.slug as string;

  const [polla, setPolla] = useState<PollaInfo | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const { data } = await axios.get(`/api/pollas/${slug}`);
        setPolla(data.polla);
        setParticipantCount(data.participants?.length || 0);
        if (data.currentUserRole) router.replace(`/pollas/${slug}`);
      } catch { setError("Polla no encontrada"); }
      finally { setLoading(false); }
    }
    load();
  }, [slug, router]);

  async function handleJoin() {
    setJoining(true);
    try {
      await axios.post(`/api/pollas/${slug}/join`);
      showToast("¡Te uniste!", "success");
      router.push(`/pollas/${slug}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e.response?.data?.error || "Error al unirse";
      if (msg === "Ya eres participante") router.push(`/pollas/${slug}`);
      else showToast(msg, "error");
    } finally { setJoining(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-4xl">⚽</div></div>;

  if (error || !polla) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <div className="text-4xl mb-3">😕</div>
          <p className="text-text-primary font-medium mb-4">{error || "Polla no encontrada"}</p>
          <button onClick={() => router.push("/dashboard")} className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold">Ir al inicio</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="rounded-2xl max-w-sm w-full overflow-hidden bg-bg-card border border-border-subtle">
        <div className="p-6 text-center" style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-card) 100%)" }}>
          <div className="text-4xl mb-2">⚽</div>
          <h1 className="text-xl font-bold text-text-primary">{polla.name}</h1>
          <p className="text-text-secondary text-sm mt-1">{TRN[polla.tournament] || polla.tournament}</p>
        </div>
        <div className="p-6 space-y-4">
          {polla.description && <p className="text-text-secondary text-sm text-center">{polla.description}</p>}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">{participantCount}</p>
              <p className="text-[11px] text-text-muted">Participantes</p>
            </div>
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">
                {polla.buy_in_amount > 0 ? formatCOP(polla.buy_in_amount) : "Gratis"}
              </p>
              <p className="text-[11px] text-text-muted">{polla.buy_in_amount > 0 ? "Entrada (COP)" : "Sin costo"}</p>
            </div>
          </div>
          <button onClick={handleJoin} disabled={joining}
            className="w-full bg-gold text-bg-base font-semibold py-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 text-lg">
            {joining ? "Uniéndose..." : "Unirse a esta polla 🙌"}
          </button>
          <button onClick={() => router.push("/dashboard")} className="w-full text-text-muted text-sm py-2">Volver al inicio</button>
        </div>
      </div>
    </div>
  );
}
