// app/(app)/invites/polla/[token]/page.tsx — Open shareable invite landing.
// Anyone with the link can join the polla (subject to the polla's payment
// requirements). Not tied to a specific phone number.
//
// A6: full pre-join preview. The page now shows organizer, participant count,
// pot, tipo (privada/abierta), and the full match list before the Unirme CTA
// so the invitee can decide informed.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import axios from "axios";
import { ChevronDown, CreditCard, Info, Target } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";
import TournamentBadge from "@/components/shared/TournamentBadge";
import UserAvatar from "@/components/ui/UserAvatar";
import { formatCOP } from "@/lib/formatCurrency";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import {
  groupMatchesByDate,
  groupMatchesByPhase,
} from "@/lib/matches/grouping";

interface PollaSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tournament: string;
  buy_in_amount: number;
  type: string;
  status: string;
  created_by: string;
  match_ids: string[] | null;
  payment_mode: string;
  admin_payment_instructions: string | null;
}

interface OrganizerSummary {
  display_name: string;
  avatar_url: string | null;
}

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  phase: string | null;
}

type GroupMode = "phase" | "date";

function formatMatchDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date}, ${time}`;
}

function MatchRowView({ m }: { m: MatchRow }) {
  return (
    <li className="rounded-lg p-3 bg-bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2 text-sm text-text-primary min-w-0">
        {m.home_team_flag ? (
          <Image
            src={m.home_team_flag}
            alt=""
            width={18}
            height={18}
            className="flex-shrink-0"
            style={{ objectFit: "contain" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <span className="truncate flex-1 min-w-0">{m.home_team}</span>
        <span className="text-text-muted text-xs shrink-0">vs</span>
        {m.away_team_flag ? (
          <Image
            src={m.away_team_flag}
            alt=""
            width={18}
            height={18}
            className="flex-shrink-0"
            style={{ objectFit: "contain" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <span className="truncate flex-1 min-w-0">{m.away_team}</span>
      </div>
      <p className="text-[11px] text-text-muted mt-1">
        {formatMatchDate(m.scheduled_at)}
      </p>
    </li>
  );
}

export default function OpenInvitePage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [polla, setPolla] = useState<PollaSummary | null>(null);
  const [organizer, setOrganizer] = useState<OrganizerSummary | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [error, setError] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("phase");

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const isAuthed = !!user;
        setAuthed(isAuthed);

        const { data: row, error: rowErr } = await supabase
          .from("pollas")
          .select(
            "id, slug, name, description, tournament, buy_in_amount, type, status, created_by, match_ids, payment_mode, admin_payment_instructions"
          )
          .eq("invite_token", token)
          .maybeSingle<PollaSummary>();
        if (rowErr || !row) {
          setError("Link inválido o expirado. Pedíle al organizador que te comparta el link actualizado.");
          return;
        }
        setPolla(row);

        // Ya unido: no seguimos cargando el resto del preview.
        // La RLS "participants_select" usa un EXISTS recursivo sobre la
        // misma tabla y devuelve vacío para el cliente del navegador, asi
        // que consultamos un endpoint server-side que usa admin client.
        if (isAuthed) {
          try {
            const { data: mem } = await axios.get<{ member: boolean }>(
              `/api/pollas/${row.slug}/membership`
            );
            if (mem.member) {
              setAlreadyJoined(true);
              return;
            }
          } catch (err) {
            console.warn("[invites] membership check failed:", err);
          }
        }

        const matchIds = row.match_ids ?? [];
        // Participant count + organizer both come from the server-side
        // preview route. polla_participants RLS returns zero rows for
        // anonymous sessions (recursive EXISTS), and users_select_own RLS
        // blocks organizer SELECTs for anyone but the organizer themselves.
        // The admin client inside /api/pollas/preview bypasses both.
        const [previewRes, matchesRes] = await Promise.all([
          axios
            .get<{
              participantCount: number;
              organizer: OrganizerSummary | null;
            }>(`/api/pollas/preview?token=${encodeURIComponent(token)}`)
            .then((r) => ({
              count: r.data.participantCount,
              organizer: r.data.organizer,
            }))
            .catch((err) => {
              console.warn("[invites] preview fetch failed:", err);
              return { count: 0, organizer: null as OrganizerSummary | null };
            }),
          matchIds.length > 0
            ? supabase
                .from("matches")
                .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, phase")
                .in("id", matchIds)
                .order("scheduled_at", { ascending: true })
                .returns<MatchRow[]>()
            : Promise.resolve({ data: [] as MatchRow[] }),
        ]);
        setOrganizer(previewRes.organizer ?? null);
        setParticipantCount(previewRes.count ?? 0);
        setMatches(matchesRes.data ?? []);
      } catch {
        setError("Error cargando la invitación");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token, router]);

  const groups = useMemo(() => {
    if (groupMode === "date") return groupMatchesByDate(matches);
    return groupMatchesByPhase(matches);
  }, [matches, groupMode]);

  // Default: expand the first (earliest) group, collapse the rest. Re-runs
  // when the groups array identity changes (either matches loaded or the
  // user flipped the toggle).
  useEffect(() => {
    if (groups.length === 0) return;
    setExpandedPhases(new Set([groups[0].key]));
  }, [groups]);

  function togglePhase(key: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
      const msg = e.response?.data?.error || "Error al unirse";
      showToast(
        msg === "invite_required"
          ? "Esta polla es privada. Necesitas un link de invitación válido del organizador."
          : msg,
        "error",
      );
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

  // Ya unido: tarjeta de confirmación corta, sin preview.
  if (alreadyJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl p-6 text-center max-w-sm w-full bg-bg-card border border-border-subtle">
          <Target className="w-10 h-10 text-gold mx-auto mb-3" />
          <h1 className="text-xl font-bold text-text-primary mb-1">
            Ya estás en esta polla
          </h1>
          <p className="text-text-secondary text-sm mb-4">
            Ya te uniste a {polla.name} antes, parce.
          </p>
          <button
            onClick={() => router.push(`/pollas/${polla.slug}`)}
            className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all"
          >
            Ir a la polla
          </button>
        </div>
      </div>
    );
  }

  const isEnded = polla.status === "ended";
  const potTotal = polla.buy_in_amount > 0 ? polla.buy_in_amount * participantCount : 0;

  return (
    // h-screen + flex column keeps the card the full viewport height so the
    // match list can scroll internally while header/badges/CTA stay pinned.
    <div className="h-screen flex flex-col items-center justify-start p-4">
      <div className="rounded-2xl max-w-md w-full flex-1 flex flex-col min-h-0 overflow-hidden bg-bg-card border border-border-subtle">
        <div
          className="p-5 text-center shrink-0"
          style={{ background: "linear-gradient(180deg, #0a1628 0%, var(--bg-card) 100%)" }}
        >
          <Target className="w-9 h-9 text-gold mx-auto mb-2" />
          <h1 className="text-2xl font-display uppercase tracking-[0.04em] text-text-primary">
            {polla.name}
          </h1>
          <div className="mt-2 flex justify-center">
            <TournamentBadge tournamentSlug={polla.tournament} size="md" />
          </div>
          {organizer ? (
            <div className="mt-2 flex items-center justify-center gap-2 text-text-secondary text-sm">
              <span>Creada por</span>
              <UserAvatar
                avatarUrl={organizer.avatar_url}
                displayName={organizer.display_name}
                size="sm"
              />
              <span className="font-semibold text-text-primary">{organizer.display_name}</span>
            </div>
          ) : null}
        </div>

        <div className="px-5 pt-3 pb-2 shrink-0 space-y-3">
          {polla.description && (
            <p className="text-text-secondary text-sm text-center">{polla.description}</p>
          )}
          <div className={`grid ${polla.buy_in_amount > 0 ? "grid-cols-3" : "grid-cols-2"} gap-3 text-center`}>
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">{participantCount}</p>
              <p className="text-[11px] text-text-muted">Participantes</p>
            </div>
            <div className="rounded-xl p-3 bg-bg-elevated">
              <p className="score-font text-2xl text-gold">
                {polla.buy_in_amount > 0 ? formatCOP(polla.buy_in_amount) : "Gratis"}
              </p>
              <p className="text-[11px] text-text-muted">
                {polla.buy_in_amount > 0 ? "Buy-in" : "Sin costo"}
              </p>
            </div>
            {polla.buy_in_amount > 0 ? (
              <div className="rounded-xl p-3 bg-bg-elevated">
                <p className="score-font text-2xl text-gold">{formatCOP(potTotal)}</p>
                <p className="text-[11px] text-text-muted">Pozo</p>
              </div>
            ) : null}
          </div>
          {polla.payment_mode === "admin_collects" && polla.admin_payment_instructions ? (
            <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
              <div className="flex items-center gap-2 mb-1.5">
                <CreditCard className="w-4 h-4 text-gold" aria-hidden="true" />
                <p className="text-sm font-semibold text-text-primary">Cómo pagar</p>
              </div>
              <p className="text-xs text-text-secondary whitespace-pre-wrap leading-snug">
                {polla.admin_payment_instructions}
              </p>
            </div>
          ) : null}
        </div>

        {/* Match list — the only scrolling region on the page. */}
        <div className="px-5 pt-2 pb-3 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-2 shrink-0 gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              Partidos incluidos ({matches.length})
            </h2>
          </div>
          {matches.length > 0 ? (
            <div className="flex gap-1 mb-2 shrink-0">
              {([
                { val: "phase", label: "Por fase" },
                { val: "date", label: "Por fecha" },
              ] as { val: GroupMode; label: string }[]).map((opt) => {
                const active = groupMode === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setGroupMode(opt.val)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? "bg-gold text-bg-base"
                        : "bg-transparent text-text-muted border border-border-subtle hover:text-text-primary"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
            {matches.length === 0 ? (
              <p className="text-text-muted text-sm">Todavía no hay partidos asignados.</p>
            ) : (
              <div className="space-y-2">
                {groups.map((group) => {
                  const open = expandedPhases.has(group.key);
                  return (
                    <div
                      key={group.key}
                      className="rounded-lg bg-bg-elevated/50 border border-border-subtle overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase(group.key)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg-elevated transition-colors"
                        aria-expanded={open}
                      >
                        <span>
                          {group.label}{" "}
                          <span className="text-text-muted font-normal">
                            ({group.matches.length})
                          </span>
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      {open ? (
                        <ul className="space-y-2 px-2 pb-2">
                          {group.matches.map((m) => (
                            <MatchRowView key={m.id} m={m} />
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sticky CTA row. Sits at the bottom of the card with a subtle top
            border so the scrolled list does not bleed through. Covers the
            three runtime states: Unirme, Iniciar sesión, Esta polla cerró. */}
        <div
          className="shrink-0 border-t border-border-subtle p-4 bg-bg-card"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {isEnded ? (
            <div className="rounded-xl p-3 text-center bg-bg-elevated border border-border-subtle">
              <p className="text-text-primary font-semibold">Esta polla ya cerró.</p>
              <p className="text-text-secondary text-sm mt-0.5">No podés unirte.</p>
            </div>
          ) : authed === false ? (
            <button
              onClick={goLogin}
              className="w-full bg-gold text-bg-base font-semibold py-3.5 rounded-xl hover:brightness-110 transition-all text-base"
            >
              Iniciar sesión y unirse
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full bg-gold text-bg-base font-semibold py-3.5 rounded-xl hover:brightness-110 transition-all disabled:opacity-50 text-base"
            >
              {joining ? "Uniéndose..." : "Unirme"}
            </button>
          )}
          <button
            onClick={() => router.push("/inicio")}
            className="w-full text-text-muted text-xs pt-2"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
