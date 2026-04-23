// app/design/matches/page.tsx — Internal preview of six match-view design
// directions. Each variant renders the SAME three sample matches below it
// (upcoming / live / finished) so visual comparison is apples-to-apples.
// Not linked from the app; open /design/matches directly to browse.
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trophy, Lock, Clock, ChevronDown } from "lucide-react";

// ─── Sample data ──────────────────────────────────────────────────────

type SampleMatch = {
  id: string;
  homeTeam: string;
  homeCode: string;
  homeCrest: string;
  homeColor: string; // used by variant 5 (team color accents)
  awayTeam: string;
  awayCode: string;
  awayCrest: string;
  awayColor: string;
  phase: string;
  date: Date;
  status: "live" | "scheduled" | "finished" | "locked";
  homeScore?: number;
  awayScore?: number;
  elapsed?: number;
  userPrediction?: { home: number; away: number };
  pointsEarned?: number;
};

const NOW = Date.now();

const MATCHES: SampleMatch[] = [
  {
    id: "m1",
    homeTeam: "FC Barcelona",
    homeCode: "BAR",
    homeCrest: "https://crests.football-data.org/81.png",
    homeColor: "#a50044",
    awayTeam: "RC Celta de Vigo",
    awayCode: "CEL",
    awayCrest: "https://crests.football-data.org/558.png",
    awayColor: "#8fc7eb",
    phase: "Jornada 33",
    date: new Date(NOW + 5 * 60 * 60 * 1000),
    status: "scheduled",
    userPrediction: { home: 2, away: 1 },
  },
  {
    id: "m1b",
    homeTeam: "Rayo Vallecano",
    homeCode: "RAY",
    homeCrest: "https://crests.football-data.org/87.png",
    homeColor: "#e53935",
    awayTeam: "RCD Espanyol",
    awayCode: "ESP",
    awayCrest: "https://crests.football-data.org/80.png",
    awayColor: "#005bac",
    phase: "Jornada 33",
    date: new Date(NOW + 26 * 60 * 60 * 1000),
    status: "scheduled",
  },
  {
    id: "m1c",
    homeTeam: "Real Oviedo",
    homeCode: "OVI",
    homeCrest: "https://crests.football-data.org/1048.png",
    homeColor: "#002f87",
    awayTeam: "Villarreal CF",
    awayCode: "VIL",
    awayCrest: "https://crests.football-data.org/94.png",
    awayColor: "#ffde17",
    phase: "Jornada 33",
    date: new Date(NOW + 28 * 60 * 60 * 1000),
    status: "scheduled",
  },
  {
    id: "m2",
    homeTeam: "Real Madrid",
    homeCode: "RMA",
    homeCrest: "https://crests.football-data.org/86.png",
    homeColor: "#fcbf49",
    awayTeam: "Atlético de Madrid",
    awayCode: "ATM",
    awayCrest: "https://crests.football-data.org/78.png",
    awayColor: "#c8102e",
    phase: "Jornada 33",
    date: new Date(NOW - 30 * 60 * 1000),
    status: "live",
    homeScore: 1,
    awayScore: 0,
    elapsed: 34,
    userPrediction: { home: 2, away: 0 },
  },
  {
    id: "m3",
    homeTeam: "Sevilla FC",
    homeCode: "SEV",
    homeCrest: "https://crests.football-data.org/559.png",
    homeColor: "#d71920",
    awayTeam: "Villarreal CF",
    awayCode: "VIL",
    awayCrest: "https://crests.football-data.org/94.png",
    awayColor: "#ffde17",
    phase: "Jornada 32",
    date: new Date(NOW - 24 * 60 * 60 * 1000),
    status: "finished",
    homeScore: 2,
    awayScore: 1,
    userPrediction: { home: 2, away: 1 },
    pointsEarned: 5,
  },
];

function formatKickoff(d: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

// Shared crest renderer
function Crest({ src, code, size = 56 }: { src: string; code: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center bg-bg-elevated rounded-full overflow-hidden border border-border-subtle"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={code}
        width={size - 8}
        height={size - 8}
        style={{ objectFit: "contain" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

// ─── Variant 1 — Scoreboard cards ────────────────────────────────────
function VariantScoreboard({ m }: { m: SampleMatch }) {
  return (
    <div className="lp-card p-4">
      <div className="flex items-center justify-between mb-3 text-[10px] uppercase tracking-[0.1em] text-text-primary/70">
        <span>{m.phase}</span>
        <span>{formatKickoff(m.date)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2">
          <Crest src={m.homeCrest} code={m.homeCode} size={64} />
          <span className="text-[12px] text-center text-text-primary line-clamp-1">{m.homeTeam}</span>
        </div>
        {m.status === "live" || m.status === "finished" ? (
          <div className="flex items-center gap-2 font-display text-[44px] text-gold leading-none" style={{ fontFeatureSettings: '"tnum"' }}>
            <span>{m.homeScore}</span>
            <span className="text-text-primary/30">-</span>
            <span>{m.awayScore}</span>
          </div>
        ) : (
          <div className="text-center">
            <div className="font-display text-[32px] text-gold leading-none">VS</div>
            {m.userPrediction ? (
              <div className="text-[10px] text-text-primary/60 mt-1">
                Tu: {m.userPrediction.home}-{m.userPrediction.away}
              </div>
            ) : null}
          </div>
        )}
        <div className="flex flex-col items-center gap-2">
          <Crest src={m.awayCrest} code={m.awayCode} size={64} />
          <span className="text-[12px] text-center text-text-primary line-clamp-1">{m.awayTeam}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Variant 2 — Status-driven sections ──────────────────────────────
function VariantStatusRow({ m }: { m: SampleMatch }) {
  const accent =
    m.status === "live"
      ? "border-red-alert/40"
      : m.status === "finished"
        ? "border-border-subtle opacity-80"
        : "border-gold/25";
  return (
    <div className={`lp-card p-3 flex items-center gap-3 border ${accent}`}>
      <Crest src={m.homeCrest} code={m.homeCode} size={36} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-text-primary">
          {m.homeCode} <span className="text-text-primary/40">vs</span> {m.awayCode}
        </div>
        <div className="text-[10px] text-text-primary/60">
          {m.status === "live"
            ? `${m.elapsed}'`
            : m.status === "finished"
              ? "Terminado"
              : formatKickoff(m.date)}
        </div>
      </div>
      <Crest src={m.awayCrest} code={m.awayCode} size={36} />
      {m.status === "live" || m.status === "finished" ? (
        <div className="font-display text-[22px] text-gold leading-none" style={{ fontFeatureSettings: '"tnum"' }}>
          {m.homeScore}-{m.awayScore}
        </div>
      ) : (
        <button className="px-3 py-1 rounded-full bg-gold text-bg-base text-[11px] font-bold">Pronosticá</button>
      )}
    </div>
  );
}

function VariantStatusDriven() {
  const live = MATCHES.filter((m) => m.status === "live");
  const upcoming = MATCHES.filter((m) => m.status === "scheduled");
  const finished = MATCHES.filter((m) => m.status === "finished");
  return (
    <div className="space-y-4">
      {live.length > 0 && (
        <section className="space-y-2">
          <h3 className="lp-section-title text-red-alert flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-alert animate-pulse" /> En vivo
          </h3>
          {live.map((m) => <VariantStatusRow key={m.id} m={m} />)}
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h3 className="lp-section-title text-gold flex items-center gap-2"><Clock className="w-4 h-4" /> Próximos</h3>
          {upcoming.map((m) => <VariantStatusRow key={m.id} m={m} />)}
        </section>
      )}
      {finished.length > 0 && (
        <section className="space-y-2">
          <h3 className="lp-section-title text-text-primary/70 flex items-center gap-2"><Lock className="w-4 h-4" /> Terminados</h3>
          {finished.map((m) => <VariantStatusRow key={m.id} m={m} />)}
        </section>
      )}
    </div>
  );
}

// ─── Variant 3 — Compact row + expandable picker ─────────────────────
function VariantExpandable({ m }: { m: SampleMatch }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lp-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2.5 flex items-center gap-3"
      >
        <Crest src={m.homeCrest} code={m.homeCode} size={32} />
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12px] text-text-primary">
            {m.homeCode} <span className="text-text-primary/40">vs</span> {m.awayCode}
          </div>
          <div className="text-[10px] text-text-primary/60">
            {m.status === "finished"
              ? `Final · ${m.homeScore}-${m.awayScore} · +${m.pointsEarned}pts`
              : m.status === "live"
                ? `En vivo · ${m.homeScore}-${m.awayScore} · ${m.elapsed}'`
                : formatKickoff(m.date)}
          </div>
        </div>
        <Crest src={m.awayCrest} code={m.awayCode} size={32} />
        <span className="text-[10px] text-gold uppercase tracking-widest">{open ? "Cerrar" : "Pronosticá"}</span>
      </button>
      {open && m.status === "scheduled" && (
        <div className="px-3 pb-3 pt-1 flex items-center gap-2 border-t border-border-subtle">
          <input
            type="number"
            defaultValue={m.userPrediction?.home ?? 0}
            className="w-14 h-12 rounded-lg bg-bg-elevated border border-border-subtle text-center font-display text-[24px] text-gold"
          />
          <span className="font-display text-[24px] text-text-primary/40">-</span>
          <input
            type="number"
            defaultValue={m.userPrediction?.away ?? 0}
            className="w-14 h-12 rounded-lg bg-bg-elevated border border-border-subtle text-center font-display text-[24px] text-gold"
          />
          <button className="ml-auto px-4 py-2 rounded-full bg-gold text-bg-base text-[12px] font-extrabold">Apuntar</button>
        </div>
      )}
    </div>
  );
}

// ─── Variant 4 — Hero match + compact list ───────────────────────────
function VariantHeroList() {
  const next = MATCHES.find((m) => m.status === "scheduled");
  const rest = MATCHES.filter((m) => m.id !== next?.id);
  return (
    <div className="space-y-3">
      {next ? (
        <div className="lp-card-hero p-5">
          <div className="flex items-center justify-between mb-3 text-[10px] uppercase tracking-[0.1em] text-text-primary/70">
            <span>{next.phase}</span>
            <span>{formatKickoff(next.date)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-4">
            <div className="flex flex-col items-center gap-2">
              <Crest src={next.homeCrest} code={next.homeCode} size={64} />
              <span className="text-[12px] text-text-primary text-center">{next.homeTeam}</span>
            </div>
            <div className="font-display text-[36px] text-gold leading-none">VS</div>
            <div className="flex flex-col items-center gap-2">
              <Crest src={next.awayCrest} code={next.awayCode} size={64} />
              <span className="text-[12px] text-text-primary text-center">{next.awayTeam}</span>
            </div>
          </div>
          <div className="flex gap-1.5 mb-3">
            {["2-1", "1-1", "0-2", "3-0"].map((s) => (
              <button key={s} className="flex-1 py-1.5 rounded-md bg-bg-elevated text-text-primary font-display text-[16px] border border-border-subtle">
                {s}
              </button>
            ))}
          </div>
          <button className="w-full py-2.5 rounded-full bg-gradient-to-b from-gold to-amber text-bg-base font-extrabold text-[13px]">
            Apuntar 2-1
          </button>
        </div>
      ) : null}
      {rest.map((m) => <VariantStatusRow key={m.id} m={m} />)}
    </div>
  );
}

// ─── Variant 5 — Team color accents ──────────────────────────────────
function VariantTinted({ m }: { m: SampleMatch }) {
  const gradient = `linear-gradient(90deg, ${m.homeColor}15, transparent 45%, transparent 55%, ${m.awayColor}15)`;
  return (
    <div className="lp-card p-4 relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: gradient, pointerEvents: "none" }} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3 text-[10px] uppercase tracking-[0.1em] text-text-primary/70">
          <span>{m.phase}</span>
          <span>{formatKickoff(m.date)}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full p-1" style={{ background: `${m.homeColor}22` }}>
              <Crest src={m.homeCrest} code={m.homeCode} size={52} />
            </div>
            <span className="text-[12px] text-center text-text-primary line-clamp-1">{m.homeTeam}</span>
          </div>
          <div className="font-display text-[30px] text-gold leading-none" style={{ fontFeatureSettings: '"tnum"' }}>
            {m.status === "live" || m.status === "finished" ? `${m.homeScore}-${m.awayScore}` : "VS"}
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full p-1" style={{ background: `${m.awayColor}22` }}>
              <Crest src={m.awayCrest} code={m.awayCode} size={52} />
            </div>
            <span className="text-[12px] text-center text-text-primary line-clamp-1">{m.awayTeam}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Variant 7 — Polished current UI (visual-only) ───────────────────
//
// Structure re-ordered into three status-driven sections that read as
// a natural timeline: past → present → future.
//
//   • Finalizados   — collapsed by default. Tap the header to expand
//                      and browse history with tier-coloured points.
//   • En vivo       — always visible, locked display (no editing).
//   • Próximos      — always visible, editable inputs with auto-jump
//                      between upcoming matches only.
//
// Visual polish identical across sections: .lp-card container,
// .lp-section-title headers, 3px left-edge status accent bar,
// compact kickoff pill top-right, gold/amber input glow, tier-
// coloured finished chip. Auto-jump only moves between scheduled
// rows so live/finished never steal focus mid-typing.
function VariantPolishedCurrent() {
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { home: string; away: string }>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const awayInputRefs = useState(() => new Map<string, HTMLInputElement | null>())[0];
  const homeInputRefs = useState(() => new Map<string, HTMLInputElement | null>())[0];

  const upcoming = MATCHES.filter((m) => m.status === "scheduled");
  const live = MATCHES.filter((m) => m.status === "live");
  const finished = MATCHES.filter((m) => m.status === "finished");

  function updateDraft(id: string, side: "home" | "away", v: string) {
    setDrafts((p) => ({
      ...p,
      [id]: { ...(p[id] ?? { home: "", away: "" }), [side]: v },
    }));
    setTouched((p) => new Set(p).add(id));
  }

  function jumpToNextUpcoming(fromId: string) {
    const idx = upcoming.findIndex((m) => m.id === fromId);
    for (let i = idx + 1; i < upcoming.length; i++) {
      const next = upcoming[i];
      const el = homeInputRefs.get(next.id);
      if (el) {
        el.focus();
        el.select();
        return;
      }
    }
  }

  function statusAccent(m: SampleMatch): string {
    if (m.status === "live") return "#FF3D57";
    if (m.status === "finished" && (m.pointsEarned ?? 0) >= 3) return "#1FD87F";
    if (m.status === "finished") return "rgba(255,255,255,0.08)";
    return "#FFD700";
  }

  function pointsTierClasses(points: number): string {
    if (points >= 5) return "bg-gold/15 text-gold border-gold/30";
    if (points >= 3) return "bg-turf/15 text-turf border-turf/30";
    if (points >= 2) return "bg-[#4fc3f7]/15 text-[#4fc3f7] border-[#4fc3f7]/30";
    if (points >= 1) return "bg-bg-elevated text-text-primary border-border-subtle";
    return "bg-bg-elevated text-text-primary/50 border-border-subtle";
  }

  function MatchRow({ m, editable }: { m: SampleMatch; editable: boolean }) {
    const isFinished = m.status === "finished";
    const isLive = m.status === "live";
    const isTouched = touched.has(m.id);
    const draft = drafts[m.id] ?? {
      home: m.userPrediction?.home?.toString() ?? "",
      away: m.userPrediction?.away?.toString() ?? "",
    };

    return (
      <div
        className="relative rounded-lg overflow-hidden flex"
        style={{
          backgroundColor: "rgba(14, 20, 32, 0.55)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {/* 3px left-edge status accent */}
        <div
          className={isLive ? "animate-pulse" : ""}
          style={{ width: 3, background: statusAccent(m), flexShrink: 0 }}
        />
        <div className="flex-1 min-w-0 p-3">
          {/* Kickoff pill top-right */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-[0.1em] text-text-primary/60">
              {m.phase}
            </span>
            {isLive ? (
              <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-red-alert/15 border border-red-alert/30 text-red-alert text-[10px] font-bold uppercase tracking-[0.08em]">
                <span className="w-1.5 h-1.5 rounded-full bg-red-alert animate-pulse" />
                En vivo · {m.elapsed}&apos;
              </span>
            ) : isFinished ? (
              <span className="inline-flex items-center px-2 py-[2px] rounded-full bg-bg-elevated border border-border-subtle text-text-primary/70 text-[10px] font-bold uppercase tracking-[0.08em]">
                Final
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-[2px] rounded-full bg-gold/10 border border-gold/30 text-gold text-[10px] font-bold uppercase tracking-[0.08em]">
                {formatKickoff(m.date)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 text-right">
              <div className="flex items-center justify-end gap-2">
                <p className="font-semibold text-[13px] text-text-primary truncate">
                  {m.homeTeam}
                </p>
                <Crest src={m.homeCrest} code={m.homeCode} size={36} />
              </div>
            </div>

            <div className="flex-shrink-0 flex items-center gap-2">
              {!editable ? (
                <div className="flex items-center gap-1.5 px-1.5">
                  <span
                    className={`font-display leading-none ${
                      isLive ? "text-gold text-[36px]" : "text-text-primary text-[30px]"
                    }`}
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {m.homeScore ?? "—"}
                  </span>
                  <span className="text-text-primary/40 text-lg">—</span>
                  <span
                    className={`font-display leading-none ${
                      isLive ? "text-gold text-[36px]" : "text-text-primary text-[30px]"
                    }`}
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {m.awayScore ?? "—"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => { homeInputRefs.set(m.id, el); }}
                    type="number"
                    min={0}
                    max={20}
                    value={draft.home}
                    onChange={(e) => {
                      updateDraft(m.id, "home", e.target.value);
                      if (e.target.value.length >= 1) {
                        awayInputRefs.get(m.id)?.focus();
                      }
                    }}
                    placeholder="0"
                    className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-[14px] outline-none bg-bg-elevated text-text-primary transition-all ${
                      isTouched
                        ? "border-amber shadow-[0_0_0_2px_rgba(255,159,28,0.25)]"
                        : "border-border-subtle focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                    }`}
                    style={{ border: "2px solid" }}
                  />
                  <span className="text-text-primary/40 font-bold">—</span>
                  <input
                    ref={(el) => { awayInputRefs.set(m.id, el); }}
                    type="number"
                    min={0}
                    max={20}
                    value={draft.away}
                    onChange={(e) => {
                      updateDraft(m.id, "away", e.target.value);
                      if (e.target.value.length >= 1) {
                        jumpToNextUpcoming(m.id);
                      }
                    }}
                    placeholder="0"
                    className={`w-[52px] h-[52px] text-center score-font text-[28px] rounded-[14px] outline-none bg-bg-elevated text-text-primary transition-all ${
                      isTouched
                        ? "border-amber shadow-[0_0_0_2px_rgba(255,159,28,0.25)]"
                        : "border-border-subtle focus:border-gold focus:shadow-[0_0_0_2px_rgba(255,215,0,0.3)]"
                    }`}
                    style={{ border: "2px solid" }}
                  />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-2">
                <Crest src={m.awayCrest} code={m.awayCode} size={36} />
                <p className="font-semibold text-[13px] text-text-primary truncate">
                  {m.awayTeam}
                </p>
              </div>
            </div>
          </div>

          {/* Locked-but-predicted line for live rows */}
          {isLive && m.userPrediction ? (
            <div className="mt-2 text-center">
              <p className="text-[11px] text-text-primary/70">
                Tu pronóstico · {m.userPrediction.home}-{m.userPrediction.away}
              </p>
            </div>
          ) : null}

          {isFinished && m.userPrediction ? (
            <div className="mt-3 flex justify-center">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-[0.08em] ${pointsTierClasses(
                  m.pointsEarned ?? 0,
                )}`}
              >
                Tu {m.userPrediction.home}-{m.userPrediction.away} ·{" "}
                {(m.pointsEarned ?? 0) > 0 ? `+${m.pointsEarned}` : "0"} pts
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Finalizados — collapsed by default */}
      {finished.length > 0 && (
        <div className="lp-card overflow-hidden">
          <button
            type="button"
            onClick={() => setFinishedOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3"
            aria-expanded={finishedOpen}
          >
            <span className="lp-section-title flex items-center gap-2" style={{ fontSize: 14 }}>
              <Lock className="w-3.5 h-3.5 text-text-primary/60" /> Finalizados
              <span className="text-text-primary/60 font-normal">· {finished.length}</span>
            </span>
            <ChevronDown
              className={`w-4 h-4 text-text-primary/70 transition-transform ${finishedOpen ? "rotate-180" : ""}`}
            />
          </button>
          {finishedOpen && (
            <div className="space-y-3 px-3 pb-3">
              {finished.map((m) => <MatchRow key={m.id} m={m} editable={false} />)}
            </div>
          )}
        </div>
      )}

      {/* En vivo — always visible, locked display */}
      {live.length > 0 && (
        <div className="space-y-2">
          <h3 className="lp-section-title flex items-center gap-2 px-1" style={{ fontSize: 14 }}>
            <span className="w-2 h-2 rounded-full bg-red-alert animate-pulse" /> En vivo
            <span className="text-text-primary/60 font-normal">· {live.length}</span>
          </h3>
          <div className="space-y-3">
            {live.map((m) => <MatchRow key={m.id} m={m} editable={false} />)}
          </div>
        </div>
      )}

      {/* Próximos — editable with auto-jump */}
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h3 className="lp-section-title flex items-center gap-2 px-1" style={{ fontSize: 14 }}>
            <Clock className="w-3.5 h-3.5 text-gold" /> Próximos
            <span className="text-text-primary/60 font-normal">· {upcoming.length}</span>
          </h3>
          <div className="space-y-3">
            {upcoming.map((m) => <MatchRow key={m.id} m={m} editable={true} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Variant 6 — Vertical timeline ───────────────────────────────────
function VariantTimeline() {
  const groups: Record<string, SampleMatch[]> = {
    "En curso": MATCHES.filter((m) => m.status === "live"),
    "Hoy / Mañana": MATCHES.filter((m) => m.status === "scheduled"),
    "Ayer": MATCHES.filter((m) => m.status === "finished"),
  };
  return (
    <div className="relative pl-6">
      <div className="absolute left-[9px] top-2 bottom-2 w-[2px] bg-border-subtle" />
      {Object.entries(groups).map(([label, list]) => (
        list.length === 0 ? null : (
          <div key={label} className="mb-5 relative">
            <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-gold border-2 border-bg-base" />
            <h3 className="lp-section-title mb-2" style={{ fontSize: 14 }}>{label}</h3>
            <div className="space-y-2">
              {list.map((m) => <VariantStatusRow key={m.id} m={m} />)}
            </div>
          </div>
        )
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

const VARIANTS: { key: string; label: string; description: string; render: () => React.ReactNode }[] = [
  {
    key: "scoreboard",
    label: "1 — Scoreboard cards",
    description: "Big crests, tall score type, team names under each side. Reads at a glance.",
    render: () => (
      <div className="space-y-3">
        {MATCHES.map((m) => <VariantScoreboard key={m.id} m={m} />)}
      </div>
    ),
  },
  {
    key: "status",
    label: "2 — Status-driven sections",
    description: "En vivo / Próximos / Terminados, compact rows per section.",
    render: () => <VariantStatusDriven />,
  },
  {
    key: "expand",
    label: "3 — Compact row + expandable picker",
    description: "Slim row per match; tap to reveal the inline score picker.",
    render: () => (
      <div className="space-y-2">
        {MATCHES.map((m) => <VariantExpandable key={m.id} m={m} />)}
      </div>
    ),
  },
  {
    key: "hero",
    label: "4 — Hero match + compact list",
    description: "Next match gets Inicio-style hero treatment, rest as compact rows.",
    render: () => <VariantHeroList />,
  },
  {
    key: "tinted",
    label: "5 — Team-color accents",
    description: "Subtle home-to-away tint across each card. Identity without being loud.",
    render: () => (
      <div className="space-y-3">
        {MATCHES.map((m) => <VariantTinted key={m.id} m={m} />)}
      </div>
    ),
  },
  {
    key: "timeline",
    label: "6 — Vertical timeline",
    description: "Left-rail timeline nodes with match rows on each.",
    render: () => <VariantTimeline />,
  },
  {
    key: "polished",
    label: "7 — Polished + timeline ordering (RECOMMENDED)",
    description:
      "Three status-driven sections stacked past → present → future: Finalizados (collapsed, optional), En vivo (locked display), Próximos (editable with auto-jump between upcoming rows only). All the visual polish from variant 7 applied. Drops the por-fecha/por-fase toggle in favour of status grouping.",
    render: () => <VariantPolishedCurrent />,
  },
];

export default function DesignMatchesPreview() {
  return (
    <div className="min-h-screen px-4 pt-6 pb-24 max-w-lg mx-auto">
      <header className="flex items-center gap-3 mb-6">
        <Link href="/design" className="text-text-primary/70 hover:text-gold">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="lp-section-title flex items-center gap-2" style={{ fontSize: 22 }}>
          <Trophy className="w-5 h-5 text-gold" /> Match views preview
        </h1>
      </header>
      <p className="text-[12px] text-text-primary/70 mb-8">
        Internal. Six layout directions for the Partidos tab rendered with the
        same three sample matches (upcoming / live / finished). Pick one or
        combine pieces — tell Claude which ones to ship.
      </p>
      <div className="space-y-10">
        {VARIANTS.map((v) => (
          <section key={v.key} className="space-y-3">
            <div>
              <h2 className="lp-section-title" style={{ fontSize: 18 }}>{v.label}</h2>
              <p className="text-[11px] text-text-primary/60 mt-1">{v.description}</p>
            </div>
            {v.render()}
          </section>
        ))}
      </div>
    </div>
  );
}
