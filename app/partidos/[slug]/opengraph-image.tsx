// app/partidos/[slug]/opengraph-image.tsx — OG image dinámica por partido.
// "Real Madrid vs Barcelona" en yellow card. 1200×630.
//
// Lee el match desde Supabase (read-only). Si no se encuentra, devuelve
// la OG default de marca para que igual exista una imagen útil.

import { ImageResponse } from "next/og";
import { getSiteFromHeaders } from "@/lib/seo/sites";
import { findByInternalSlug } from "@/lib/seo/tournaments";
import { buildMatchSlug, extractDate } from "@/lib/seo/match-slug";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Match preview";

interface Props {
  params: { slug: string };
}

interface Row {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
  venue: string | null;
  tournament: string;
}

async function fetchMatch(slug: string): Promise<Row | null> {
  const date = extractDate(slug);
  if (!date) return null;
  try {
    const supabase = createAdminClient();
    const start = new Date(`${date}T00:00:00Z`);
    start.setHours(start.getHours() - 36);
    const end = new Date(`${date}T23:59:59Z`);
    end.setHours(end.getHours() + 36);
    const { data, error } = await supabase
      .from("matches")
      .select("id,home_team,away_team,scheduled_at,venue,tournament")
      .gte("scheduled_at", start.toISOString())
      .lte("scheduled_at", end.toISOString())
      .neq("home_team", "TBD")
      .neq("away_team", "TBD")
      .limit(200);
    if (error || !data) return null;
    for (const c of data) {
      const row = c as Row;
      const expected = buildMatchSlug({
        id: row.id,
        home_team: row.home_team,
        away_team: row.away_team,
        scheduled_at: row.scheduled_at,
      });
      if (expected === slug) return row;
    }
    return null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: Props) {
  const m = await fetchMatch(params.slug);
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";
  const seoT = m ? findByInternalSlug(m.tournament) : null;
  const tournamentLabel = seoT ? seoT.name[site.locale] : "";

  const dateFmt = m
    ? new Intl.DateTimeFormat(isEs ? "es-CO" : "en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(m.scheduled_at))
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 100%)",
          padding: 80,
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "#FCD116",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              🐥
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              {site.name}
            </div>
          </div>
          {tournamentLabel && (
            <div
              style={{
                fontSize: 22,
                color: "#FCD116",
                fontWeight: 600,
                display: "flex",
              }}
            >
              {tournamentLabel}
            </div>
          )}
        </div>

        {m ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 72,
                fontWeight: 800,
                lineHeight: 1.05,
                display: "flex",
              }}
            >
              {m.home_team}
            </div>
            <div
              style={{
                fontSize: 32,
                color: "rgba(255,255,255,0.45)",
                fontWeight: 800,
                display: "flex",
              }}
            >
              vs
            </div>
            <div
              style={{
                fontSize: 72,
                fontWeight: 800,
                lineHeight: 1.05,
                display: "flex",
              }}
            >
              {m.away_team}
            </div>
            <div
              style={{
                fontSize: 26,
                color: "rgba(255,255,255,0.7)",
                marginTop: 12,
                display: "flex",
              }}
            >
              {`${dateFmt}${m.venue ? ` · ${m.venue}` : ""}`}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 64, fontWeight: 800, display: "flex" }}>
            {isEs ? "Próximo partido" : "Upcoming match"}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 22,
              color: "rgba(255,255,255,0.6)",
              display: "flex",
            }}
          >
            {site.host}
          </div>
          <div
            style={{
              background: "#FCD116",
              color: "black",
              padding: "12px 24px",
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 22,
              display: "flex",
            }}
          >
            {isEs ? "Predice este partido →" : "Predict this match →"}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
