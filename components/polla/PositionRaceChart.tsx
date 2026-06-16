"use client";

/**
 * PositionRaceChart — "bump chart" / carrera de posiciones.
 *
 * Muestra cómo fluctúa la POSICIÓN (rank) de cada participante a lo largo
 * del torneo. Idea original de Pipe (primo, 2026-06-16): "grafiquito
 * animado con la fluctuación de las posiciones por cada fecha".
 *
 * EJE = DÍA (decisión Santiago 2026-06-16): una columna por DÍA calendario
 * que tuvo partidos verificados, con el ranking acumulado al cierre de ese
 * día. NO por partido ni por semana (por ahora). El RPC real agruparía por
 * `date(matches.final_verified_at)`.
 *
 * Data: con la prop `racers` (del endpoint /standings-history → RPC
 * get_polla_standings_history) muestra data real. Sin props cae a la `DEMO`
 * (badge "Demo") para previews.
 *
 * Diseño anti-espagueti (10 líneas en una pantalla angosta):
 *  - El chart dibuja solo el TOP N (10). Las demás líneas en gris tenue.
 *  - SOLO la línea "enfocada" (por defecto = tú) se ilumina en gold.
 *  - Debajo, una lista scrollable con TODOS: tocás a cualquiera (aunque
 *    esté fuera del top N) y se traza su línea (carril overflow si aplica).
 *
 * Sin librerías de charts: SVG puro + framer-motion (path draw). Respeta
 * prefers-reduced-motion. Tokens del design system Tribuna Caliente.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RotateCcw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getPollitoByPosition } from "@/lib/pollitos";

export interface RaceRacer {
  id: string;
  name: string;
  isMe?: boolean;
  /** Tipo de pollito (= `users.avatar_url`). Se usa para la ilustración
   *  al final de cada línea (último día). */
  avatarType?: string | null;
  /** Puntos ACUMULADOS al cierre de cada día, en orden. Una entrada por
   *  día verificado. La posición se computa acá (no se confía en un rank
   *  pre-guardado). */
  cumPoints: number[];
}

interface Props {
  /** Etiqueta de cada fecha/jornada (ej. "F1", "Grupos 2", "Octavos"). */
  fechaLabels?: string[];
  /** Data real cuando exista. Si falta, usa la demo. */
  racers?: RaceRacer[];
  /** Tope de líneas a mostrar. En pollas grandes solo el top N. */
  topN?: number;
}

// ─── Data de muestra (DRAFT) ───────────────────────────────────────────
// Eje por DÍA: cada columna es un día con partidos verificados (no todos
// los días del calendario juegan). Labels d/m del Mundial 2026.
const DEMO_FECHAS = ["11/6", "13/6", "15/6", "17/6", "19/6", "21/6", "24/6", "27/6"];
// Incrementos por día (se acumulan abajo). Diseñados para que haya cruces
// de posición vistosos: Manu arranca último y escala, Lady arranca fuerte
// y se diluye, vos (Santiago) hacés el arco clásico de remontada.
const DEMO_INCS: { id: string; name: string; isMe?: boolean; type: string; incs: number[] }[] = [
  { id: "u_pipe", name: "Pipe", type: "pibe", incs: [7, 5, 1, 6, 2, 5, 4, 3] },
  { id: "u_santi", name: "Santiago", isMe: true, type: "goleador", incs: [5, 6, 7, 2, 8, 6, 7, 5] },
  { id: "u_andres", name: "Andrés", type: "arquero", incs: [6, 3, 5, 7, 4, 5, 2, 6] },
  { id: "u_lady", name: "Lady", type: "capitan", incs: [8, 5, 4, 3, 2, 4, 3, 2] },
  { id: "u_fede", name: "Fede", type: "tigre", incs: [3, 5, 6, 5, 6, 3, 5, 4] },
  { id: "u_cami", name: "Cami", type: "gambeteador", incs: [5, 4, 5, 6, 5, 5, 4, 5] },
  { id: "u_juan", name: "Juancho", type: "rolo", incs: [4, 6, 3, 4, 6, 2, 5, 3] },
  { id: "u_vale", name: "Vale", type: "costeno", incs: [6, 4, 5, 3, 4, 6, 3, 5] },
  { id: "u_manu", name: "Manu", type: "paisa", incs: [2, 4, 6, 5, 3, 5, 6, 7] },
  { id: "u_dani", name: "Dani", type: "rasta", incs: [5, 4, 3, 5, 4, 3, 4, 6] },
];
const DEMO: RaceRacer[] = DEMO_INCS.map((r) => {
  let acc = 0;
  return { id: r.id, name: r.name, isMe: r.isMe, avatarType: r.type, cumPoints: r.incs.map((v) => (acc += v)) };
});

// ─── Geometría ─────────────────────────────────────────────────────────
const ROW_H = 30; // alto por posición
const MIN_COL_W = 64; // ancho mínimo por día. Con pocos días las columnas se
                      // estiran para llenar el ancho; con muchos caen acá y
                      // el chart excede la pantalla → scroll horizontal.
const PAD_T = 14; // padding arriba del plot
const PAD_B = 26; // espacio para el carril overflow (N+) + labels de día
const GUTTER = 22; // columna izquierda con números de posición
const NODE_X0 = GUTTER + 12; // x del primer día
const RIGHT = 44; // margen derecho para los pollitos finales
const AV_R = 13; // radio del pollito final

/** rank de competencia estándar (empates comparten rank) por fecha. */
function ranksForFecha(racers: RaceRacer[], f: number): Map<string, number> {
  const rows = racers
    .map((r) => ({ id: r.id, pts: r.cumPoints[f] ?? -1 }))
    .sort((a, b) => b.pts - a.pts);
  const out = new Map<string, number>();
  let lastPts = Number.POSITIVE_INFINITY;
  let lastRank = 0;
  rows.forEach((row, i) => {
    const rank = row.pts === lastPts ? lastRank : i + 1;
    out.set(row.id, rank);
    lastPts = row.pts;
    lastRank = rank;
  });
  return out;
}

export default function PositionRaceChart({ fechaLabels, racers, topN = 10 }: Props) {
  const reduce = useReducedMotion();

  const isDemo = !(racers && racers.length > 0);
  const allRacers = isDemo ? DEMO : racers!;
  const fechas = fechaLabels ?? (isDemo ? DEMO_FECHAS : allRacers[0]?.cumPoints.map((_, i) => `D${i + 1}`));
  const F = fechas.length;

  // rank de cada racer en cada fecha
  const rankByFecha = useMemo(
    () => Array.from({ length: F }, (_, f) => ranksForFecha(allRacers, f)),
    [allRacers, F]
  );

  // Orden final (por la última fecha) y recorte top N
  const ordered = useMemo(() => {
    const lastRanks = rankByFecha[F - 1];
    return [...allRacers].sort((a, b) => (lastRanks.get(a.id) ?? 99) - (lastRanks.get(b.id) ?? 99));
  }, [allRacers, rankByFecha, F]);

  const meId = allRacers.find((r) => r.isMe)?.id;
  // Top N por posición final — pero NUNCA sacar al usuario del gráfico
  // (refinamiento codex 2026-06-16: si te desaparezco, se mata el gancho
  // emocional). Si vos no entrás al top N, reemplazás al último slot.
  const shown = useMemo(() => {
    const top = ordered.slice(0, topN);
    if (meId && !top.some((r) => r.id === meId)) {
      const me = ordered.find((r) => r.id === meId);
      if (me) top[top.length - 1] = me;
    }
    return top;
  }, [ordered, topN, meId]);
  const shownIds = new Set(shown.map((r) => r.id));
  const N = shown.length;
  const meOutsideTop = !!meId && ordered.findIndex((r) => r.id === meId) >= topN;

  // Lista de TODOS (no solo top N) para la tira tap-to-focus de abajo:
  // puesto de hoy + movimiento (primer día → hoy) + puntos.
  const listRows = useMemo(() => {
    const cur = rankByFecha[F - 1];
    const start = rankByFecha[0];
    return allRacers
      .map((r) => ({
        racer: r,
        rank: cur?.get(r.id) ?? allRacers.length,
        move: (start?.get(r.id) ?? allRacers.length) - (cur?.get(r.id) ?? allRacers.length),
        pts: r.cumPoints[F - 1] ?? 0,
      }))
      .sort((a, b) => a.rank - b.rank);
  }, [allRacers, rankByFecha, F]);

  // Enfocado por defecto: vos (siempre estás en `shown`), si no, el #1.
  const [focusId, setFocusId] = useState<string>(
    meId && shownIds.has(meId) ? meId : shown[0]?.id
  );
  const [replay, setReplay] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Ancho responsivo por día: medimos el contenedor y estiramos las columnas
  // para llenar el ancho cuando hay pocos días (no cramped); con muchos cae
  // a MIN_COL_W y el chart excede la pantalla → scroll horizontal.
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const COL_W = Math.max(
    MIN_COL_W,
    containerW > 0
      ? Math.floor((containerW - NODE_X0 - RIGHT) / Math.max(F - 1, 1))
      : MIN_COL_W,
  );

  // Al montar / cambiar la data / re-medir, scrollear al día MÁS RECIENTE
  // (derecha) — es lo que más le importa al user; scroll izquierda = historia.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [F, allRacers.length, COL_W]);

  const width = NODE_X0 + (F - 1) * COL_W + RIGHT;
  const height = PAD_T + N * ROW_H + PAD_B;

  const xFor = (f: number) => NODE_X0 + f * COL_W;
  const yFor = (rank: number) => PAD_T + (rank - 0.5) * ROW_H;
  // Carril de overflow: un rank > N (alguien fuera del top, o un top-N que
  // ese día estuvo abajo) se clampa a una banda al fondo del chart. Así
  // podés enfocar a cualquiera de la lista sin reventar la altura.
  const OVERFLOW_Y = PAD_T + N * ROW_H + 8;
  const yLine = (rank: number) => (rank <= N ? yFor(rank) : OVERFLOW_Y);

  const pathFor = (r: RaceRacer) =>
    rankByFecha
      .map((rk, f) => `${f === 0 ? "M" : "L"} ${xFor(f)} ${yLine(rk.get(r.id) ?? N)}`)
      .join(" ");

  // Enfocado puede ser CUALQUIERA (incluido alguien fuera del top N, via la
  // lista de abajo) — no solo los `shown`.
  const focusRacer = allRacers.find((r) => r.id === focusId) ?? shown[0];
  const avatarRacers =
    focusRacer && !shownIds.has(focusRacer.id) ? [...shown, focusRacer] : shown;
  const focusUsesOverflow =
    !!focusRacer && rankByFecha.some((rk) => (rk.get(focusRacer.id) ?? N) > N);

  // Un pollito por puesto final: si varios empatan caen en el mismo `y` y
  // se montarían. Mostramos uno por puesto, con prioridad enfocado > yo >
  // primero. El roster completo igual está en la lista de abajo.
  const avatarPicks = (() => {
    const lastRanks = rankByFecha[F - 1];
    const byRank = new Map<number, RaceRacer>();
    const score = (x: RaceRacer) => (x.id === focusId ? 2 : x.isMe ? 1 : 0);
    for (const r of avatarRacers) {
      const rank = lastRanks.get(r.id) ?? N;
      const cur = byRank.get(rank);
      if (!cur || score(r) > score(cur)) byRank.set(rank, r);
    }
    return Array.from(byRank.values());
  })();
  const startRank = focusRacer ? rankByFecha[0].get(focusRacer.id) ?? N : N;
  const endRank = focusRacer ? rankByFecha[F - 1].get(focusRacer.id) ?? N : N;
  const delta = startRank - endRank; // + = subió de posición
  const endPts = focusRacer ? focusRacer.cumPoints[F - 1] ?? 0 : 0;

  return (
    <div className="rounded-2xl lp-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-display text-[18px] tracking-[0.04em] text-text-primary uppercase">
            Carrera de posiciones
          </h3>
          {isDemo && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-amber bg-amber/10 border border-amber/25 rounded-full px-1.5 py-0.5 shrink-0">
              Demo
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setReplay((n) => n + 1)}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors shrink-0"
          aria-label="Reproducir animación"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Repetir
        </button>
      </div>

      {/* Chart */}
      <div ref={scrollRef} className="lp-hscroll overflow-x-auto -mx-1 px-1">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          style={{ minWidth: width }}
        >
          {/* Sin filtro SVG glow: en gama media cuesta más de lo que
              aporta (codex). El "halo" de la línea enfocada se logra con
              un underlay translúcido más ancho (barato, sin blur). */}

          {/* Gridlines de posición + números en el gutter */}
          {Array.from({ length: N }, (_, i) => {
            const rank = i + 1;
            const y = yFor(rank);
            return (
              <g key={`row-${rank}`}>
                <line
                  x1={NODE_X0}
                  y1={y}
                  x2={width - RIGHT + 8}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth={1}
                />
                <text
                  x={GUTTER - 4}
                  y={y + 3.5}
                  textAnchor="end"
                  className="tabular-nums"
                  style={{ fontFeatureSettings: '"tnum"' }}
                  fontSize={10}
                  fill={rank <= 3 ? "rgba(255,215,0,0.55)" : "rgba(168,175,188,0.55)"}
                >
                  {rank}
                </text>
              </g>
            );
          })}

          {/* Carril de overflow (N+) — solo cuando el enfocado cae fuera
              del top N en algún día. Línea punteada + label "10+". */}
          {focusUsesOverflow && (
            <>
              <line
                x1={NODE_X0}
                y1={OVERFLOW_Y}
                x2={width - RIGHT + 8}
                y2={OVERFLOW_Y}
                stroke="rgba(255,255,255,0.05)"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
              <text
                x={GUTTER - 4}
                y={OVERFLOW_Y + 3}
                textAnchor="end"
                fontSize={8}
                fill="rgba(168,175,188,0.5)"
              >
                {topN}+
              </text>
            </>
          )}

          {/* Labels de fecha (abajo) */}
          {fechas.map((lbl, f) => (
            <text
              key={`f-${f}`}
              x={xFor(f)}
              y={height - 7}
              textAnchor="middle"
              fontSize={9}
              fill="rgba(168,175,188,0.6)"
            >
              {lbl}
            </text>
          ))}

          {/* Líneas atenuadas (todas menos la enfocada) */}
          {shown
            .filter((r) => r.id !== focusId)
            .map((r) => (
              <g key={`dim-${r.id}`}>
                {/* hit area invisible y ancha para tocar fácil */}
                <path
                  d={pathFor(r)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ cursor: "pointer" }}
                  onClick={() => setFocusId(r.id)}
                />
                <path
                  d={pathFor(r)}
                  fill="none"
                  stroke={r.isMe ? "rgba(31,216,127,0.5)" : "rgba(174,183,199,0.16)"}
                  strokeWidth={r.isMe ? 2 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}

          {/* Línea enfocada en gold, con draw animado. Underlay ancho
              translúcido = halo barato (sin filtro blur). */}
          {focusRacer && (
            <>
              <path
                d={pathFor(focusRacer)}
                fill="none"
                stroke="rgba(255,215,0,0.18)"
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <motion.path
                key={`focus-${focusId}-${replay}`}
                d={pathFor(focusRacer)}
                fill="none"
                stroke="var(--gold)"
                strokeWidth={2.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
              />
            </>
          )}

          {/* Nodos de la línea enfocada */}
          {focusRacer &&
            rankByFecha.map((rk, f) => (
              <motion.circle
                key={`node-${f}-${replay}`}
                cx={xFor(f)}
                cy={yLine(rk.get(focusRacer.id) ?? N)}
                r={3}
                fill="var(--gold)"
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: reduce ? 0 : 0.18 + f * 0.09, duration: 0.2 }}
              />
            ))}

          {/* Pollito de cada racer en su posición FINAL (último día).
              lider/peleando/triste según el puesto de hoy. Incluye al
              enfocado aunque esté fuera del top N (en el carril overflow). */}
          {avatarPicks.map((r) => {
            const finalRank = rankByFecha[F - 1].get(r.id) ?? N;
            const y = yLine(finalRank);
            const x = width - RIGHT + 20;
            const isFocus = r.id === focusId;
            const strong = isFocus || r.isMe;
            const ring = isFocus ? "var(--gold)" : r.isMe ? "var(--turf)" : "rgba(255,255,255,0.18)";
            const src = getPollitoByPosition(r.avatarType, finalRank, allRacers.length);
            return (
              <g key={`av-${r.id}`} style={{ cursor: "pointer" }} onClick={() => setFocusId(r.id)}>
                <clipPath id={`clip-${r.id}`}>
                  <circle cx={x} cy={y} r={AV_R} />
                </clipPath>
                <circle cx={x} cy={y} r={AV_R + 1} fill="var(--bg-elevated)" opacity={strong ? 1 : 0.85} />
                <image
                  href={src}
                  x={x - AV_R}
                  y={y - AV_R}
                  width={AV_R * 2}
                  height={AV_R * 2}
                  clipPath={`url(#clip-${r.id})`}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={strong ? 1 : 0.72}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={AV_R}
                  fill="none"
                  stroke={ring}
                  strokeWidth={strong ? 2 : 1}
                  opacity={strong ? 1 : 0.7}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Caption: historia del enfocado */}
      {focusRacer && (
        <div className="mt-2 flex items-center gap-2 px-1">
          <span className="text-sm font-semibold text-gold truncate">
            {focusRacer.name}
            {focusRacer.isMe && <span className="ml-1 text-xs text-turf">(tú)</span>}
          </span>
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            {delta > 0 ? (
              <TrendingUp className="w-3.5 h-3.5 text-turf" />
            ) : delta < 0 ? (
              <TrendingDown className="w-3.5 h-3.5 text-red-alert" />
            ) : (
              <Minus className="w-3.5 h-3.5 text-text-muted" />
            )}
            <span className="tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
              #{startRank} → #{endRank}
              {delta !== 0 && (
                <span className={delta > 0 ? "text-turf" : "text-red-alert"}>
                  {" "}({delta > 0 ? "+" : ""}
                  {delta})
                </span>
              )}
              {" · "}
              <span className="text-text-primary font-semibold">{endPts} pts</span>
            </span>
          </span>
          {meOutsideTop && focusRacer?.isMe && (
            <span className="text-[10px] text-amber bg-amber/10 border border-amber/25 rounded-full px-1.5 py-0.5 shrink-0">
              Fuera del top {topN}
            </span>
          )}
        </div>
      )}

      <p className="mt-1.5 px-1 text-[11px] text-text-muted leading-snug">
        Eje por día · solo días verificados · el chart muestra el top {topN}. Toca a cualquiera para seguir su línea.
      </p>

      {/* Lista de TODOS (no solo top N) — tap para enfocar su línea, aunque
          esté fuera del top N (cae al carril overflow del chart). */}
      {listRows.length > 1 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <p className="px-1 mb-1 text-[10px] uppercase tracking-wide text-text-muted">
            Todos · toca para seguir
          </p>
          {/* Sin scroll anidado: la lista fluye en la página (un solo scroll,
              sin scrollbar interno feo). Pedido de Santiago 2026-06-16. */}
          <div className="-mx-1 px-1 space-y-0.5">
            {listRows.map(({ racer: r, rank, move, pts }) => {
              const isFocus = r.id === focusId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setFocusId(r.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left border ${
                    isFocus
                      ? "bg-gold/10 border-gold/30"
                      : "border-transparent hover:bg-bg-elevated"
                  }`}
                >
                  <span
                    className="score-font text-[13px] w-5 text-center tabular-nums text-text-muted shrink-0"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {rank}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getPollitoByPosition(r.avatarType, rank, allRacers.length)}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover shrink-0"
                  />
                  <span
                    className={`flex-1 min-w-0 truncate text-sm ${
                      isFocus
                        ? "text-gold font-semibold"
                        : r.isMe
                        ? "text-turf font-medium"
                        : "text-text-primary"
                    }`}
                  >
                    {r.name}
                    {r.isMe && <span className="ml-1 text-[10px] text-turf">(tú)</span>}
                  </span>
                  <span
                    className="flex items-center gap-0.5 text-[11px] tabular-nums shrink-0 w-8 justify-end"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {move > 0 ? (
                      <TrendingUp className="w-3 h-3 text-turf" />
                    ) : move < 0 ? (
                      <TrendingDown className="w-3 h-3 text-red-alert" />
                    ) : (
                      <Minus className="w-3 h-3 text-text-muted" />
                    )}
                    {move !== 0 && (
                      <span className={move > 0 ? "text-turf" : "text-red-alert"}>
                        {Math.abs(move)}
                      </span>
                    )}
                  </span>
                  <span
                    className="score-font text-[14px] w-9 text-right tabular-nums text-text-primary shrink-0"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {pts}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
