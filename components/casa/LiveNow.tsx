"use client";

// components/casa/LiveNow.tsx — «En vivo»: lo que se está jugando en MIS pollas,
// arriba de todo en POLLAS, con mi marcador al lado del parcial.
//
// (2026-09-16) Pedido del dueño: «que aparezcan arriba en la zona de POLLAS
// para poder ir monitoreando cómo va y que diga tu marcador: x-x y también el
// marcador parcial para ir comparando». Se actualiza cada 30 s mientras la
// pestaña está visible (el vivo llega cada minuto) y desaparece sola cuando
// no hay nada en juego: sin estado vacío, sin ruido.

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamCrest } from "@/components/match/TeamCrest";
import { liveMinuteLabel, pickLabel, pickOnTrack } from "@/lib/casa/live-status";
import type { CasaLiveMatch } from "@/lib/casa/types";

const REFRESH_MS = 30_000;

export function LiveNow({ initialRows }: { initialRows: CasaLiveMatch[] }) {
  const [rows, setRows] = useState(initialRows);
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

  return (
    <section aria-labelledby="en-vivo-titulo" className="lp-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-default px-4 py-3">
        <span aria-hidden="true" className="relative inline-block h-2 w-2 shrink-0">
          <span className="absolute inset-0 rounded-full bg-red-alert opacity-60 motion-safe:animate-ping" />
          <span className="absolute inset-0 rounded-full bg-red-alert" />
        </span>
        <h2 id="en-vivo-titulo" className="font-display text-[22px] leading-tight tracking-wide text-text-primary">En vivo</h2>
        <span className="ml-auto text-[13px] tabular-nums text-text-secondary">
          {enJuego > 0 ? `${enJuego} en juego` : "Recién terminados"}
        </span>
      </div>
      <ul className="divide-y divide-border-subtle">
        {rows.map((row) => <LiveRow key={`${row.pollaId}:${row.matchId}`} row={row} />)}
      </ul>
    </section>
  );
}

function LiveRow({ row }: { row: CasaLiveMatch }) {
  const live = row.status === "live";
  const minute = live ? liveMinuteLabel({ scheduled_at: row.scheduledAt, elapsed: row.elapsed, live_status_detail: row.liveStatusDetail }) : "";
  const score = { home: row.homeScore, away: row.awayScore };
  const marcador = row.scoringMode === "marcador";
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Link href={`/casa/${row.pollaSlug}`} className="min-w-0 text-[13px] font-semibold text-text-secondary underline-offset-2 hover:text-text-primary hover:underline [overflow-wrap:anywhere]">
          {row.pollaName}
        </Link>
        {live ? (
          <span className="lp-label shrink-0 text-red-alert">Vivo{minute ? ` · ${minute}` : ""}</span>
        ) : (
          <span className="lp-label shrink-0">{row.finalVerifiedAt ? "Final" : "Terminó · verificando"}</span>
        )}
      </div>

      {/* Escudos y marcador en una sola fila; los nombres van debajo, en su
          propia fila, para que el texto ampliado no los aplaste (regla del repo). */}
      <div className="mt-2 flex items-center justify-center gap-3">
        <TeamCrest team={row.homeTeam} src={row.homeFlag} className="h-8 w-8" />
        <span className={`lp-money grid h-10 w-10 place-items-center text-[30px] [-webkit-text-size-adjust:none] ${live ? "text-gold" : "text-text-primary"}`}>{row.homeScore ?? "–"}</span>
        <span aria-hidden="true" className="h-[2px] w-4 shrink-0 bg-border-strong" />
        <span className={`lp-money grid h-10 w-10 place-items-center text-[30px] [-webkit-text-size-adjust:none] ${live ? "text-gold" : "text-text-primary"}`}>{row.awayScore ?? "–"}</span>
        <TeamCrest team={row.awayTeam} src={row.awayFlag} className="h-8 w-8" />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 text-center text-[12px] font-semibold leading-tight text-text-primary">
        <span className="min-w-0 [overflow-wrap:anywhere]">{row.homeTeam}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{row.awayTeam}</span>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
        <span>{marcador ? "Tu marcador:" : "Tu pronóstico:"}</span>
        {row.picks.length === 0 ? (
          <span className="text-text-muted">sin pronóstico</span>
        ) : row.picks.map((pick, index) => {
          const label = pickLabel(row.scoringMode, pick, row.homeTeam, row.awayTeam);
          const onTrack = pickOnTrack(row.scoringMode, pick, score);
          const several = row.picks.length > 1;
          return (
            <span key={pick.entryNumber ?? index} className={`font-semibold ${onTrack ? "text-turf" : onTrack === false ? "text-text-primary" : "text-text-muted"}`}>
              {several && pick.entryNumber != null ? `Cupo ${pick.entryNumber}: ` : ""}{label ?? "sin pronóstico"}
              {onTrack && <span className="sr-only"> (coincide con el marcador)</span>}
            </span>
          );
        })}
      </p>
    </li>
  );
}
