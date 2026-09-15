"use client";

import { useEffect, useId, useState } from "react";
import { Eye } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import type { Pick1x2 } from "@/lib/casa/types";

interface Row { id: string; displayName: string; avatarUrl: string | null; pick1x2: Pick1x2 | null; homeScore: number | null; awayScore: number | null; /** Solo si esa persona tiene varias participaciones aprobadas. */ entryNumber?: number | null }
interface Props { slug: string; matchId: string; scoringMode: "marcador" | "1x2"; home: string; away: string }
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

export function MatchPicks({ slug, matchId, scoringMode, home, away }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [revision, setRevision] = useState(0);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/casa/pollas/${encodeURIComponent(slug)}/match-picks?match=${matchId}&page=${page}`, { cache: "no-store", signal: controller.signal });
        const data = await readPicks(response);
        if (!controller.signal.aborted) { setRows(data.rows); setHasMore(data.hasMore); }
      } catch (cause) {
        if (controller.signal.aborted) return;
        // Parse or unexpected errors show a generic message, never their internals.
        setError(cause instanceof ResponseError ? { message: cause.message, retryable: cause.retryable } : { message: GENERIC_ERROR, retryable: true });
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [open, slug, matchId, page, revision]);

  return <div className="mt-4 border-t border-border-subtle pt-3">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="lp-btn lp-btn-ghost w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">
      <Eye size={18} className="shrink-0" aria-hidden />{open ? "Ocultar pronósticos de otros" : "Ver pronósticos de otros"}
    </button>
    {open && <div id={id} className="mt-3 text-[15px] leading-normal">
      <p className="mb-3 text-[13px] text-text-secondary">Participantes con pago aprobado. Marcadores en orden local – visitante.</p>
      {error ? <div role="alert"><p className="text-text-secondary">{error.message}</p>{error.retryable && <button type="button" className="lp-btn lp-btn-ghost mt-3" onClick={() => setRevision(value => value + 1)}>Reintentar</button>}</div>
        : loading ? <div role="status"><span className="sr-only">Cargando pronósticos</span><div className="h-28 animate-pulse rounded-md bg-bg-elevated" /></div>
          : rows.length === 0 ? <p className="rounded-md bg-bg-elevated p-3 text-text-secondary">Todavía no hay pronósticos de participantes con pago aprobado.</p>
            : <ul className="divide-y divide-border-subtle">{rows.map(row => <li key={row.id} className="flex flex-wrap items-center gap-2 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2"><UserAvatar avatarUrl={row.avatarUrl} displayName={row.displayName} size="sm" /><span className="min-w-0 [overflow-wrap:anywhere]">{row.displayName}{row.entryNumber != null && <span className="ml-1 whitespace-nowrap text-[13px] text-text-secondary">#{row.entryNumber}</span>}</span></div>
              <span className={`max-w-full text-right [overflow-wrap:anywhere] ${scoringMode === "marcador" ? "font-display text-[24px] tracking-[0.04em] tabular-nums" : "text-[15px] font-semibold"}`}>{scoringMode === "marcador" ? `${row.homeScore ?? "–"} – ${row.awayScore ?? "–"}` : row.pick1x2 === "L" ? home : row.pick1x2 === "V" ? away : row.pick1x2 === "E" ? "Empate" : "Sin pronóstico"}</span>
            </li>)}</ul>}
      {(page > 0 || hasMore) && !error && <div className="mt-3 flex flex-wrap justify-between gap-2">
        <button type="button" className="lp-btn lp-btn-ghost" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Anterior</button>
        <span className="self-center text-[13px] text-text-secondary">Página {page + 1}</span>
        <button type="button" className="lp-btn lp-btn-ghost" disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}>Siguiente</button>
      </div>}
    </div>}
  </div>;
}
