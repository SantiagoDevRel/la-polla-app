"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Goal, Info, ListChecks, RefreshCw, Ticket, Trophy, type LucideIcon } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import { formatCop } from "@/lib/casa/format";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import type { CasaEntryStatus, CasaLeaderboardRow, CasaPollaStatus, CasaProvisionalPrize } from "@/lib/casa/types";
import { INFO_EVENT, infoAnchorFromHash } from "@/lib/casa/info-sections";
import { VerMasInfo } from "./VerMasInfo";

interface Props {
  slug: string;
  firstLabel: string;
  children: ReactNode;
  info?: ReactNode;
  initialRows: CasaLeaderboardRow[];
  /**
   * Lo que se llevaría hoy cada participación que va arriba (migración 133).
   * Sale de SQL con el redondeo del reparto real; vacío cuando no aplica.
   */
  initialPrizes?: CasaProvisionalPrize[];
  /** Todos los partidos tienen resultado verificado y falta confirmar el reparto. */
  finished?: boolean;
  entryStatus: CasaEntryStatus | null;
  pollaStatus: CasaPollaStatus;
  drawPending?: boolean;
  userId: string;
  /**
   * El premio es un objeto que no se puede dividir, así que un empate en el
   * primer puesto lo gana quien se registró primero (migración 142). Cuando
   * aplica, la tabla muestra la fecha de registro de cada participación: es el
   * dato que decide, y tiene que poder verificarlo cualquiera, no solo la casa.
   * En las pollas de dinero el empate se reparte, así que ahí sería ruido.
   */
  tiebreakByRegistration?: boolean;
}

export function PollaTabs({ slug, firstLabel, children, info, initialRows, initialPrizes = [], finished = false, entryStatus, pollaStatus, userId, drawPending = false, tiebreakByRegistration = false }: Props) {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState(initialRows);
  const [prizes, setPrizes] = useState(initialPrizes);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const router = useRouter();
  // (2026-09-18) Ícono + palabra: el ícono hace que la barra se entienda de un
  // vistazo y la palabra evita adivinar. Solo el ícono escondería Info, que es
  // justo donde ahora vive toda la explicación.
  const firstIcon: LucideIcon = firstLabel === "Preguntas" ? ListChecks : firstLabel === "Sorteo" ? Ticket : Goal;
  const tabs: Array<{ label: string; icon: LucideIcon }> = [
    { label: firstLabel, icon: firstIcon },
    { label: "Tabla", icon: Trophy },
    ...(info ? [{ label: "Info", icon: Info }] : []),
  ];
  const infoIndex = info ? 2 : -1;
  const prizeByEntry = new Map(prizes.map((prize) => [prize.entry_id, prize.amount_cop]));

  // «Ver más» (components/casa/VerMasInfo.tsx) y los enlaces `#info-…`: cambian
  // a Info y despliegan esa regla. El panel está montado aunque esté oculto, así
  // que el <details> existe; se espera un cuadro para que ya sea visible al bajar.
  useEffect(() => {
    if (infoIndex < 0) return;
    const abrir = (anchor: string | null) => {
      if (!anchor) return;
      setTab(infoIndex);
      window.requestAnimationFrame(() => {
        const rule = document.getElementById(anchor);
        if (!(rule instanceof HTMLDetailsElement)) return;
        rule.open = true;
        rule.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
    };
    const onEvent = (event: Event) => abrir((event as CustomEvent<string>).detail ?? null);
    const onHash = () => abrir(infoAnchorFromHash(window.location.hash));
    onHash();
    window.addEventListener(INFO_EVENT, onEvent);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(INFO_EVENT, onEvent);
      window.removeEventListener("hashchange", onHash);
    };
  }, [infoIndex]);

  useEffect(() => { setRows(initialRows); }, [initialRows]);
  useEffect(() => { setPrizes(initialPrizes); }, [initialPrizes]);

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
        setPrizes(Array.isArray(data.prizes) ? data.prizes : []);
        setError(null);
        if (data.entryStatus !== entryStatus || data.pollaStatus !== pollaStatus || Boolean(data.drawPending) !== drawPending) router.refresh();
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
  }, [tab, slug, revision, entryStatus, pollaStatus, drawPending, router]);

  return (
    <section className="mt-5">
      <div role="tablist" aria-label="Contenido de la polla" className="flex gap-1 overflow-x-auto rounded-full border border-border-subtle bg-bg-card p-1">
        {tabs.map(({ label, icon: Icon }, index) => (
          <button
            key={label}
            ref={(element) => { buttons.current[index] = element; }}
            id={`${id}-tab-${index}`}
            role="tab"
            type="button"
            aria-selected={tab === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={tab === index ? 0 : -1}
            onClick={() => setTab(index)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              setTab(next);
              buttons.current[next]?.focus();
            }}
            className={`flex min-h-12 flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[15px] font-semibold leading-normal transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${tab === index ? "bg-bg-elevated text-text-primary" : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"}`}
          >
            <Icon aria-hidden="true" className={`h-[18px] w-[18px] max-w-none shrink-0 ${tab === index ? "text-gold" : ""}`} />
            {label}
          </button>
        ))}
      </div>

      <div id={`${id}-panel-0`} role="tabpanel" aria-labelledby={`${id}-tab-0`} hidden={tab !== 0} tabIndex={0}>
        {children}
      </div>
      <div id={`${id}-panel-1`} role="tabpanel" aria-labelledby={`${id}-tab-1`} hidden={tab !== 1} tabIndex={0} className="pt-5">
        {/* (2026-09-18) Aquí iba un párrafo de 21 palabras sobre pagos y cupos, y
            otro de 26-33 sobre el reparto. La tabla ya lo dice sola («Ganaría
            $X» bajo el nombre) y la regla completa está en Info: un toque. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="lp-display-sm max-w-full text-text-primary [overflow-wrap:anywhere]">Posiciones</h2>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
            {info && <VerMasInfo section="premio" className="max-w-full text-left [overflow-wrap:anywhere]">Cómo se gana</VerMasInfo>}
            <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label={loading ? "Actualizando tabla" : "Actualizar tabla"} title="Actualizar"
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-default disabled:opacity-50">
              <RefreshCw aria-hidden="true" className={`h-5 w-5 ${loading ? "motion-safe:animate-spin" : ""}`} />
            </button>
          </div>
        </div>
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
          <table className="w-full table-auto text-left">
            <caption className="sr-only">Tabla de posiciones: {rows.length} participantes con pago aprobado</caption>
            <thead className="text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="w-12 whitespace-nowrap pb-2 pr-3 font-medium"><span className="sr-only">Posición</span><span aria-hidden>Pos.</span></th>
                <th scope="col" className="whitespace-nowrap pb-2 pr-3 font-medium">Jugador</th>
                <th scope="col" className="w-16 whitespace-nowrap pb-2 pl-3 text-right font-medium"><span className="sr-only">Puntos</span><span aria-hidden>Pts.</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.entry_id} className={`border-t border-border-subtle transition-colors duration-200 hover:bg-bg-elevated ${row.user_id === userId ? "bg-turf/10" : "bg-bg-card"}`}>
                  <td className="lp-money px-2 py-3 align-top text-lg">{row.puesto}</td>
                  <th scope="row" className="py-3 pr-3 font-medium">
                    <div className="flex items-start gap-2">
                      <UserAvatar avatarUrl={row.avatar_url} displayName={row.display_name ?? "Jugador"} size="sm" />
                      <span className="min-w-0 self-center text-sm leading-normal [overflow-wrap:anywhere]">
                        {row.display_name ?? "Sin nombre"}{(row.user_entries ?? 1) > 1 && row.entry_number != null && <span className="ml-1 whitespace-nowrap text-xs leading-normal text-text-secondary" aria-label={`cupo ${row.entry_number}`}>#{row.entry_number}</span>}{row.user_id === userId && <span className="ml-1 text-xs leading-normal text-turf">(tú)</span>}
                        {/* Premio provisional (migración 133): oro porque es señal de premio, no adorno. */}
                        {prizeByEntry.has(row.entry_id) && (
                          <span className="mt-0.5 block text-xs font-semibold leading-normal text-gold">
                            {finished ? "Se lleva" : "Ganaría"} <span className="lp-money text-[14px]">{formatCop(prizeByEntry.get(row.entry_id)!)}</span>
                          </span>
                        )}
                        {/* El dato que desempata, a la vista de todos (migración 142). */}
                        {tiebreakByRegistration && row.registered_at && (
                          <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
                            Se registró el {formatColombiaDateTime(row.registered_at, {
                              day: "2-digit", month: "2-digit", year: "numeric",
                              hour: "numeric", minute: "2-digit",
                            })}
                          </span>
                        )}
                      </span>
                    </div>
                  </th>
                  <td className="lp-money py-3 pl-3 pr-2 text-right align-top text-lg">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {info && <div id={`${id}-panel-2`} role="tabpanel" aria-labelledby={`${id}-tab-2`} hidden={tab !== 2} tabIndex={0}>{info}</div>}
    </section>
  );
}
