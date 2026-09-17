// app/(app)/admin/discrepancias/page.tsx
// Panel admin para destrabar partidos terminados que la verificación
// automática no cerró (API-Football sin segunda lectura, identidad dudosa o
// marcador en conflicto). Mientras un match esté finished SIN
// final_verified_at, el scoring NO se ejecuta — para evitar puntuar con
// datos mal. El admin confirma la última lectura guardada de API-Football o
// ingresa el marcador de 90' a mano; el servidor cierra con
// finalize_verified_match_result y el trigger de scoring puntúa.
"use client";

import { COLOMBIA_TIME_ZONE } from "@/lib/time/colombia";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowLeft, AlertTriangle, Check, Wrench } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";

interface Discrepancy {
  id: string;
  tournament: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  home_score: number | null;
  away_score: number | null;
  af_status: string | null;
  af_fetched_at: string | null;
  af_home: number | null;
  af_away: number | null;
  af_fulltime_home: number | null;
  af_fulltime_away: number | null;
  af_penalty_home: number | null;
  af_penalty_away: number | null;
  scheduled_at: string;
  final_verification_notes: string | null;
  alerted_at: string | null;
}

interface StuckPolla {
  id: string;
  slug: string;
  name: string;
  matchCount: number;
  participantCount: number;
  buyIn: number;
}

interface EndedNoPayouts {
  id: string;
  slug: string;
  name: string;
  paymentMode: string;
  buyIn: number;
  participantCount: number;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function AdminDiscrepanciasPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<Discrepancy[]>([]);
  const [stuckPollas, setStuckPollas] = useState<StuckPolla[]>([]);
  const [endedNoPayouts, setEndedNoPayouts] = useState<EndedNoPayouts[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fixingPollaId, setFixingPollaId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<Record<string, { home: string; away: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [matchesRes, healthRes] = await Promise.all([
        axios.get<{ matches: Discrepancy[] }>("/api/admin/discrepancies"),
        axios.get<{ stuckPollas: StuckPolla[]; endedNoPayouts: EndedNoPayouts[] }>(
          "/api/admin/polla-health",
        ),
      ]);
      setItems(matchesRes.data.matches);
      setStuckPollas(healthRes.data.stuckPollas);
      setEndedNoPayouts(healthRes.data.endedNoPayouts);
    } catch {
      showToast("No se pudieron cargar las discrepancias", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  async function fixPolla(pollaId: string) {
    setFixingPollaId(pollaId);
    try {
      const res = await axios.post<{
        ok: boolean;
        closed: boolean;
        materialized: number;
      }>(`/api/admin/polla-health/${pollaId}/fix`);
      const parts: string[] = [];
      if (res.data.closed) parts.push("polla cerrada");
      if (res.data.materialized > 0) parts.push("payouts materializados");
      showToast(parts.length > 0 ? parts.join(" + ") : "Sin cambios", "success");
      await load();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "Error al reparar";
      showToast(msg, "error");
    } finally {
      setFixingPollaId(null);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(
    match: Discrepancy,
    source: "api-football" | "manual",
    home?: number,
    away?: number,
  ) {
    setBusyId(match.id);
    try {
      const body =
        source === "api-football"
          ? { source }
          : { source, home, away };
      await axios.post(`/api/admin/discrepancies/${match.id}`, body);
      showToast("Discrepancia resuelta — el scoring va a ejecutarse", "success");
      await load();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "Error al resolver";
      showToast(msg, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#080c10" }}>
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/admin")}
            className="text-text-secondary hover:text-gold transition-colors"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber" /> Discrepancias
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <FootballLoader />
            <p className="text-text-muted text-sm">Cargando…</p>
          </div>
        ) : items.length === 0 && stuckPollas.length === 0 && endedNoPayouts.length === 0 ? (
          <div className="rounded-2xl p-6 lp-card text-center space-y-2">
            <Check className="w-8 h-8 text-turf mx-auto" />
            <p className="text-sm text-text-primary font-semibold">Sin discrepancias</p>
            <p className="text-[12px] text-text-muted">
              Todos los partidos finalizados están verificados y todas las pollas
              cerradas tienen payouts. El scoring corre solo.
            </p>
          </div>
        ) : (
          <>
            {(stuckPollas.length > 0 || endedNoPayouts.length > 0) && (
              <section className="space-y-2">
                <h2 className="text-[12px] uppercase tracking-[0.1em] text-amber font-semibold flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" />
                  Pollas con problemas ({stuckPollas.length + endedNoPayouts.length})
                </h2>
                {stuckPollas.map((p) => (
                  <article
                    key={p.id}
                    className="lp-card p-3 border border-amber/30 space-y-2"
                  >
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-amber/80">
                        Trabada · active con todos los matches terminales
                      </p>
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {p.matchCount} matches · {p.participantCount} participantes pagados · ${p.buyIn.toLocaleString("es-CO")} buy-in
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/pollas/${p.slug}`)}
                        className="flex-1 text-[11px] py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:border-gold/40 hover:text-gold transition-colors"
                      >
                        Ver polla
                      </button>
                      <button
                        type="button"
                        onClick={() => fixPolla(p.id)}
                        disabled={fixingPollaId === p.id}
                        className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg bg-amber/15 border border-amber/30 text-amber hover:bg-amber/20 transition-colors disabled:opacity-50"
                      >
                        {fixingPollaId === p.id ? "…" : "Cerrar + materializar"}
                      </button>
                    </div>
                  </article>
                ))}
                {endedNoPayouts.map((p) => (
                  <article
                    key={p.id}
                    className="lp-card p-3 border border-amber/30 space-y-2"
                  >
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-amber/80">
                        Ended sin payouts materializados
                      </p>
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {p.paymentMode} · {p.participantCount} participantes · ${p.buyIn.toLocaleString("es-CO")} buy-in
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/pollas/${p.slug}`)}
                        className="flex-1 text-[11px] py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:border-gold/40 hover:text-gold transition-colors"
                      >
                        Ver polla
                      </button>
                      <button
                        type="button"
                        onClick={() => fixPolla(p.id)}
                        disabled={fixingPollaId === p.id}
                        className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg bg-amber/15 border border-amber/30 text-amber hover:bg-amber/20 transition-colors disabled:opacity-50"
                      >
                        {fixingPollaId === p.id ? "…" : "Materializar payouts"}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}

            {items.length > 0 && (
              <section className="space-y-2 pt-2">
                <h2 className="text-[12px] uppercase tracking-[0.1em] text-amber font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Partidos sin verificar ({items.length})
                </h2>
                <p className="text-[11px] text-text-secondary">
                  {items.length} partido{items.length > 1 ? "s" : ""} esperan tu confirmación.
                  Mientras no resuelvas la discrepancia, el scoring no se ejecuta.
                </p>
              </section>
            )}
            {items.map((m) => {
              const db = { h: m.home_score, a: m.away_score };
              const af = { h: m.af_home, a: m.af_away };
              const afFinal = af.h !== null && af.a !== null;
              const matches = afFinal && db.h === af.h && db.a === af.a;
              const draft = manualDraft[m.id] ?? { home: "", away: "" };
              return (
                <article
                  key={m.id}
                  className="lp-card p-4 space-y-3 border border-amber/20"
                >
                  <header className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted truncate">
                        {m.tournament}
                      </p>
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {m.home_team} vs {m.away_team}
                      </p>
                    </div>
                    <span className="text-[11px] text-text-muted whitespace-nowrap">
                      {fmtDate(m.scheduled_at)}
                    </span>
                  </header>

                  {/* Score side-by-side */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Guardado en la base</p>
                      <p className="font-display text-[28px] text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                        {db.h ?? "—"} - {db.a ?? "—"}
                      </p>
                      <p className="mt-2 text-[11px] text-text-muted">
                        Puede incluir alargue. Para usarlo, ingrésalo abajo.
                      </p>
                    </div>
                    <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle">
                      <p className="text-[10px] uppercase tracking-wide text-text-muted">Resultado recibido · 90&apos;</p>
                      <p className="font-display text-[28px] text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                        {af.h ?? "—"} - {af.a ?? "—"}
                      </p>
                      {m.af_fetched_at ? (
                        <p className="text-[10px] text-text-muted">
                          {m.af_status ?? "?"}
                          {m.af_fulltime_home !== null && m.af_fulltime_away !== null && (m.af_fulltime_home !== af.h || m.af_fulltime_away !== af.a)
                            ? ` · final ${m.af_fulltime_home}-${m.af_fulltime_away}`
                            : ""}
                          {m.af_penalty_home !== null && m.af_penalty_away !== null
                            ? ` · penales ${m.af_penalty_home}-${m.af_penalty_away}`
                            : ""}
                          {` · leído ${fmtDate(m.af_fetched_at)}`}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (!afFinal) {
                            showToast("Todavía no llega un resultado final de este partido", "error");
                            return;
                          }
                          resolve(m, "api-football");
                        }}
                        disabled={busyId === m.id || !afFinal}
                        className="mt-2 w-full text-[11px] font-semibold py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf hover:bg-turf/20 transition-colors disabled:opacity-50"
                      >
                        {busyId === m.id ? "…" : "Confirmar este"}
                      </button>
                    </div>
                  </div>

                  {matches ? (
                    <p className="text-[11px] text-turf">
                      La base y el resultado recibido coinciden ahora.
                    </p>
                  ) : null}

                  {/* Manual override */}
                  <div className="rounded-xl p-3 bg-bg-base border border-border-subtle space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">
                      Manual (override)
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.home}
                        onChange={(e) =>
                          setManualDraft((p) => ({
                            ...p,
                            [m.id]: { ...draft, home: e.target.value.replace(/\D/g, "") },
                          }))
                        }
                        placeholder={String(db.h ?? 0)}
                        className="w-14 text-center bg-bg-elevated border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-gold/50"
                      />
                      <span className="text-text-muted">-</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.away}
                        onChange={(e) =>
                          setManualDraft((p) => ({
                            ...p,
                            [m.id]: { ...draft, away: e.target.value.replace(/\D/g, "") },
                          }))
                        }
                        placeholder={String(db.a ?? 0)}
                        className="w-14 text-center bg-bg-elevated border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-gold/50"
                      />
                      <button
                        type="button"
                        disabled={busyId === m.id || !draft.home || !draft.away}
                        onClick={() => {
                          const h = parseInt(draft.home, 10);
                          const a = parseInt(draft.away, 10);
                          if (!Number.isFinite(h) || !Number.isFinite(a)) return;
                          resolve(m, "manual", h, a);
                        }}
                        className="ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-amber/15 border border-amber/30 text-amber hover:bg-amber/20 transition-colors disabled:opacity-50"
                      >
                        {busyId === m.id ? "…" : "Aplicar"}
                      </button>
                    </div>
                  </div>

                  {m.alerted_at ? (
                    <p className="text-[10px] text-text-muted">
                      Alertado: {fmtDate(m.alerted_at)}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
