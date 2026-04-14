// app/(app)/unirse/[slug]/page.tsx — Unirse a una polla "estadio de noche"
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";
import { formatCOP } from "@/lib/formatCurrency";
import TournamentBadge from "@/components/shared/TournamentBadge";
import { Target, Info } from "lucide-react";

interface PollaInfo {
  id: string; slug: string; name: string; description: string;
  tournament: string; buy_in_amount: number; currency: string;
  payment_mode: string; type: string;
}

// Tournament labels replaced by TournamentBadge component

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
      const { data } = await axios.post<{ joined: boolean; checkoutUrl: string | null }>(
        `/api/pollas/${slug}/join`
      );
      if (data.checkoutUrl) {
        // Digital-pool: send straight to Wompi. The user lands back at
        // /pollas/[slug]?payment=success once approved.
        window.location.href = data.checkoutUrl;
        return;
      }
      showToast("¡Te uniste!", "success");
      router.push(`/pollas/${slug}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e.response?.data?.error || "Error al unirse";
      if (msg === "invite_required") {
        showToast("Esta polla es privada. Necesitás una invitación.", "error");
      } else {
        showToast(msg, "error");
      }
    } finally { setJoining(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Target className="w-10 h-10 text-gold" /></div>;

  if (error || !polla) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <div className="mb-3"><Info className="w-10 h-10 text-text-muted mx-auto" /></div>
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
          <div className="mb-2"><Target className="w-10 h-10 text-gold mx-auto" /></div>
          <h1 className="text-xl font-bold text-text-primary">{polla.name}</h1>
          <p className="text-text-secondary text-sm mt-1"><TournamentBadge tournamentSlug={polla.tournament} size="md" /></p>
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
          {polla.type === "closed" ? (
            <div className="rounded-xl p-4 bg-bg-elevated text-center space-y-1">
              <p className="text-sm font-semibold text-text-primary">Esta polla es privada</p>
              <p className="text-xs text-text-muted">Necesitás una invitación para unirte.</p>
            </div>
          ) : (
            <button onClick={handleJoin} disabled={joining}
              className="w-full bg-gold text-bg-base font-semibold py-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 text-lg">
              {joining ? "Uniéndose..." : "Unirse a esta polla"}
            </button>
          )}
          <button onClick={() => router.push("/dashboard")} className="w-full text-text-muted text-sm py-2">Volver al inicio</button>
        </div>
      </div>
    </div>
  );
}
