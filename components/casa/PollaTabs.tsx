"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trophy } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import type { CasaEntryStatus, CasaLeaderboardRow, CasaPollaStatus } from "@/lib/casa/types";

interface Props {
  slug: string;
  firstLabel: string;
  children: ReactNode;
  initialRows: CasaLeaderboardRow[];
  entryStatus: CasaEntryStatus | null;
  pollaStatus: CasaPollaStatus;
  userId: string;
}

export function PollaTabs({ slug, firstLabel, children, initialRows, entryStatus, pollaStatus, userId }: Props) {
  const [tab, setTab] = useState<0 | 1>(0);
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const router = useRouter();

  useEffect(() => { setRows(initialRows); }, [initialRows]);

  // Poll only while the table is visible. Keep drafts mounted in the other
  // panel; opening the table must never discard an unsaved prediction.
  useEffect(() => {
    if (tab !== 1) return;
    let active = true;
    let fetching = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (document.hidden || fetching) return;
      fetching = true;
      controller = new AbortController();
      setLoading(true);
      try {
        const response = await fetch(`/api/casa/pollas/${encodeURIComponent(slug)}/leaderboard`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudo actualizar la tabla.");
        if (!active) return;
        setRows(data.rows);
        setError(null);
        if (data.entryStatus !== entryStatus || data.pollaStatus !== pollaStatus) router.refresh();
      } catch (cause) {
        if (active && !controller?.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "No se pudo actualizar la tabla.");
        }
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = pollaStatus === "resuelta" ? undefined : window.setInterval(refresh, 30_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tab, slug, revision, entryStatus, pollaStatus, router]);

  return (
    <section className="mt-7">
      <div role="tablist" aria-label="Contenido de la polla" className="grid grid-cols-2 gap-1 rounded-full border border-border-subtle bg-bg-card p-1">
        {[firstLabel, "Tabla"].map((label, index) => (
          <button
            key={label}
            ref={(element) => { buttons.current[index] = element; }}
            id={`${id}-tab-${index}`}
            role="tab"
            type="button"
            aria-selected={tab === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={tab === index ? 0 : -1}
            onClick={() => setTab(index as 0 | 1)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : tab === 0 ? 1 : 0;
              setTab(next);
              buttons.current[next]?.focus();
            }}
            className={`min-h-12 min-w-0 cursor-pointer rounded-full px-3 py-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${tab === index ? "bg-bg-elevated text-text-primary" : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"}`}
          >{label}</button>
        ))}
      </div>

      <div id={`${id}-panel-0`} role="tabpanel" aria-labelledby={`${id}-tab-0`} hidden={tab !== 0} tabIndex={0}>
        {children}
      </div>
      <div id={`${id}-panel-1`} role="tabpanel" aria-labelledby={`${id}-tab-1`} hidden={tab !== 1} tabIndex={0} className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="lp-display-sm text-text-primary">Posiciones</h2>
          <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="lp-btn lp-btn-ghost min-h-11 gap-2 text-xs disabled:opacity-50" aria-label="Actualizar tabla">
            <RefreshCw size={16} aria-hidden />{loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-text-secondary">
          Solo cuentan los pagos aprobados. Al confirmar tu pago, se incluyen los puntos de tus pronósticos válidos.
        </p>
        {error && <div role="alert" className="mb-3 rounded-lg border border-red-alert/40 bg-red-alert/10 p-3 text-sm text-text-primary">
          <p>{error} Los datos anteriores se conservan.</p>
          <button type="button" onClick={() => setRevision(value => value + 1)} className="lp-btn lp-btn-ghost mt-2 min-h-11">Reintentar</button>
        </div>}
        {rows.length === 0 ? (
          <div className="lp-card p-6 text-center">
            <Trophy size={28} className="mx-auto text-text-muted" aria-hidden />
            <h3 className="lp-display-sm mt-3">Aún no hay participantes en la tabla</h3>
            <p className="mt-2 text-sm text-text-secondary">Aquí aparecerán los jugadores cuando confirmemos sus pagos.</p>
          </div>
        ) : (
          <table className="w-full table-fixed text-left">
            <caption className="sr-only">Tabla de posiciones: {rows.length} participantes con pago aprobado</caption>
            <thead className="text-[11px] uppercase tracking-wide text-text-muted">
              <tr><th scope="col" className="w-12 pb-2 font-medium"><span className="sr-only">Posición</span><span aria-hidden>Pos.</span></th><th scope="col" className="pb-2 font-medium">Jugador</th><th scope="col" className="w-16 pb-2 text-right font-medium"><span className="sr-only">Puntos</span><span aria-hidden>Pts.</span></th></tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.entry_id} className={`border-t border-border-subtle transition-colors duration-200 hover:bg-bg-elevated ${row.user_id === userId ? "bg-turf/10" : "bg-bg-card"}`}>
                  <td className="lp-money px-2 py-3 align-top text-lg">{row.puesto}</td>
                  <th scope="row" className="py-3 font-medium">
                    <div className="flex items-start gap-2">
                      <UserAvatar avatarUrl={row.avatar_url} displayName={row.display_name ?? "Jugador"} size="sm" />
                      <span className="min-w-0 self-center text-sm [overflow-wrap:anywhere]">{row.display_name ?? "Sin nombre"}{row.user_id === userId && <span className="ml-1 text-xs text-turf">(tú)</span>}</span>
                    </div>
                  </th>
                  <td className="lp-money py-3 pr-2 text-right align-top text-lg">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
