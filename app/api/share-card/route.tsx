// app/api/share-card/route.tsx — WhatsApp-ready share-card generator
//
// Returns a 1080x1920 PNG (vertical status format) for a given share
// moment. Three templates land here for v1: subiste (rank up),
// clavada (perfect pick), rival (rank down callout). Follow-up PRs can
// add podio / semana / matchday / último using the same scaffolding.
//
// Edge runtime: keeps the response fast and light. Fonts fall back to
// system defaults for MVP — the Tribuna Caliente display feel is
// approximated with letter-spacing + uppercase. Pollito WebPs are
// fetched from the same origin as absolute URLs (satori supports this).

import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";
import { pickCopy, type ShareMoment } from "@/lib/share-card/copy";

export const runtime = "edge";

const VALID_MOMENTS: readonly ShareMoment[] = [
  "subiste",
  "clavada",
  "rival",
];

function isValidMoment(v: string): v is ShareMoment {
  return (VALID_MOMENTS as readonly string[]).includes(v);
}

function pollitoUrl(origin: string, type: string | null, variant: string): string {
  const t = type && /^[a-z_]+$/.test(type) ? type : "goleador";
  return `${origin}/pollitos/pollito_${t}_${variant}.webp`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const typeParam = url.searchParams.get("type") || "";
  if (!isValidMoment(typeParam)) {
    return new Response("Invalid share type", { status: 400 });
  }

  const name = url.searchParams.get("name") || "Jugador";
  const polla = url.searchParams.get("polla") || "Tu polla";
  const pollito = url.searchParams.get("pollito");
  const rank = Number(url.searchParams.get("rank") || 1);
  const scoreHome = Number(url.searchParams.get("home") || 0);
  const scoreAway = Number(url.searchParams.get("away") || 0);
  const homeTeam = url.searchParams.get("homeTeam") || "Local";
  const awayTeam = url.searchParams.get("awayTeam") || "Visitante";
  const rivalName = url.searchParams.get("rival") || "Rival";
  const rivalPollito = url.searchParams.get("rivalPollito");
  const gap = Number(url.searchParams.get("gap") || 0);

  const seed = `${typeParam}:${polla}:${name}:${rank}:${scoreHome}:${scoreAway}`;
  const quote = pickCopy(typeParam, seed);

  const body =
    typeParam === "subiste"
      ? renderSubiste({ name, polla, rank, pollito, origin, quote })
      : typeParam === "clavada"
        ? renderClavada({ name, polla, homeTeam, awayTeam, scoreHome, scoreAway, pollito, origin, quote })
        : renderRival({ name, polla, rivalName, rivalPollito, pollito, gap, origin, quote });

  return new ImageResponse(body, {
    width: 1080,
    height: 1920,
  });
}

// ── Shared primitives ────────────────────────────────────────────────

const WORDMARK = "LA POLLA";
// Satori only parses `backgroundImage` as an image expression. Including
// a trailing hex colour in `background:` crashes the renderer with
// "Invalid background image". Split into color + image.
const BG_COLOR = "#080c10";
const BG_IMAGE =
  "radial-gradient(80% 50% at 50% -10%, rgba(255,215,0,0.22), transparent 60%), radial-gradient(70% 40% at 100% 70%, rgba(31,216,127,0.10), transparent 70%)";

function Wordmark() {
  return (
    <div
      style={{
        fontSize: 44,
        letterSpacing: 22,
        color: "#FFD700",
        fontWeight: 900,
        textTransform: "uppercase",
        textShadow: "0 0 40px rgba(255,215,0,0.35)",
      }}
    >
      {WORDMARK}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        backgroundColor: BG_COLOR,
        backgroundImage: BG_IMAGE,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "120px 80px",
        color: "#F5F7FA",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function Quote({ text }: { text: string }) {
  // Single-string child avoids satori's "multi-child div must be flex"
  // rule. Keeping the unicode curly quotes by concatenation.
  const quoted = `“${text}”`;
  return (
    <div
      style={{
        display: "flex",
        fontSize: 56,
        color: "#AEB7C7",
        fontStyle: "italic",
        textAlign: "center",
        maxWidth: 900,
        lineHeight: 1.2,
      }}
    >
      {quoted}
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Wordmark />
      <div style={{ fontSize: 26, color: "#6B7689", letterSpacing: 6, textTransform: "uppercase" }}>
        La polla deportiva de tus amigos
      </div>
    </div>
  );
}

// ── Templates ────────────────────────────────────────────────────────

function renderSubiste(args: {
  name: string;
  polla: string;
  rank: number;
  pollito: string | null;
  origin: string;
  quote: string;
}) {
  const { name, polla, rank, pollito, origin, quote } = args;
  return (
    <Frame>
      <div style={{ fontSize: 30, letterSpacing: 10, color: "#AEB7C7", textTransform: "uppercase" }}>
        {name}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
        <div style={{ fontSize: 44, color: "#AEB7C7", letterSpacing: 8, textTransform: "uppercase" }}>
          Subí a
        </div>
        <div
          style={{
            fontSize: 420,
            color: "#FFD700",
            fontWeight: 900,
            lineHeight: 1,
            textShadow: "0 0 80px rgba(255,215,0,0.4)",
            display: "flex",
          }}
        >
          #{rank}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 48,
            color: "#F5F7FA",
            letterSpacing: 4,
            textAlign: "center",
            maxWidth: 900,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {`En ${polla}`}
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pollitoUrl(origin, pollito, "lider")}
        alt=""
        width={320}
        height={320}
        style={{ objectFit: "contain" }}
      />

      <Quote text={quote} />
      <Footer />
    </Frame>
  );
}

function renderClavada(args: {
  name: string;
  polla: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  pollito: string | null;
  origin: string;
  quote: string;
}) {
  const { name, polla, homeTeam, awayTeam, scoreHome, scoreAway, pollito, origin, quote } = args;
  return (
    <Frame>
      <div style={{ fontSize: 30, letterSpacing: 10, color: "#AEB7C7", textTransform: "uppercase" }}>
        {name}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
        <div
          style={{
            fontSize: 64,
            color: "#1FD87F",
            letterSpacing: 12,
            textTransform: "uppercase",
            fontWeight: 900,
            textShadow: "0 0 40px rgba(31,216,127,0.4)",
          }}
        >
          Clavada
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 40,
          }}
        >
          <div style={{ fontSize: 60, color: "#F5F7FA", letterSpacing: 4, textTransform: "uppercase", maxWidth: 300, textAlign: "right" }}>
            {homeTeam}
          </div>
          <div
            style={{
              fontSize: 220,
              color: "#FFD700",
              fontWeight: 900,
              lineHeight: 1,
              display: "flex",
              gap: 20,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {scoreHome}-{scoreAway}
          </div>
          <div style={{ fontSize: 60, color: "#F5F7FA", letterSpacing: 4, textTransform: "uppercase", maxWidth: 300 }}>
            {awayTeam}
          </div>
        </div>
        <div
          style={{
            fontSize: 40,
            color: "#AEB7C7",
            letterSpacing: 4,
            textAlign: "center",
            maxWidth: 900,
            textTransform: "uppercase",
          }}
        >
          {polla}
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pollitoUrl(origin, pollito, "lider")}
        alt=""
        width={320}
        height={320}
        style={{ objectFit: "contain" }}
      />

      <Quote text={quote} />
      <Footer />
    </Frame>
  );
}

function renderRival(args: {
  name: string;
  polla: string;
  rivalName: string;
  rivalPollito: string | null;
  pollito: string | null;
  gap: number;
  origin: string;
  quote: string;
}) {
  const { name, polla, rivalName, rivalPollito, pollito, gap, origin, quote } = args;
  return (
    <Frame>
      <div
        style={{
          display: "flex",
          fontSize: 44,
          letterSpacing: 10,
          color: "#FFD700",
          textTransform: "uppercase",
          fontWeight: 900,
        }}
      >
        {`Duelo en ${polla}`}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          gap: 30,
        }}
      >
        {/* left — user */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pollitoUrl(origin, pollito, "peleando")}
            alt=""
            width={280}
            height={280}
            style={{ objectFit: "contain" }}
          />
          <div style={{ fontSize: 48, color: "#F5F7FA", marginTop: 20, textTransform: "uppercase", letterSpacing: 4, fontWeight: 800 }}>
            {name}
          </div>
        </div>

        {/* vs divider */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 48, color: "#AEB7C7", letterSpacing: 6 }}>VS</div>
          <div
            style={{
              display: "flex",
              fontSize: 120,
              color: "#FFD700",
              fontWeight: 900,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {gap >= 0 ? `+${gap}` : `${gap}`}
          </div>
          <div style={{ fontSize: 28, color: "#6B7689", letterSpacing: 4, textTransform: "uppercase" }}>
            puntos
          </div>
        </div>

        {/* right — rival */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pollitoUrl(origin, rivalPollito, "peleando")}
            alt=""
            width={280}
            height={280}
            style={{ objectFit: "contain" }}
          />
          <div style={{ fontSize: 48, color: "#F5F7FA", marginTop: 20, textTransform: "uppercase", letterSpacing: 4, fontWeight: 800 }}>
            {rivalName}
          </div>
        </div>
      </div>

      <Quote text={quote} />
      <Footer />
    </Frame>
  );
}
