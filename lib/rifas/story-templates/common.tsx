import type { CSSProperties, ReactNode } from "react";
import { formatCop } from "@/lib/casa/format";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { rifaNumber } from "../shared";
import { boardLayout } from "./layout";
import type { StoryProps } from "./types";
import fontMetrics from "./font-metrics.json";

export const STORY_W = 1080;
export const STORY_H = 1920;
export const GOLD = "#FFD700";
export const INK = "#080c10";
export const PAPER = "#F5F7FA";
export const BOARD_W = 920;
export const BOARD_H = 820;
export const display: CSSProperties = { fontFamily: "Bebas", fontWeight: 400, letterSpacing: 3, lineHeight: 1 };

/** next/og otherwise fetches emoji/Google fallback fonts for missing glyphs. */
export function localStoryText(text: string) {
  const punctuation: Record<string, string> = { "“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "...", "€": "EUR" };
  const metrics: Record<string, number> = fontMetrics.Outfit;
  return Array.from(text.normalize("NFC")).map((char) =>
    punctuation[char] ?? (/\s/.test(char) ? " " : metrics[char] > 0 ? char : "?")).join("");
}

/** Real local font advances, with a small safety margin; only oversized words split. */
export function fitLines(text: string, width: number, height: number, maxSize: number, family: "Bebas" | "Outfit", breakWords = true) {
  const normalized = localStoryText(text).replace(/\s+/g, " ").trim();
  const metrics: Record<string, number> = fontMetrics[family];
  for (let fontSize = maxSize; fontSize >= (breakWords ? 12 : 1); fontSize--) {
    const measure = (line: string) => Array.from(line).reduce((sum, char) =>
      sum + (metrics[char] ?? 1.1) * fontSize * 1.03 + (family === "Bebas" ? 1 : 0), 0);
    // Dates and lottery names shrink until every word fits intact.
    if (!breakWords && normalized.split(" ").some((word) => measure(word) > width)) continue;
    const lines: string[] = [];
    let line = "";
    for (const word of normalized.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        if (measure(line + char) > width && line) { lines.push(line); line = ""; }
        line += char;
      }
    }
    if (line) lines.push(line);
    if (lines.length * fontSize * 1.12 <= height) return { lines, fontSize };
  }
  throw new RangeError("Texto fuera del contrato de la historia.");
}

export function FittedText({ text, width, height, size, family = "Outfit", center = false, color, breakWords = true }: {
  text: string; width: number; height: number; size: number; family?: "Bebas" | "Outfit"; center?: boolean; color?: string; breakWords?: boolean;
}) {
  const fitted = fitLines(text, width, height, size, family, breakWords);
  return <div style={{ display: "flex", flexDirection: "column", width, height, justifyContent: "center",
    alignItems: center ? "center" : "flex-start", fontFamily: family, fontWeight: family === "Bebas" ? 400 : 600,
    fontSize: fitted.fontSize, lineHeight: 1.12, color, letterSpacing: family === "Bebas" ? 1 : 0 }}>
      {fitted.lines.map((line, i) => <span key={i} style={{ whiteSpace: "pre", flexShrink: 0 }}>{line}</span>)}
  </div>;
}

export interface Treatment {
  background: string; ink?: string; muted?: string; accent?: string;
  panel?: string; cell?: string; cellInk?: string; cellBorder?: string; radius?: number;
  title?: string; titleSize?: number; centered?: boolean; titleStyle?: CSSProperties;
  boardStyle?: CSSProperties; prizeStyle?: CSSProperties; footerStyle?: CSSProperties;
  /** Swap title/prize emphasis without changing the reserved board and footer regions. */
  prizeFirst?: boolean; backdrop?: ReactNode; ornament?: ReactNode;
}

export function StoryBoard({ r, theme }: { r: StoryProps["r"]; theme: Treatment }) {
  const layout = boardLayout(r.number_count, BOARD_W, BOARD_H);
  const taken = new Set(r.taken);
  let cursor = 0;
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    width: layout.width, height: layout.height, flexShrink: 0, gap: layout.gap }}>
    {layout.rowCounts.map((count, row) => {
      const start = cursor;
      cursor += count;
      return <div key={row} style={{ display: "flex", justifyContent: "center", gap: layout.gap }}>
        {Array.from({ length: count }, (_, col) => {
          const n = start + col;
          const occupied = taken.has(n);
          const winner = r.status === "resuelta" && r.winning_number === n;
          const small = Math.max(26, Math.floor(layout.fontSize * 0.67));
          const rounding = Math.min(theme.radius ?? 12, layout.cellSize / 2);
          return <div key={n} data-number={n} data-taken={occupied} data-winner={winner} style={{ display: "flex",
            alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0,
            width: layout.cellSize, height: layout.cellSize, borderRadius: theme.radius ?? 12,
            background: occupied ? "#E4F5EB" : (theme.cell ?? PAPER),
            border: winner ? `5px solid ${GOLD}` : `2px solid ${occupied ? "#127743" : (theme.cellBorder ?? "#CFD5DE")}` }}>
            <span style={{ ...display, fontSize: occupied ? small : layout.fontSize,
              color: occupied ? "#105C35" : (theme.cellInk ?? INK), letterSpacing: 1,
              ...(occupied ? { position: "absolute", top: Math.max(3, rounding * 0.22), left: Math.max(7, rounding * 0.48) } as const : {}) }}>{rifaNumber(n)}</span>
            {occupied && <svg width={layout.cellSize * 0.48} height={layout.cellSize * 0.48} viewBox="0 0 24 24"
              style={{ position: "absolute", right: 4, bottom: 3 }}>
              <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#127743" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>}
          </div>;
        })}
      </div>;
    })}
  </div>;
}

/** Shared information contract. Each theme owns its art, surfaces and headline composition. */
export function StoryFrame(props: StoryProps, theme: Treatment) {
  const { r, logo, pollito, appHost } = props;
  const ink = theme.ink ?? PAPER;
  const muted = theme.muted ?? "#BFC9D8";
  const center = theme.centered ?? false;
  const prize = r.prize_kind === "dinero" ? formatCop(r.prize_cop ?? 0) : (r.prize_text ?? "");
  const titleTop = theme.prizeFirst ? 380 : 160;
  const prizeTop = theme.prizeFirst ? 156 : 420;
  const board = boardLayout(r.number_count, BOARD_W, BOARD_H);
  const boardTop = 664 + (BOARD_H - board.height) / 2;
  return <div style={{ display: "flex", width: STORY_W, height: STORY_H, background: theme.background,
    color: ink, fontFamily: "Outfit", fontWeight: 600, position: "relative", overflow: "hidden" }}>
    {theme.backdrop}
    <div style={{ display: "flex", alignItems: "center", gap: 18, position: "absolute", left: 70, top: 60 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
      <img src={logo} width={70} height={70} alt="" />
      <span style={{ ...display, fontSize: 42 }}>LA POLLA</span>
    </div>
    {theme.ornament}
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 80, top: titleTop,
      width: 920, height: 244, alignItems: center ? "center" : "flex-start" }}>
      <span style={{ ...display, fontSize: theme.titleSize ?? 128, color: theme.accent ?? ink, ...theme.titleStyle }}>
        {theme.title ?? "RIFA"}
      </span>
      <FittedText text={r.name.toUpperCase()} width={pollito ? 700 : 920} height={110} size={56} family="Bebas" center={center} />
      {pollito && <img src={pollito} width={190} height={190} alt="" style={{ position: "absolute", right: 0, top: 10 }} /> /* eslint-disable-line @next/next/no-img-element */}
    </div>
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 80, top: prizeTop,
      width: 920, height: 202, padding: "16px 24px", borderRadius: 18, background: theme.panel ?? "#131B2B",
      alignItems: center ? "center" : "flex-start", ...theme.prizeStyle }}>
      <span style={{ fontSize: 24, letterSpacing: 3, color: theme.prizeStyle?.color ?? (theme.prizeStyle?.background ? "#BFC9D8" : muted) }}>PREMIO</span>
      <FittedText text={prize} width={872} height={136} size={r.prize_kind === "dinero" ? 100 : 44}
        family={r.prize_kind === "dinero" ? "Bebas" : "Outfit"} center={center}
        color={theme.prizeStyle?.color ?? GOLD} />
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "absolute",
      top: boardTop, left: (STORY_W - board.width - 40) / 2, width: board.width + 40, height: board.height + 40,
      borderRadius: 24, background: theme.panel ?? "#131B2B", ...theme.boardStyle }}>
      <StoryBoard r={r} theme={theme} />
    </div>
    <div style={{ display: "flex", position: "absolute", top: boardTop + board.height + 50, left: 80, width: 920, height: 52,
      alignItems: "center", justifyContent: "center" }}>
      {r.status === "resuelta" && r.winning_number !== null
        ? <span style={{ ...display, fontSize: 46, color: PAPER, background: INK, padding: "0 24px", borderRadius: 12 }}>GANADOR {rifaNumber(r.winning_number)}</span>
        : <span style={{ fontSize: 24, color: muted }}>Los números con chulo ya están tomados</span>}
    </div>
    <div style={{ display: "flex", position: "absolute", top: 1602, left: 60, width: 960, height: 164,
      background: theme.panel ?? "#131B2B", borderRadius: 18, padding: "16px 20px", gap: 24, ...theme.footerStyle }}>
      {[
        { label: "JUEGA EL", value: formatColombiaDateTime(r.draw_at, { day: "numeric", month: "long" }), sub: formatColombiaDateTime(r.draw_at, { hour: "numeric", minute: "2-digit" }) },
        { label: "LOTERÍA", value: r.lottery_name, sub: "" },
        { label: "VALOR", value: formatCop(r.price_cop), sub: "cada número" },
      ].map((item, i) => <div key={item.label} style={{ display: "flex", flexDirection: "column", width: i === 1 ? 352 : 260 }}>
        <span style={{ fontSize: 22, letterSpacing: 2, color: muted }}>{item.label}</span>
        <FittedText text={item.value.toUpperCase()} width={i === 1 ? 352 : 260} height={76} size={42} family="Bebas" breakWords={false} />
        {item.sub && <span style={{ fontSize: 23 }}>{item.sub}</span>}
      </div>)}
    </div>
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 60, top: 1790,
      width: 960, alignItems: "center", background: theme.panel ?? "#131B2B", borderRadius: 12, padding: "8px 0" }}>
      <span style={{ fontSize: 24 }}>Escoge tu número en</span>
      <FittedText text={`${appHost}/rifa/${r.slug}`} width={960} height={52} size={39} family="Bebas" center />
      <span style={{ fontSize: 19, color: muted, marginTop: 6 }}>La Polla organiza el tablero. El pago va directo a quien creó la rifa.</span>
    </div>
  </div>;
}
