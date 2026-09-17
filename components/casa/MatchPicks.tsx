"use client";

// components/casa/MatchPicks.tsx — «Pronósticos de otros» de un partido.
//
// (2026-09-16) Pedido del dueño: un desplegable que muestre unos pocos y que
// uno siga bajando SOLO dentro del desplegable, no en toda la página. La lista
// tiene alto fijo (unas 6 filas) con scroll propio; al llegar abajo pide la
// página siguiente sola, y queda un botón «Cargar más» para teclado y lector
// de pantalla. Cerrado por defecto: el partido no crece hasta que se abre.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import type { Pick1x2 } from "@/lib/casa/types";
import { shortTeam } from "@/lib/casa/live-status";

interface Row {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  pick1x2: Pick1x2 | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Solo si esa persona tiene varias participaciones aprobadas. */
  entryNumber?: number | null;
  /** La fila es de quien mira (el servidor lo decide; nunca viaja el user_id). */
  mine?: boolean;
  /** Puntos de ese pronóstico, solo cuando el resultado ya está verificado. */
  pointsEarned?: number | null;
}
interface Props {
  slug: string;
  matchId: string;
  scoringMode: "marcador" | "1x2";
  home: string;
  away: string;
  /** Cuántos pronosticaron (del reparto de porcentajes); null si no se sabe. */
  count?: number | null;
  /** Una línea de contexto arriba de la lista («3 de 12 pusieron 2-1»). */
  summary?: string | null;
}
/** `retryable` only for network failures and server errors (status >= 500). */
interface LoadError { message: string; retryable: boolean }

const GENERIC_ERROR = "No se pudieron cargar los pronósticos.";
const SESSION_ERROR = "Tu sesión terminó. Vuelve a ingresar para ver los pronósticos.";

export class ResponseError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export async function readPicks(response: Response): Promise<{ rows: Row[]; hasMore: boolean }> {
  // A followed redirect to the login page arrives as HTML: the session ended.
  if (response.status === 401 || response.redirected) throw new ResponseError(SESSION_ERROR, false);
  const isJson = (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
  if (!isJson) throw new ResponseError(GENERIC_ERROR, response.status >= 500);
  let data: { rows?: unknown; hasMore?: unknown; error?: unknown };
  // A JSON body that cannot be read was cut off in transit: a network failure.
  try { data = await response.json(); } catch { throw new ResponseError(GENERIC_ERROR, true); }
  if (!response.ok) {
    throw new ResponseError(typeof data.error === "string" && data.error ? data.error : GENERIC_ERROR, response.status >= 500);
  }
  if (!Array.isArray(data.rows)) throw new ResponseError(GENERIC_ERROR, false);
  return { rows: data.rows as Row[], hasMore: data.hasMore === true };
}

function pickText(row: Row, scoringMode: Props["scoringMode"], home: string, away: string): string {
  if (scoringMode === "marcador") return `${row.homeScore ?? "–"}-${row.awayScore ?? "–"}`;
  return row.pick1x2 === "L" ? shortTeam(home) : row.pick1x2 === "V" ? shortTeam(away) : row.pick1x2 === "E" ? "Empate" : "Sin pronóstico";
}

export function MatchPicks({ slug, matchId, scoringMode, home, away, count = null, summary = null }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [revision, setRevision] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/casa/pollas/${encodeURIComponent(slug)}/match-picks?match=${matchId}&page=${page}`, { cache: "no-store", signal: controller.signal });
        const data = await readPicks(response);
        if (controller.signal.aborted) return;
        // La página 0 reemplaza (reintento o reapertura); las demás se suman.
        setRows((previous) => {
          const merged = page === 0 ? data.rows : [...previous, ...data.rows];
          return Array.from(new Map(merged.map((row) => [row.id, row])).values());
        });
        setHasMore(data.hasMore);
      } catch (cause) {
        if (controller.signal.aborted) return;
        // Parse or unexpected errors show a generic message, never their internals.
        setError(cause instanceof ResponseError ? { message: cause.message, retryable: cause.retryable } : { message: GENERIC_ERROR, retryable: true });
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [open, slug, matchId, page, revision]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || error) return;
    setPage((value) => value + 1);
  }, [loading, hasMore, error]);

  // Bajar dentro del desplegable trae la página siguiente; la página no se mueve.
  function onScroll() {
    const element = listRef.current;
    if (!element) return;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 48) loadMore();
  }

  const label = `${open ? "Ocultar" : "Ver"} pronósticos de otros${count != null && count > 0 ? ` (${count})` : ""}`;

  return (
    <div className="mt-2 border-t border-border-subtle pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 text-left text-[13px] font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        <span>{label}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id}>
          {summary && <p className="mb-1 px-1 text-[12px] text-text-muted">{summary}</p>}
          {error ? (
            <div role="alert" className="px-1 py-2 text-[13px]">
              <p className="text-text-secondary">{error.message}</p>
              {error.retryable && <button type="button" className="lp-btn lp-btn-ghost mt-2 min-h-11 !text-[13px]" onClick={() => { setPage(0); setRevision((value) => value + 1); }}>Reintentar</button>}
            </div>
          ) : rows.length === 0 && loading ? (
            <div role="status" className="px-1 py-2"><span className="sr-only">Cargando pronósticos</span><div className="h-20 animate-pulse rounded-md bg-bg-elevated" /></div>
          ) : rows.length === 0 ? (
            <p className="rounded-md bg-bg-elevated p-3 text-[13px] text-text-secondary">Todavía no hay pronósticos de participantes con pago aprobado.</p>
          ) : (
            <div
              ref={listRef}
              onScroll={onScroll}
              className="max-h-[264px] overflow-y-auto overscroll-contain rounded-md border border-border-subtle bg-bg-elevated/60"
              aria-label={`Pronósticos de otros para ${home} contra ${away}`}
            >
              <ul className="divide-y divide-border-subtle">
                {rows.map((row) => (
                  <li key={row.id} className={`flex min-h-10 items-center gap-2 px-2 py-1.5 ${row.mine ? "bg-gold/10" : ""}`}>
                    <UserAvatar avatarUrl={row.avatarUrl} displayName={row.displayName} size="sm" className="!h-6 !w-6" />
                    <span className={`min-w-0 flex-1 text-[13px] leading-tight [overflow-wrap:anywhere] ${row.mine ? "font-semibold text-gold" : "text-text-primary"}`}>
                      {row.displayName}
                      {row.entryNumber != null && <span className="ml-1 whitespace-nowrap text-[12px] text-text-secondary">#{row.entryNumber}</span>}
                      {row.mine && <span className="ml-1 text-[12px] text-gold/80">(tú)</span>}
                    </span>
                    <span className={`shrink-0 text-right ${scoringMode === "marcador" ? "lp-money text-[18px]" : "text-[13px] font-semibold"} text-text-primary`}>
                      {pickText(row, scoringMode, home, away)}
                    </span>
                    {row.pointsEarned != null && (
                      <span className={`lp-money min-w-12 shrink-0 text-right text-[13px] ${row.pointsEarned > 0 ? "text-turf" : "text-amber"}`}>
                        {row.pointsEarned > 0 ? `+${row.pointsEarned} pts` : "0 pts"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {loading && <p role="status" className="px-2 py-2 text-center text-[12px] text-text-muted">Cargando más…</p>}
              {!loading && hasMore && (
                <button type="button" onClick={loadMore} className="flex min-h-11 w-full cursor-pointer items-center justify-center text-[13px] font-semibold text-text-secondary hover:text-text-primary">
                  Cargar más
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
