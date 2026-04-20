// app/(app)/invites/polla/[token]/page.tsx — Open shareable invite landing.
// Anyone with the link can join the polla (subject to the polla's payment
// requirements). Not tied to a specific phone number.
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { Info, Target } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";
import TournamentBadge from "@/components/shared/TournamentBadge";
import { formatCOP } from "@/lib/formatCurrency";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";

interface PollaSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tournament: string;
  buy_in_amount: number;
  type: string;
}

export default function OpenInvitePage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [polla, setPolla] = useState<PollaSummary | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [error, setError] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        // Auth check first — bounce to login with returnTo if needed.
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const isAuthed = !!user;
        setAuthed(isAuthed);

        // Resolve token → polla via the public anon-readable pollas row.
        const { data: row, error: rowErr } = await supabase
          .from("pollas")
          .select("id, slug, name, description, tournament, buy_in_amount, type")
          .eq("invite_token", token)
          .maybeSingle();
        if (rowErr || !row) {
          setError("Link inválido o expirado");
          return;
        }
        setPolla(row);

        // If signed-in and already in the polla, send straight to the detail.
        if (isAuthed) {
          const { data: existing } = await supabase
            .from("polla_participants")
            .select("id")
            .eq("polla_id", row.id)
            .eq("user_id", user!.id)
            .maybeSingle();
          if (existing) {
            router.replace(`/pollas/${row.slug}`);
            return;
          }
        }

        const { count } = await supabase
          .from("polla_participants")
          .select("id", { head: true, count: "exact" })
          .eq("polla_id", row.id)
          .eq("status", "approved");
        setParticipantCount(count ?? 0);
      } catch {
        setError("Error cargando la invitación");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token, router]);

  function goLogin() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("lp_returnTo", `/invites/polla/${token}`);
    }
    router.push(`/login?returnTo=${encodeURIComponent(`/invites/polla/${token}`)}`);
  }

  async function handleJoin() {
    if (!polla) return;
    setJoining(true);
    try {
      const { data } = await axios.post<{ joined: boolean; checkoutUrl: string | null }>(
        `/api/pollas/${polla.slug}/join`,
        { invite_token: token }
      );
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      showToast("¡Te uniste!", "success");
      router.push(`/pollas/${polla.slug}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error al unirse", "error");
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

  if (error || !polla) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <Info className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-primary font-medium mb-4">{error || "Link inválido"}</p>
          <button
            onClick={() => router.push("/inicio")}
            className="bg-gold text-bg-base px-6 py-2 rounded-xl font-semibold"
          >
            Ir al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="rounded-2xl max-w-sm w-full overflow-hidden bg-bg-card border border-border-subtle">
        <div
          className="p-6 text-center"
          style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-card) 100%)" }}
        >
          <Target className="w-10 h-10 text-gold mx-auto mb-2" />
          <h1 className="text-xl font-bold text-text-primary">{polla.name}</h1>
          <p className="text-text-secondary text-sm mt-1">
            <TournamentBadge tournamentSlug={polla.tournament} size="md" />
          </p>
        </div>
        <div className="p-6 space-y-4">
          {polla.description && (
            <p className="text-text-secondary text-sm text-center">{polla.description}</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">{participantCount}</p>
              <p className="text-[11px] text-text-muted">Participantes</p>
            </div>
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">
                {polla.buy_in_amount > 0 ? formatCOP(polla.buy_in_amount) : "Gratis"}
              </p>
              <p className="text-[11px] text-text-muted">
                {polla.buy_in_amount > 0 ? "Entrada (COP)" : "Sin costo"}
              </p>
            </div>
          </div>

          {authed === false ? (
            <button
              onClick={goLogin}
              className="w-full bg-gold text-bg-base font-semibold py-4 rounded-xl hover:brightness-110 transition-all text-lg"
            >
              Iniciar sesión y unirse
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full bg-gold text-bg-base font-semibold py-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 text-lg"
            >
              {joining ? "Uniéndose..." : "Unirse a esta polla"}
            </button>
          )}

          <button
            onClick={() => router.push("/inicio")}
            className="w-full text-text-muted text-sm py-2"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
