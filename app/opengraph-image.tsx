// app/opengraph-image.tsx — OG image dinámica para rutas que no
// sobreescriben con su propia opengraph-image.tsx (home, /torneos,
// /partidos, /privacy, etc.). Tamaño estándar 1200×630.

import { ImageResponse } from "next/og";
import { getSiteFromHeaders } from "@/lib/seo/sites";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
// El dominio principal sirve el JPEG horneado; og:image:type sigue a ese caso.
export const contentType = "image/jpeg";
export const alt = "La Polla Colombiana / Chicken Picks";

export default async function Image() {
  const site = await getSiteFromHeaders();
  const isEs = site.locale === "es";
  // (2026-09-14) Pedido del dueño: al compartir un link se ven los pollitos y
  // «La Polla Colombiana», no «Crea tu polla deportiva con tus parceros».
  // Imagen horneada (scripts/bake-og-image.cjs), 151 KB: WhatsApp descarta en
  // silencio vistas previas de más de ~300 KB, y ImageResponse re-codifica a
  // PNG de ~1 MB con fotos. Chicken Picks conserva la tarjeta de texto.
  if (isEs) {
    const jpg = await fetch(new URL("./og-la-polla-colombiana.jpg", import.meta.url)).then((r) => r.arrayBuffer());
    return new Response(jpg, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    });
  }
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
              width: 56,
              height: 56,
              borderRadius: 12,
              background: "#FCD116",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
            }}
          >
            🐥
          </div>
          <div
            style={{
              fontSize: 28,
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
              fontSize: 84,
              fontWeight: 800,
              lineHeight: 1.05,
              maxWidth: 980,
            }}
          >
            Create your football pool with friends.
          </div>
          <div style={{ fontSize: 30, color: "#FCD116", fontWeight: 600 }}>
            {isEs
              ? "Mundial · Champions · Libertadores · BetPlay"
              : "World Cup · Champions · Libertadores · BetPlay"}
          </div>
        </div>

        <div
          style={{
            fontSize: 22,
            color: "rgba(255,255,255,0.6)",
            display: "flex",
          }}
        >
          {site.host}
        </div>
      </div>
    ),
    { ...size },
  );
}
