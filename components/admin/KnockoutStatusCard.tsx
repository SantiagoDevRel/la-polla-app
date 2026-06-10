// components/admin/KnockoutStatusCard.tsx — Estado de knockouts del Mundial
// en el dashboard /admin. Muestra:
//   - Slots de bracket aún codificados ("W93 vs W94") cuyo kickoff está
//     cerca (<72h) — significa que ni openfootball ni football-data
//     publicaron los equipos reales y toca correr "Sync Mundial" manual.
//   - Alertas operativas de admin_alerts (ej: el RPC bloqueó un insert
//     duplicado de knockout y necesita resolución manual).
// Si no hay nada urgente, renderiza un banner sutil verde con el conteo
// de slots restantes (informativo, sin acción).
"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";

interface PendingSlot {
  id: string;
  phase: string | null;
  match_day: number | null;
  home_team: string;
  away_team: string;
  scheduled_at: string;
}

interface AdminAlert {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
}

interface BracketProposal {
  id: string;
  match_id: string;
  slot_home: string;
  slot_away: string;
  p_home_team: string;
  p_away_team: string;
  p_scheduled_at: string;
  p_phase: string | null;
  p_match_day: number | null;
  source: string;
  fetched_at: string;
}

const PHASE_LABEL: Record<string, string> = {
  round_of_32: "16avos",
  round_of_16: "Octavos",
  quarter_finals: "Cuartos",
  semi_finals: "Semis",
  third_place: "3er puesto",
  final: "Final",
};

const URGENT_MS = 72 * 60 * 60 * 1000;

export default function KnockoutStatusCard() {
  const { showToast } = useToast();
  const [pending, setPending] = useState<PendingSlot[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [proposals, setProposals] = useState<BracketProposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<{
        pending: PendingSlot[];
        alerts: AdminAlert[];
        proposals: BracketProposal[];
      }>("/api/admin/knockout-status");
      setPending(data.pending ?? []);
      setAlerts(data.alerts ?? []);
      setProposals(data.proposals ?? []);
    } catch {
      // silencioso — el card simplemente no se muestra si falla
    } finally {
      setLoaded(true);
    }
  }, []);

  const decideProposal = useCallback(
    async (proposalId: string, action: "approve" | "reject") => {
      setDeciding(proposalId);
      try {
        await axios.post("/api/admin/knockout-status", { proposalId, action });
        showToast(
          action === "approve" ? "Cruce publicado ✅" : "Propuesta rechazada",
          action === "approve" ? "success" : "info",
        );
        await load();
      } catch {
        showToast("No se pudo procesar la propuesta", "error");
      } finally {
        setDeciding(null);
      }
    },
    [load, showToast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/sync-worldcup", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Sync falló");
      showToast(`Sync Mundial: ${body?.synced ?? 0} partidos actualizados`, "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error en sync", "error");
    } finally {
      setSyncing(false);
    }
  }, [load, showToast]);

  const resolveAlert = useCallback(
    async (alertId: string) => {
      try {
        await axios.patch("/api/admin/knockout-status", { alertId });
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      } catch {
        showToast("No se pudo resolver la alerta", "error");
      }
    },
    [showToast],
  );

  if (!loaded || (pending.length === 0 && alerts.length === 0 && proposals.length === 0))
    return null;

  const urgent = pending.filter(
    (p) => new Date(p.scheduled_at).getTime() - Date.now() < URGENT_MS,
  );
  const isUrgent = urgent.length > 0 || alerts.length > 0;
  const hasProposals = proposals.length > 0;

  return (
    <section
      className="rounded-2xl p-4 space-y-3"
      style={
        hasProposals
          ? { background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.35)" }
          : isUrgent
            ? { background: "rgba(255,61,87,0.08)", border: "1px solid rgba(255,61,87,0.35)" }
            : { background: "rgba(31,216,127,0.06)", border: "1px solid rgba(31,216,127,0.20)" }
      }
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary">
            {hasProposals
              ? `Mundial: ${proposals.length} cruce${proposals.length > 1 ? "s" : ""} esperando tu confirmación`
              : isUrgent
                ? `Mundial: ${urgent.length > 0 ? `${urgent.length} cruce${urgent.length > 1 ? "s" : ""} sin equipos a <72h del kickoff` : `${alerts.length} alerta${alerts.length > 1 ? "s" : ""} de sync`}`
                : `Mundial: ${pending.length} cruce${pending.length > 1 ? "s" : ""} de bracket por definirse`}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {hasProposals
              ? "Confirmá cada cruce para publicarlo. A <12h del kickoff se publican solos (red de seguridad)."
              : isUrgent
                ? "Los proveedores no publicaron los equipos aún. Corré el sync manual o resolvé con Claude Code."
                : "Los proveedores los proponen solos (sync cada 6h) y te aparecen acá para confirmar."}
          </p>
        </div>
        {isUrgent && (
          <button
            onClick={runSync}
            disabled={syncing}
            className="text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0 hover:brightness-110 transition-all disabled:opacity-60"
            style={{ background: "#FF3D57", color: "#fff" }}
          >
            {syncing ? "Sync…" : "Sync Mundial"}
          </button>
        )}
      </div>

      {proposals.length > 0 && (
        <ul className="space-y-2">
          {proposals.map((pr) => (
            <li
              key={pr.id}
              className="rounded-xl p-3"
              style={{ background: "#0e1420", border: "1px solid rgba(255,215,0,0.20)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-text-primary truncate">
                    {pr.p_home_team} vs {pr.p_away_team}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {PHASE_LABEL[pr.p_phase ?? ""] ?? pr.p_phase}
                    {pr.p_match_day ? ` · partido #${pr.p_match_day}` : ""} · era {pr.slot_home} vs {pr.slot_away} ·{" "}
                    {new Date(pr.p_scheduled_at).toLocaleString("es-CO", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · fuente: {pr.source}
                  </p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => decideProposal(pr.id, "approve")}
                    disabled={deciding === pr.id}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:brightness-110 transition-all disabled:opacity-60"
                    style={{ background: "#1FD87F", color: "#080c10" }}
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => decideProposal(pr.id, "reject")}
                    disabled={deciding === pr.id}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border hover:border-text-secondary/40 transition-colors disabled:opacity-60"
                    style={{ borderColor: "rgba(255,61,87,0.4)", color: "#FF3D57" }}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {urgent.length > 0 && (
        <ul className="space-y-1">
          {urgent.slice(0, 6).map((p) => (
            <li key={p.id} className="text-[11px] text-text-secondary flex justify-between gap-2">
              <span className="truncate">
                {PHASE_LABEL[p.phase ?? ""] ?? p.phase} · {p.home_team} vs {p.away_team}
                {p.match_day ? ` (#${p.match_day})` : ""}
              </span>
              <span className="flex-shrink-0 text-text-muted">
                {new Date(p.scheduled_at).toLocaleString("es-CO", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {alerts.length > 0 && (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="rounded-xl p-3 text-[11px]"
              style={{ background: "#0e1420", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-text-primary">{a.title}</p>
                <button
                  onClick={() => resolveAlert(a.id)}
                  className="text-[10px] font-semibold px-2 py-1 rounded-lg border flex-shrink-0 hover:border-text-secondary/40 transition-colors"
                  style={{ borderColor: "rgba(255,255,255,0.12)", color: "#AEB7C7" }}
                >
                  Resolver
                </button>
              </div>
              <p className="text-text-muted mt-1 break-words">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
