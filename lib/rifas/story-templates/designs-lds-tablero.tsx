// Tablero de Los Del Sur (2026-11-08, pedido del dueño): la plantilla principal
// de las rifas de la barra. Copia 1:1 del diseño aprobado para el canal de
// WhatsApp de LDS (titular justificado, las 100 boletas, la camiseta al lado,
// valor/rango/sorteo en pastillas y «Compra tu boleta en …» al pie), pero con
// los datos de la rifa y los números tomados tachados en vivo.
//
// Dos formatos: cuadrada 1080×1350 (WhatsApp y feed) y vertical 1080×1920
// (historia de Instagram): el mismo cuadrado, centrado, con 285 px de foto
// arriba y abajo, que es lo que tapa la interfaz de Instagram.
//
// Los resaltados en verde (valor, lotería, nombres de quienes firman) van en
// Outfit 700, como el diseño aprobado: la ruta carga assets/fonts/Outfit-Bold-latin.ttf.
import type { ReactNode } from "react";
import { formatCop } from "@/lib/casa/format";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { rifaNumber } from "../shared";
import { display, FittedText, GOLD, localStoryText, TAKEN_X } from "./common";
import type { StoryFormat } from "./catalog";
import type { StoryHeadlineLine, StoryProps } from "./types";
import fontMetrics from "./font-metrics.json";

const GREEN = "#1E9A44";
const GREEN_LIGHT = "#5BE08A";
const NIGHT = "#06140C";
const WHITE = "#F5F7FA";
const LIFT = "0 2px 4px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.75)";

export const TABLERO_SIZE: Record<StoryFormat, { width: number; height: number }> = {
  cuadrada: { width: 1080, height: 1350 },
  vertical: { width: 1080, height: 1920 },
};
/** En la vertical, el cuadrado baja 285 px: (1920 − 1350) / 2. */
const VERTICAL_OFFSET = 285;

const SHADE: Record<StoryFormat, string> = {
  cuadrada: "linear-gradient(180deg, rgba(3,10,6,0.8) 0%, rgba(3,10,6,0.6) 28%, rgba(3,10,6,0.62) 60%, rgba(3,10,6,0.9) 100%)",
  // El relleno de arriba y abajo va más oscuro, igual que el diseño aprobado.
  vertical: "linear-gradient(180deg, rgba(3,10,6,0.86) 0%, rgba(3,10,6,0.8) 15%, rgba(3,10,6,0.6) 30%, rgba(3,10,6,0.62) 60%, rgba(3,10,6,0.9) 85%, rgba(3,10,6,0.95) 100%)",
};

const TITLE_LEFT = 56;
const TITLE_TOP = 196;
/** Cada línea del titular ocupa este ancho (justificado). */
const TITLE_W = 600;
const TITLE_SPACING = 2;
const TITLE_GAP = 8;
const TITLE_MAX_SIZE = 130;
const CELL = 52;
const CELL_GAP = 4;
const BOARD_PAD = 18;
const BOARD_BORDER = 3;
const CHIPS_TOP = 1154;
/** Ancho máximo de la fila de pastillas (termina a 24 px del borde). */
const CHIPS_W = 1000;
/** Texto de las pastillas, como el diseño aprobado. Baja solo si no caben. */
const CHIP_SIZE = 30;
const FOOTER_TOP = 1254;

const metrics = fontMetrics as Record<"Bebas" | "Outfit", Record<string, number>>;

/** Ancho en px de un texto a 1 px de tamaño (más el espaciado entre letras). */
function advance(text: string, family: "Bebas" | "Outfit", spacing = 0, size = 1) {
  return Array.from(text).reduce((sum, char) => sum + (metrics[family][char] ?? 0.6) * size + spacing, 0);
}

/** Tamaños del titular: cada línea llena TITLE_W y el bloque deja sitio al tablero. */
export function headlineSizes(lines: readonly string[], maxHeight: number) {
  const sizes = lines.map((line) => Math.min(TITLE_MAX_SIZE,
    (TITLE_W - TITLE_SPACING * Array.from(line).length) / advance(line, "Bebas")));
  const height = (list: number[]) => list.reduce((sum, size) => sum + size * 0.9, 0) + TITLE_GAP * (list.length - 1);
  const scale = Math.min(1, (maxHeight - TITLE_GAP * (lines.length - 1)) / (height(sizes) - TITLE_GAP * (lines.length - 1)));
  const fitted = sizes.map((size) => Math.floor(size * scale * 10) / 10);
  return { sizes: fitted, height: height(fitted) };
}

/** Sin titular configurado: «RIFA SUREÑA» y el nombre en una o dos líneas. */
function fallbackHeadline(name: string): StoryHeadlineLine[] {
  const words = localStoryText(name).toUpperCase().replace(/\s+/g, " ").trim().split(" ");
  if (words.join(" ").length <= 16 || words.length < 2) return [{ text: "RIFA SUREÑA" }, { text: words.join(" "), accent: true }];
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (diff < Math.abs(words.slice(0, best).join(" ").length - words.slice(best).join(" ").length)) best = i;
  }
  return [{ text: "RIFA SUREÑA" }, { text: words.slice(0, best).join(" "), accent: true }, { text: words.slice(best).join(" ") }];
}

type Segment = { text: string; accent?: boolean };

/**
 * «Camiseta firmada por Franco Armani y René Higuita» → tres líneas con los
 * nombres en verde, como el diseño aprobado. Otro texto cae al ajuste genérico.
 */
export function prizeCaption(text: string): Segment[][] | null {
  const clean = localStoryText(text).replace(/\s+/g, " ").trim();
  const match = /^(.*?\bpor)\s+(.+)$/i.exec(clean);
  if (!match) return null;
  const who = match[2];
  const split = who.lastIndexOf(" y ");
  if (split <= 0) return [[{ text: match[1] }], [{ text: who, accent: true }]];
  return [[{ text: match[1] }], [{ text: who.slice(0, split), accent: true }, { text: " y" }],
    [{ text: who.slice(split + 3), accent: true }]];
}

/** «Vie 13 nov»: día de la semana, día y mes cortos, hora de Colombia. */
export function drawDayLabel(drawAt: string) {
  const part = (options: Intl.DateTimeFormatOptions) => formatColombiaDateTime(drawAt, options).replace(/\./g, "").trim();
  const weekday = part({ weekday: "short" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${part({ day: "numeric" })} ${part({ month: "short" })}`;
}

function Line({ segments, center = true }: { segments: Segment[]; center?: boolean }) {
  return <div style={{ display: "flex", justifyContent: center ? "center" : "flex-start" }}>
    {segments.map((s, i) => <span key={i} style={{ whiteSpace: "pre", color: s.accent ? GREEN_LIGHT : WHITE,
      fontWeight: s.accent ? 700 : 600 }}>{s.text}</span>)}
  </div>;
}

function Chip({ children, size }: { children: ReactNode; size: number }) {
  return <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "rgba(4,16,9,0.84)",
    border: `2px solid ${GREEN}`, borderRadius: 999, padding: `${Math.round(12 * size / CHIP_SIZE)}px ${Math.round(26 * size / CHIP_SIZE)}px`,
    fontSize: size, lineHeight: 1.25 }}>{children}</div>;
}

function Board({ r }: { r: StoryProps["r"] }) {
  const columns = Math.min(10, r.number_count);
  const rows = Math.ceil(r.number_count / columns);
  const taken = new Set(r.taken);
  return <div style={{ display: "flex", flexDirection: "column", gap: CELL_GAP, padding: BOARD_PAD,
    background: "rgba(4,16,9,0.72)", border: `${BOARD_BORDER}px solid ${GREEN}`, borderRadius: 18 }}>
    {Array.from({ length: rows }, (_, row) => <div key={row} style={{ display: "flex", gap: CELL_GAP }}>
      {Array.from({ length: Math.min(columns, r.number_count - row * columns) }, (_, col) => {
        const n = row * columns + col;
        const occupied = taken.has(n);
        const winner = r.status === "resuelta" && r.winning_number === n;
        return <div key={n} data-number={n} data-taken={occupied} data-winner={winner} style={{ display: "flex",
          alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0, width: CELL, height: CELL,
          paddingTop: 3, borderRadius: 8, background: WHITE, border: winner ? `4px solid ${GOLD}` : `2px solid ${GREEN}` }}>
          <span style={{ fontFamily: "Bebas", fontSize: 30, lineHeight: 1, color: NIGHT,
            opacity: occupied && !winner ? 0.55 : 1 }}>{rifaNumber(n)}</span>
          {occupied && !winner && <svg width={CELL * 0.78} height={CELL * 0.78} viewBox="0 0 24 24"
            style={{ position: "absolute", left: CELL * 0.11 - 2, top: CELL * 0.11 - 2 }}>
            <path d="M5 4.6 L19.2 19.4 M19.4 4.4 L4.8 19.2" fill="none" stroke={TAKEN_X} strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>}
        </div>;
      })}
    </div>)}
  </div>;
}

export function tablero(props: StoryProps) {
  const { r, appHost, logo, pollito, partner } = props;
  const format: StoryFormat = props.format ?? "vertical";
  const { width, height } = TABLERO_SIZE[format];
  const oy = format === "vertical" ? VERTICAL_OFFSET : 0;

  const columns = Math.min(10, r.number_count);
  const rows = Math.ceil(r.number_count / columns);
  const boardH = rows * CELL + (rows - 1) * CELL_GAP + 2 * (BOARD_PAD + BOARD_BORDER);
  // El titular empuja el tablero; los dos juntos nunca tocan las pastillas.
  const headline = props.headline?.length ? props.headline : fallbackHeadline(r.name);
  const title = headlineSizes(headline.map((l) => localStoryText(l.text)), CHIPS_TOP - 24 - boardH - 24 - TITLE_TOP);
  const boardTop = Math.round(TITLE_TOP + title.height + 24);

  const prize = r.prize_kind === "dinero" ? formatCop(r.prize_cop ?? 0) : (r.prize_text ?? "");
  const caption = r.prize_kind === "texto" ? prizeCaption(prize) : null;
  const captionSize = caption ? Math.min(25, ...caption.map((line) => 340 / advance(line.map((s) => s.text).join(""), "Outfit"))) : 0;

  // Pastillas: valor, rango y sorteo en una sola fila; se achican si la lotería tiene un nombre largo.
  const range = r.status === "resuelta" && r.winning_number !== null ? null : `${rifaNumber(0)} al ${rifaNumber(r.number_count - 1)}`;
  const lottery = localStoryText(r.lottery_name);
  const chips = [`${formatCop(r.price_cop)} la boleta`, range ?? `Ganador ${rifaNumber(r.winning_number ?? 0)}`,
    `${drawDayLabel(r.draw_at)} · ${lottery}`];
  const chipsWidth = (size: number) => chips.reduce((sum, text) =>
    // Las métricas de 600 ya sobrestiman el render ≈2,5 %: cubren el 700 de los resaltados.
    sum + advance(text, "Outfit", 0, size) + 2 * Math.round(26 * size / CHIP_SIZE) + 4, 0) + 14 * (chips.length - 1);
  let chipSize = CHIP_SIZE;
  while (chipSize > 18 && chipsWidth(chipSize) > CHIPS_W) chipSize--;

  const hostSize = Math.min(32, (1080 - 96 - 150) / advance(`Compra tu boleta en ${appHost}`, "Outfit") / 1.03);

  return <div style={{ display: "flex", width, height, position: "relative", overflow: "hidden", background: NIGHT,
    color: WHITE, fontFamily: "Outfit", fontWeight: 600 }}>
    {partner?.background && <img src={partner.background} width={width} height={height} alt="" /* eslint-disable-line @next/next/no-img-element */
      style={{ position: "absolute", top: 0, left: 0 }} />}
    <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width, height, backgroundImage: SHADE[format] }} />

    {partner && <div style={{ display: "flex", alignItems: "center", gap: 22, position: "absolute", left: 56, top: oy + 48 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
      <img src={partner.escudo} width={128} height={128} alt="" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ ...display, fontSize: 76, letterSpacing: 2, lineHeight: 0.92, textShadow: LIFT }}>LOS DEL SUR</span>
        <span style={{ fontSize: 22, letterSpacing: 4, color: GREEN_LIGHT, marginTop: 4, textShadow: LIFT }}>LÍDERES DEL BARRISMO SOCIAL</span>
      </div>
    </div>}
    {pollito && <img src={pollito} width={250} height={250} alt="" /* eslint-disable-line @next/next/no-img-element */
      style={{ position: "absolute", left: width - 34 - 250, top: oy + 150 }} />}

    <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: TITLE_LEFT, top: oy + TITLE_TOP, gap: TITLE_GAP }}>
      {headline.map((line, i) => <span key={i} style={{ ...display, fontSize: title.sizes[i], letterSpacing: TITLE_SPACING,
        lineHeight: 0.9, whiteSpace: "pre", color: line.accent ? GREEN_LIGHT : WHITE, textShadow: LIFT }}>{localStoryText(line.text)}</span>)}
    </div>

    <div style={{ display: "flex", position: "absolute", left: 56, top: oy + boardTop }}><Board r={r} /></div>

    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "absolute", left: 700,
      top: oy + boardTop + 6, width: 340 }}>
      {props.prizeImage && <div style={{ display: "flex", position: "relative", width: 300, height: 386 }}>
        {/* Sombra suave bajo la camiseta (satori no tiene drop-shadow). */}
        <div style={{ display: "flex", position: "absolute", left: -10, top: 30, width: 320, height: 380,
          backgroundImage: "radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))" }} />
        {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
        <img src={props.prizeImage} width={300} height={386} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
      </div>}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 340, marginTop: 15, lineHeight: 1.25, textShadow: LIFT }}>
        {caption && captionSize >= 18
          ? caption.map((line, i) => <div key={i} style={{ display: "flex", fontSize: captionSize }}><Line segments={line} /></div>)
          : <FittedText text={prize} width={340} height={r.prize_kind === "dinero" ? 90 : 140} size={r.prize_kind === "dinero" ? 72 : 25}
              family={r.prize_kind === "dinero" ? "Bebas" : "Outfit"} center color={r.prize_kind === "dinero" ? GREEN_LIGHT : WHITE} shadow={LIFT} />}
      </div>
    </div>

    <div style={{ display: "flex", gap: 14, position: "absolute", left: 56, top: oy + CHIPS_TOP }}>
      <Chip size={chipSize}><span style={{ color: GREEN_LIGHT, fontWeight: 700 }}>{formatCop(r.price_cop)}</span><span style={{ whiteSpace: "pre" }}> la boleta</span></Chip>
      <Chip size={chipSize}>{range
        ? <span>{range}</span>
        : <span style={{ color: GOLD }}>{chips[1]}</span>}</Chip>
      <Chip size={chipSize}><span style={{ whiteSpace: "pre" }}>{`${drawDayLabel(r.draw_at)} · `}</span><span style={{ color: GREEN_LIGHT, fontWeight: 700 }}>{lottery}</span></Chip>
    </div>

    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "absolute", left: 0,
      top: oy + FOOTER_TOP, width: 1080, height: 96, padding: "0 48px", background: "rgba(3,10,6,0.9)",
      borderTop: `3px solid ${GREEN}` }}>
      <div style={{ display: "flex", fontSize: hostSize }}>
        <span style={{ whiteSpace: "pre" }}>Compra tu boleta en </span><span style={{ color: GREEN_LIGHT }}>{appHost}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, color: "#AEB7C7" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
        <img src={logo} width={56} height={56} alt="" />
        <span>La Polla</span>
      </div>
    </div>
  </div>;
}
