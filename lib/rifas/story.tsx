// lib/rifas/story.tsx — la imagen para historia de una rifa (1080×1920).
//
// JSX puro para next/og (satori): recibe los datos que entrega SQL
// (rifa_story_data_v1: estados, nunca personas) y las imágenes ya cargadas.
// Vive aparte de la ruta para poder renderizarlo en pruebas sin servidor.
// Satori exige display:flex en todo div con varios hijos y no decodifica WebP.
import { formatCop } from "@/lib/casa/format";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { rifaNumber, type StoryClub, type StoryTemplate } from "@/lib/rifas/shared";

export interface StoryData {
  slug: string; name: string; prize_kind: "dinero" | "texto"; prize_cop: number | null; prize_text: string | null;
  number_count: number; price_cop: number; lottery_name: string; draw_at: string; status: string;
  winning_number: number | null; taken: number[];
}

export const STORY_W = 1080;
export const STORY_H = 1920;
const W = STORY_W;
const H = STORY_H;
const INK = "#080c10";
const GOLD = "#FFD700";
const TURF = "#1FD87F";
const TURF_DIM = "#0d8a4e";
const PAPER = "#F5F7FA";

export function storyElement({ r, template, club, appHost, logo, pollito }: {
  r: StoryData; template: StoryTemplate; club: StoryClub; appHost: string;
  /** data: URI PNG del logo y, en la plantilla club, del pollito. */
  logo: string; pollito: string | null;
}) {
  const taken = new Set(r.taken);
  const rows = Math.ceil(r.number_count / 10);
  const cell = 80;
  const gap = 8;
  const isClub = template === "club";
  const bg = isClub ? club.primary : INK;
  const ink = isClub ? club.ink : PAPER;
  const accent = isClub ? club.secondary : GOLD;
  const prize = r.prize_kind === "dinero" ? formatCop(r.prize_cop ?? 0) : (r.prize_text ?? "");
  const day = formatColombiaDateTime(r.draw_at, { day: "numeric", month: "long" });
  const hour = formatColombiaDateTime(r.draw_at, { hour: "numeric", minute: "2-digit" });

  const board = Array.from({ length: rows }, (_, row) => (
    <div key={row} style={{ display: "flex", gap }}>
      {Array.from({ length: 10 }, (_, col) => {
        const n = row * 10 + col;
        if (n >= r.number_count) return <div key={n} style={{ width: cell, height: cell, display: "flex" }} />;
        const isTaken = taken.has(n);
        const winner = r.winning_number === n;
        return (
          <div key={n} style={{
            width: cell, height: cell, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", background: isTaken ? TURF_DIM : PAPER,
            border: winner ? `6px solid ${GOLD}` : `3px solid ${isTaken ? TURF : "rgba(8,12,16,0.12)"}`,
          }}>
            <span style={{ fontFamily: "Bebas", fontSize: isTaken ? 26 : 42, color: isTaken ? "rgba(245,247,250,0.75)" : INK,
              letterSpacing: 2, ...(isTaken ? { position: "absolute" as const, top: 6, left: 10 } : {}) }}>{rifaNumber(n)}</span>
            {isTaken && (
              <svg width="46" height="46" viewBox="0 0 24 24" style={{ marginTop: 14, marginLeft: 12 }}>
                <path d="M4 12.5l5 5L20 6.5" fill="none" stroke={PAPER} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  ));

  return (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: bg, color: ink, fontFamily: "Outfit", position: "relative" }}>
        {/* Franjas de camiseta (club) o brillo de marca (neutra). */}
        {isClub ? (
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} style={{ flex: 1, background: i % 2 === 0 ? club.primary : club.secondary, opacity: i % 2 === 0 ? 1 : 0.18 }} />
            ))}
          </div>
        ) : (
          <div style={{ position: "absolute", top: -300, left: -200, width: 900, height: 900, borderRadius: 900,
            background: "radial-gradient(circle, rgba(255,215,0,0.20) 0%, rgba(255,215,0,0) 70%)", display: "flex" }} />
        )}

        <div style={{ display: "flex", flexDirection: "column", padding: "48px 60px 0", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- next/og no usa next/image */}
            <img src={logo} width={72} height={72} alt="" style={{ borderRadius: 36 }} />
            <span style={{ fontFamily: "Bebas", fontSize: 44, letterSpacing: 4, color: ink }}>LA POLLA</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: pollito ? 640 : 960 }}>
              <span style={{ fontFamily: "Bebas", fontSize: 116, lineHeight: 0.9, letterSpacing: 6, color: accent === "#FFFFFF" ? ink : accent }}>RIFA</span>
              <span style={{ fontFamily: "Bebas", fontSize: 62, lineHeight: 1, letterSpacing: 3, marginTop: 8, color: ink }}>{r.name.toUpperCase()}</span>
            </div>
            {pollito && (
              // eslint-disable-next-line @next/next/no-img-element -- next/og no usa next/image
              <img src={pollito} width={230} height={230} alt="" />
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 20, padding: "16px 24px", borderRadius: 24,
            background: isClub ? "rgba(8,12,16,0.72)" : "rgba(245,247,250,0.08)", border: `2px solid ${isClub ? "rgba(245,247,250,0.25)" : "rgba(255,215,0,0.35)"}` }}>
            <span style={{ fontSize: 26, color: "rgba(245,247,250,0.72)", letterSpacing: 3 }}>SE RIFA</span>
            <span style={{ fontFamily: r.prize_kind === "dinero" ? "Bebas" : "Outfit", fontSize: r.prize_kind === "dinero" ? 84 : 42,
              lineHeight: 1.05, color: r.prize_kind === "dinero" ? GOLD : PAPER, letterSpacing: r.prize_kind === "dinero" ? 3 : 0 }}>{prize}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap, margin: "28px auto 0", padding: 20, borderRadius: 32,
          background: "rgba(8,12,16,0.82)", position: "relative" }}>
          {board}
        </div>

        {r.status === "resuelta" && r.winning_number !== null && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20, position: "relative" }}>
            <span style={{ fontFamily: "Bebas", fontSize: 64, color: GOLD, letterSpacing: 3, background: "rgba(8,12,16,0.82)", padding: "6px 30px", borderRadius: 20 }}>
              GANADOR {rifaNumber(r.winning_number)}
            </span>
          </div>
        )}

        <div style={{ display: "flex", margin: "auto 60px 0", gap: 16, position: "relative" }}>
          {[
            { label: "JUEGA EL", value: day.toUpperCase(), sub: hour },
            { label: "LOTERÍA", value: r.lottery_name.toUpperCase(), sub: "" },
            { label: "VALOR", value: formatCop(r.price_cop), sub: "cada número" },
          ].map((b) => (
            <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 22px", borderRadius: 24, background: "rgba(8,12,16,0.82)" }}>
              <span style={{ fontSize: 24, letterSpacing: 3, color: "rgba(245,247,250,0.7)" }}>{b.label}</span>
              <span style={{ fontFamily: "Bebas", fontSize: 50, lineHeight: 1.05, color: PAPER, letterSpacing: 2 }}>{b.value}</span>
              {b.sub ? <span style={{ fontSize: 24, color: "rgba(245,247,250,0.7)" }}>{b.sub}</span> : null}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 60px 48px", position: "relative" }}>
          <span style={{ fontSize: 28, color: ink }}>Escoge tu número en</span>
          <span style={{ fontFamily: "Bebas", fontSize: 46, letterSpacing: 1, color: isClub ? ink : GOLD }}>{`${appHost}/rifa/${r.slug}`}</span>
          <span style={{ fontSize: 20, marginTop: 8, color: "rgba(245,247,250,0.6)", textAlign: "center",
            background: isClub ? "rgba(8,12,16,0.6)" : "transparent", padding: isClub ? "4px 14px" : 0, borderRadius: 12 }}>
            La Polla organiza el tablero. El pago va directo a quien creó la rifa.
          </span>
        </div>
      </div>
  );
}
