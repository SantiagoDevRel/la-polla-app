"use client";

// components/casa/LiveNow.tsx — «En vivo»: lo que se está jugando en MIS pollas,
// arriba de todo en POLLAS, con mi marcador al lado del parcial.
//
// (2026-09-16) Pedido del dueño: verlos arriba para ir comparando «Tu
// marcador» con el parcial. (2026-09-17) Ajustes pedidos:
//   · carrusel horizontal con el título «En vivo»: se desliza de lado, la
//     página no se alarga;
//   · cada tarjeta abre la ficha del partido (goles, estadísticas,
//     alineaciones);
//   · la sección se puede plegar (abierta por defecto);
//   · un partido cuya hora ya pasó sin que lleguen datos se muestra como
//     «Esperando datos», no con guiones sueltos.
// Se actualiza cada 30 s mientras la pestaña está visible (el vivo llega cada
// minuto) y desaparece sola cuando no hay nada que mostrar.

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { TeamCrest } from "@/components/match/TeamCrest";
import { liveMinuteLabel, pickLabel, pickOnTrack } from "@/lib/casa/live-status";
import type { CasaLiveMatch } from "@/lib/casa/types";

const REFRESH_MS = 30_000;

export function LiveNow({ initialRows }: { initialRows: CasaLiveMatch[] }) {
  const [rows, setRows] = useState(initialRows);
  const [open, setOpen] = useState(true);
  const id = useId();
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    async function refresh() {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/casa/en-vivo", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (active && Array.isArray(data.rows)) setRows(data.rows);
      } catch {
        // Sin red: se conserva lo último que se vio.
      }
    }
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (rows.length === 0) return null;
  const enJuego = rows.filter((row) => row.status === "live").length;
  const esperando = rows.filter((row) => row.status === "waiting").length;
  const resumen = enJuego > 0 ? `${enJuego} en juego` : esperando > 0 ? "Esperando datos" : "Recién terminados";
  const single = rows.length === 1;

  return (
    <section aria-labelledby={`${id}-titulo`} data-live-now className="px-4 pt-4">
      <h2 id={`${id}-titulo`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-lista`}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <span aria-hidden="true" className="relative inline-block h-2 w-2 shrink-0">
            {enJuego > 0 && <span className="absolute inset-0 rounded-full bg-red-alert opacity-60 motion-safe:animate-ping" />}
            <span className={`absolute inset-0 rounded-full ${enJuego > 0 ? "bg-red-alert" : "bg-text-muted"}`} />
          </span>
          <span className="min-w-0 font-display text-[22px] leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]">En vivo de tus pollas</span>
          <span className="ml-auto shrink-0 text-[13px] tabular-nums text-text-secondary">{resumen}</span>
          <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      {open && (
        // Se desliza de lado dentro de la franja; la página no gana scroll horizontal.
        <ul
          id={`${id}-lista`}
          aria-label="Partidos en vivo de tus pollas"
          className="lp-hscroll -mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2"
        >
          {rows.map((row) => (
            <li key={`${row.pollaId}:${row.matchId}`} className={`${single ? "w-full" : "w-[82%] max-w-[320px]"} shrink-0 snap-start`}>
              <LiveCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveCard({ row }: { row: CasaLiveMatch }) {
  const live = row.status === "live";
  const waiting = row.status === "waiting";
  const minute = live ? liveMinuteLabel({ scheduled_at: row.scheduledAt, elapsed: row.elapsed, live_status_detail: row.liveStatusDetail }) : "";
  const score = { home: row.homeScore, away: row.awayScore };
  const marcador = row.scoringMode === "marcador";
  const cell = (value: number | null) => (
    <span className="lp-money grid h-11 w-11 shrink-0 place-items-center text-[34px] leading-none text-text-primary [-webkit-text-size-adjust:none]">
      {waiting ? "–" : value ?? "–"}
    </span>
  );
  return (
    <Link
      href={`/futbol/partidos/${row.matchId}`}
      className="lp-card flex h-full flex-col gap-2 p-3 transition-colors duration-200 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {/* Con el texto del sistema al 200 % la etiqueta no cabe al lado del
          nombre: envuelve a la línea siguiente en vez de aplastarlo a 0 px. */}
      <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span title={row.pollaName} className="min-w-[4em] flex-1 truncate text-[12px] font-semibold leading-snug text-text-secondary">{row.pollaName}</span>
        {live ? (
          <span className="lp-label min-w-0 !text-red-alert [overflow-wrap:anywhere]">Vivo{minute ? ` · ${minute}` : ""}</span>
        ) : waiting ? (
          <span className="lp-label min-w-0 !text-amber [overflow-wrap:anywhere]">Esperando datos</span>
        ) : (
          <span className="lp-label min-w-0 [overflow-wrap:anywhere]">{row.finalVerifiedAt ? "Final" : "Terminó"}</span>
        )}
      </span>

      {/* Escudos y marcador en una sola fila; nombres debajo, sin recorte. */}
      <span className="mt-1 flex items-center justify-center gap-2.5">
        <TeamCrest team={row.homeTeam} src={row.homeFlag} className="h-11 w-11" />
        {cell(row.homeScore)}
        <span aria-hidden="true" className="h-[2px] w-3 shrink-0 bg-border-strong" />
        {cell(row.awayScore)}
        <TeamCrest team={row.awayTeam} src={row.awayFlag} className="h-11 w-11" />
      </span>
      <span className="grid grid-cols-2 gap-x-3 text-center text-[13px] font-semibold leading-tight text-text-primary">
        <span className="min-w-0 [overflow-wrap:anywhere]">{row.homeTeam}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{row.awayTeam}</span>
      </span>
      {/* (2026-09-19, segunda tanda de «menos texto») Se fueron el párrafo de
          espera (la etiqueta «Esperando datos» ya lo dice), la caja de «Tu
          marcador:» y «Ver partido» (toda la tarjeta es el enlace). Queda lo que
          responde «¿voy ganando?»: una línea fina con «Tú 2-1», como MatchCard.
          No se pasó a UNA sola fila: a 320 px con texto ampliado aplasta los
          nombres (medido en PicksBoard). */}
      <span className="mt-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[13px] text-text-secondary">
        <span>Tú<span className="sr-only">{marcador ? " (tu marcador)" : " (tu pronóstico)"}</span></span>
        {row.picks.length === 0 ? (
          <span className="text-text-muted">sin pronóstico</span>
        ) : row.picks.map((pick, index) => {
          const label = pickLabel(row.scoringMode, pick, row.homeTeam, row.awayTeam);
          const onTrack = waiting ? null : pickOnTrack(row.scoringMode, pick, score);
          return (
            <span key={pick.entryNumber ?? index} className={`font-semibold ${onTrack ? "text-turf" : onTrack === false ? "text-text-primary" : "text-text-muted"}`}>
              {row.picks.length > 1 && pick.entryNumber != null ? `Cupo ${pick.entryNumber}: ` : ""}{label ?? "sin pronóstico"}
              {onTrack && <span className="sr-only"> (coincide con el marcador)</span>}
            </span>
          );
        })}
      </span>
    </Link>
  );
}
