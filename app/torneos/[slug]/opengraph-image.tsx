// app/torneos/[slug]/opengraph-image.tsx — OG image por torneo.
// 1200×630, generada en el edge.

import { ImageResponse } from "next/og";
import { getSiteFromHeaders } from "@/lib/seo/sites";
import { findByPublicSlug } from "@/lib/seo/tournaments";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Polla por torneo";

interface Props {
  params: { slug: string };
}

export default async function Image({ params }: Props) {
  const t = findByPublicSlug(params.slug);
  const site = getSiteFromHeaders();
  const isEs = site.locale === "es";

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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "#FCD116",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
            }}
          >
            🐥
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {site.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 28,
              color: "#FCD116",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 3,
            }}
          >
            {isEs ? "Polla del torneo" : "Tournament pool"}
          </div>
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.0,
              maxWidth: 1000,
            }}
          >
            {t ? t.name[site.locale] : isEs ? "Tu polla" : "Your pool"}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          <div style={{ display: "flex" }}>{site.host}</div>
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
            {isEs ? "Crear polla gratis →" : "Create pool — free →"}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
