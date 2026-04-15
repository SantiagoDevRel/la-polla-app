// app/(app)/unirse/[slug]/page.tsx — Public landing for joining a polla.
// Renders for both authenticated and unauthenticated visitors. Anon visitors
// get punted through /login with a returnTo so they land back here after OTP.
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { Info, Trophy } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";
import TournamentBadge from "@/components/shared/TournamentBadge";
import { formatCOP } from "@/lib/formatCurrency";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";

interface Preview {
  slug: string;
  name: string;
  description: string | null;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

export default function UnirsePage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const slug = params.slug as string;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const isAuthed = !!user;
        setAuthed(isAuthed);

        const { data } = await axios.get<{
          polla: Omit<Preview, "participantCount">;
          participantCount: number;
        }>(`/api/pollas/preview?slug=${encodeURIComponent(slug)}`);
        setPreview({ ...data.polla, participantCount: data.participantCount });

        // If signed-in and already a participant, skip straight to detail.
        if (isAuthed) {
          const { data: poll } = await supabase
            .from("pollas")
            .select("id")
            .eq("slug", slug)
            .maybeSingle();
          if (poll) {
            const { data: existing } = await supabase
              .from("polla_participants")
              .select("id")
              .eq("polla_id", poll.id)
              .eq("user_id", user!.id)
              .maybeSingle();
            if (existing) {
              router.replace(`/pollas/${slug}`);
              return;
            }
          }
        }
      } catch {
        setError("Polla no encontrada");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, router]);

  function goLogin() {
    const target = `/unirse/${slug}`;
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("lp_returnTo", target);
    }
    router.push(`/login?returnTo=${encodeURIComponent(target)}`);
  }

  async function handleJoin() {
    setJoining(true);
    try {
      const { data } = await axios.post<{ joined: boolean; checkoutUrl: string | null }>(
        `/api/pollas/${slug}/join`
      );
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      showToast("¡Te uniste!", "success");
      router.push(`/pollas/${slug}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e.response?.data?.error || "Error al unirse";
      showToast(msg === "invite_required" ? "Polla privada — necesitás invitación." : msg, "error");
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <FootballLoader />
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <Info className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-primary font-medium mb-4">{error || "Polla no encontrada"}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold"
          >
            Ir al inicio
          </button>
        </div>
      </div>
    );
  }

  const isClosed = preview.type === "closed";
  const buyIn = preview.buy_in_amount;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(80% 60% at 50% 0%, rgba(255,215,0,0.08), transparent 60%), #080c10",
      }}
    >
      <div className="rounded-2xl max-w-sm w-full overflow-hidden bg-bg-card/90 backdrop-blur-sm border border-border-subtle relative z-10">
        {/* Hero */}
        <div
          className="p-6 text-center space-y-2"
          style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-card) 100%)" }}
        >
          <div className="flex items-center justify-center gap-2">
            <TournamentBadge tournamentSlug={preview.tournament} size="md" />
          </div>
          <p className="text-[11px] uppercase tracking-wider text-text-muted">
            Te invitaron a unirte a
          </p>
          <h1
            className="font-display text-3xl tracking-wide"
            style={{ color: "#FFD700", textShadow: "0 0 24px rgba(255,215,0,0.35)" }}
          >
            {preview.name}
          </h1>
          {preview.description && (
            <p className="text-text-secondary text-sm">{preview.description}</p>
          )}
        </div>

        {/* Stats */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">{preview.participantCount}</p>
              <p className="text-[11px] text-text-muted">Participantes</p>
            </div>
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">
                {buyIn > 0 ? formatCOP(buyIn) : "Gratis"}
              </p>
              <p className="text-[11px] text-text-muted">
                {buyIn > 0 ? "Entrada (COP)" : "Sin costo"}
              </p>
            </div>
          </div>

          {isClosed ? (
            <div className="rounded-xl p-4 bg-bg-elevated text-center space-y-1">
              <p className="text-sm font-semibold text-text-primary">Esta polla es privada</p>
              <p className="text-xs text-text-muted">
                Necesitás una invitación del organizador para unirte.
              </p>
            </div>
          ) : authed === false ? (
            <button
              onClick={goLogin}
              className="w-full bg-gold text-bg-base font-bold py-4 rounded-2xl hover:brightness-110 transition-all text-lg"
              style={{ boxShadow: "0 0 24px rgba(255,215,0,0.25)" }}
            >
              {buyIn > 0 ? `Unirse por ${formatCOP(buyIn)}` : "Unirse — es gratis"}
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full bg-gold text-bg-base font-bold py-4 rounded-2xl hover:brightness-110 transition-all disabled:opacity-50 text-lg"
              style={{ boxShadow: "0 0 24px rgba(255,215,0,0.25)" }}
            >
              {joining ? "Uniéndose..." : buyIn > 0 ? `Unirse por ${formatCOP(buyIn)}` : "Unirse — es gratis"}
            </button>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-text-muted">
            <Trophy className="w-3 h-3" />
            <span>Pronosticá los partidos. El que más acierte gana.</span>
          </div>

          <button
            onClick={() => router.push("/dashboard")}
            className="w-full text-text-muted text-sm py-2"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
